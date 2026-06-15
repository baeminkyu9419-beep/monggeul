-- [보안 P0: use_pack_credit IDOR + 권한 강화] 2026-06-15
--
-- 문제 1 — 임의 p_user_id 수용: use_pack_credit(p_user_id uuid) 는 인자를 그대로
--   WHERE user_id = p_user_id 로 사용한다. 공격자가 피해자 UUID 를 알거나 추측하면
--   use_pack_credit('<victim_uuid>') 호출로 피해자의 pack 크레딧을 무단 소모.
--   (엔티틀먼트 테이블 RLS = service_role 쓰기 전용이지만 SECURITY DEFINER 함수는
--    RLS 를 우회해 쓰기 가능 → 직접 UPDATE 가 아닌 함수 호출로 우회됨)
--
-- 문제 2 — EXECUTE 권한 미제한: 마이그레이션에 GRANT/REVOKE 없음 →
--   PostgreSQL 기본 = PUBLIC EXECUTE(anon 포함) → 비인증 호출 가능.
--
-- 해결:
--   (a) 함수 재작성: p_user_id 파라미터 제거, auth.uid() 기준으로만 차감
--       → 호출자 본인 외 타인 크레딧 소모 물리적 불가.
--   (b) REVOKE ALL + GRANT authenticated 전용 (use_credit 패턴 동일).
--   (c) 검색경로 주입 방지: SET search_path = public (use_credit 와 동일).
--
-- 하위호환: toss-confirm Edge Function 이 admin 클라이언트(service_role)로
--   use_pack_credit 를 호출하는 경우가 있는지 검색 → 없음(service_role 은 SQL 직접 접근).
--   클라이언트에서 직접 호출하는 경우도 없음(payment.js usePackCredit 는 dead export).
--   안전하게 재정의 가능.

create or replace function public.use_pack_credit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ent_id uuid;
begin
  if v_uid is null then
    return false;  -- 미인증
  end if;

  -- 가장 오래된 활성 팩에서 1회 차감 (호출자 본인만)
  select id into v_ent_id
  from public.entitlements
  where user_id = v_uid
    and type = 'pack'
    and is_active = true
    and remaining > 0
  order by created_at asc
  limit 1
  for update;

  if v_ent_id is null then
    return false;
  end if;

  update public.entitlements
     set remaining = remaining - 1,
         is_active = case when remaining - 1 <= 0 then false else true end
   where id = v_ent_id;

  return true;
end;
$$;

-- 파라미터 있는 구버전도 강제 교체 (동명 오버로드 충돌 방지)
drop function if exists public.use_pack_credit(uuid);

revoke all on function public.use_pack_credit() from public;
grant execute on function public.use_pack_credit() to authenticated;

-- check_entitlement 도 동일하게 auth.uid() 기준으로 강화.
-- 현재는 p_user_id 를 외부에서 받아 타인 구독정보 열람 가능(정보노출 LOW).
-- 단, 기존 Edge Function(openai-proxy) 이 check_entitlement(p_user_id) 를 호출하므로
-- 하위호환 버전(p_user_id 인자)을 유지하되, anon 에서 호출 불가로 제한한다.
revoke all on function public.check_entitlement(uuid) from public;
grant execute on function public.check_entitlement(uuid) to authenticated, service_role;
