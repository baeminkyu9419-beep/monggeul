-- [보안 P2: check_entitlement IDOR 정보노출 차단] 2026-06-16
--
-- 문제 — 임의 p_user_id 수용(정보노출 IDOR):
--   check_entitlement(p_user_id uuid) 는 SECURITY DEFINER 로 RLS 를 우회하며,
--   외부에서 받은 p_user_id 를 그대로 WHERE user_id = p_user_id 에 사용한다.
--   entitlements RLS("Users read own entitlements" = auth.uid()=user_id) 가
--   존재하지만 SECURITY DEFINER 가 이를 우회하므로, 인증된 임의 사용자가
--   check_entitlement('<victim_uuid>') 를 호출하면 피해자의 구독 보유 여부,
--   구독 만료일(subscription_expires), 팩 잔여 크레딧(pack_credits) 을 열람 가능.
--   20260615_harden_use_pack_credit.sql 은 anon EXECUTE 만 차단했을 뿐
--   authenticated↔authenticated IDOR 는 그대로 남아 있었다(해당 파일 주석 인정).
--
-- 해결(repo 기성 패턴 = toggle_post_like / increment_dream_count / use_pack_credit 와 동일):
--   인증된 호출자는 auth.uid() 만 조회하도록 강제한다. p_user_id 인자는
--   하위호환(openai-proxy Edge Function 이 { p_user_id: user.id } 전달, subscription.js /
--   payment.js 동일)을 위해 시그니처는 유지하되, auth.uid() 가 존재하면 그 값으로
--   덮어쓴다 → 타인 UUID 를 넘겨도 본인 정보만 반환(IDOR 물리적 차단).
--   auth.uid() 가 null 인 경우(service_role 서버측 경로)에만 전달된 p_user_id 를 사용.
--
-- 하위호환:
--   - openai-proxy: { p_user_id: user.id } = 본인 ID → auth.uid() 와 동일 → 동작 불변.
--   - subscription.js / payment.js: currentUser.id = 본인 ID → 동작 불변.
--   - service_role 직접 호출(auth.uid() null): 전달 p_user_id 유지 → 동작 불변.
--   - EXECUTE 권한은 20260615 하드닝(authenticated, service_role) 유지(idempotent 재확인).
--   - search_path 고정으로 검색경로 주입 방지(use_credit 패턴 동일).

create or replace function public.check_entitlement(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), p_user_id);
    -- 인증 호출자는 auth.uid() 강제(IDOR 차단). service_role(null)만 인자 사용.
  v_sub record;
  v_pack_credits integer;
  v_result jsonb;
begin
  if v_uid is null then
    -- 미인증 + 인자 없음 → 권한 없음으로 응답(정보 누출 없음).
    return jsonb_build_object(
      'has_subscription', false,
      'subscription_expires', null,
      'pack_credits', 0,
      'can_use', false
    );
  end if;

  -- 활성 구독 확인 (호출자 본인만)
  select * into v_sub
  from public.entitlements
  where user_id = v_uid
    and type = 'subscription'
    and is_active = true
    and expires_at > now()
  order by expires_at desc
  limit 1;

  -- 팩 잔여 횟수 합산 (호출자 본인만)
  select coalesce(sum(remaining), 0) into v_pack_credits
  from public.entitlements
  where user_id = v_uid
    and type = 'pack'
    and is_active = true
    and remaining > 0;

  v_result := jsonb_build_object(
    'has_subscription', v_sub is not null,
    'subscription_expires', v_sub.expires_at,
    'pack_credits', v_pack_credits,
    'can_use', (v_sub is not null) or (v_pack_credits > 0)
  );

  return v_result;
end;
$$;

-- EXECUTE 권한 재확인(idempotent) — anon 차단 유지, authenticated+service_role 만.
revoke all on function public.check_entitlement(uuid) from public;
grant execute on function public.check_entitlement(uuid) to authenticated, service_role;
