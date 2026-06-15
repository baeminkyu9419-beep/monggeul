-- [크레딧 적립 race 수정] add_credits(p_count int) RPC 신설 (2026-06-16)
--
-- 배경: subscription.js addCredits() 가 client 산술 누산이었다.
--   current = getCredits()        -- 로컬/캐시 stale 값 읽기
--   newCredits = current + count  -- CLIENT 측 합산
--   upsert({ premium_credits: newCredits })  -- 통째 덮어쓰기
--   → 두 적립이 동일 stale base 에서 출발하면 마지막 upsert 가 이김(lost update, race).
--   더하여 20260614_drop_self_write_entitlements 가 own_ent 를 드롭한 뒤로는
--   이 client upsert 자체가 RLS 로 거부됨 → 적립 경로가 사실상 死(서버 미반영).
--
-- 해결: use_credit() 와 동일 패턴의 SECURITY DEFINER RPC 로 "가산만" 서버 권위 처리.
--   - auth.uid() 기준 → 호출자 본인 행만 가산(타인 적립/조작 불가).
--   - 단일 INSERT ... ON CONFLICT DO UPDATE atomic → 동시요청 race 안전(원자증분).
--   - premium_credits = user_entitlements.premium_credits + p_count (덮어쓰기 아님).
--   - p_count <= 0 거부 → 차감/무효 호출 방지.
--   - SECURITY DEFINER + set search_path=public (search_path 주입 방지).
--   - authenticated 에게만 EXECUTE (anon 불가).
--   반환: 가산 후 잔여 크레딧(int). 미인증/거부 = -1.
--
-- 주의: 실 매출 적립 정본은 결제 webhook/Edge Function(service_role) 이며,
--   본 RPC 는 IAP 복원/내부 적립 등 client 발 적립 경로의 원자성·서버권위 보강이다.

create or replace function public.add_credits(p_count integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total integer;
begin
  if v_uid is null then
    return -1;  -- 미인증
  end if;
  if p_count is null or p_count <= 0 then
    return -1;  -- 0 이하/널 적립 거부 (차감·무효 호출 방지)
  end if;

  insert into public.user_entitlements (user_id, premium_credits, updated_at)
  values (v_uid, p_count, now())
  on conflict (user_id) do update
    set premium_credits = public.user_entitlements.premium_credits + p_count,
        updated_at = now()
  returning premium_credits into v_total;

  return coalesce(v_total, -1);
end;
$$;

revoke all on function public.add_credits(integer) from public;
grant execute on function public.add_credits(integer) to authenticated;
