-- [크레딧 차감 회귀 수정] use_credit() RPC 신설 (2026-06-15)
--
-- 배경: 20260614_drop_self_write_entitlements.sql 가 own_ent(자기쓰기) 정책을 드롭해
--   결제우회(자기부여 premium_credits=99999)는 막았으나, subscription.js useCredit() 의
--   client 직접 update(premium_credits 차감)도 RLS 로 거부 → 서버 크레딧이 차감되지 않아
--   localStorage 만 줄고 서버 정본은 그대로 = 반대방향 우회(유료 상세해몽 무제한 열람, 매출 누수).
--
-- 해결: SECURITY DEFINER RPC 로 "차감만" 서버 권위 처리.
--   - auth.uid() 기준 → 호출자 본인 행만 차감(타인 차감/자기부여 불가).
--   - premium_credits > 0 조건 → 0 이하로 내려가지 않음(음수 방지).
--   - 단일 UPDATE atomic → 동시요청 race 안전.
--   - SECURITY DEFINER + set search_path=public(search_path 주입 방지).
--   - authenticated 에게만 EXECUTE(anon 불가).
--   반환: 차감 후 잔여 크레딧(int). 크레딧 없음/행 없음 = -1.

create or replace function public.use_credit()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_remaining integer;
begin
  if v_uid is null then
    return -1;  -- 미인증
  end if;

  update public.user_entitlements
     set premium_credits = premium_credits - 1,
         updated_at = now()
   where user_id = v_uid
     and premium_credits > 0
  returning premium_credits into v_remaining;

  return coalesce(v_remaining, -1);  -- 행 없음/크레딧 0 = -1
end;
$$;

revoke all on function public.use_credit() from public;
grant execute on function public.use_credit() to authenticated;
