-- [보안 P1: check_rate_limit IDOR + PUBLIC EXECUTE 차단] 2026-06-23
--
-- 문제 — 무인증(PUBLIC) 실행 + 임의 p_user_id 수용(rate-limit DoS):
--   0003_rate_limit.sql 의 check_rate_limit(p_user_id uuid, p_max int) 은 SECURITY DEFINER
--   이지만 REVOKE/GRANT 가 전혀 없어 PostgreSQL 기본값(PUBLIC EXECUTE = anon 포함)으로
--   노출돼 있었다. 또 본문이 전달된 p_user_id 를 그대로
--     insert into rate_limit(user_id, ...) values (p_user_id, ...)
--   에 사용하므로(auth.uid() 강제 없음), 공격자가 피해자 UUID 를 넘겨
--   check_rate_limit('<victim_uuid>', 1) 를 분당 반복 호출하면 피해자의 분당 카운터를
--   소진시켜 피해자의 정상 요청을 429 로 차단(targeted rate-limit DoS)할 수 있다.
--   다른 RPC(toggle_post_like/use_credit/check_entitlement)는 전부 revoke/grant 가
--   있으나 check_rate_limit 만 누락이었고, 20260615_fix_rpc_idor.sql:24 주석이
--   'check_rate_limit 는 변경 없음'으로 미수정을 명시 인정했다.
--
-- 해결(repo 기성 패턴 = check_entitlement / toggle_post_like / use_credit 동일):
--   인증된 호출자는 auth.uid() 만 카운트하도록 강제한다. p_user_id 인자는 하위호환을
--   위해 시그니처는 유지하되, auth.uid() 가 존재하면 그 값으로 덮어쓴다
--   (coalesce(auth.uid(), p_user_id)) → 타인 UUID 를 넘겨도 본인 카운터만 증가
--   (피해자 DoS 물리적 차단). auth.uid() 가 null 인 경우(service_role 서버측 경로)에만
--   전달된 p_user_id 를 사용. 그리고 PUBLIC EXECUTE 를 회수하고 authenticated+service_role
--   에게만 부여(anon 차단 → DoS 공격 비용 상승).
--
-- 하위호환:
--   - openai-proxy / toss-checkout / toss-confirm: 전부 user-authed supabase 클라이언트로
--     { p_user_id: user.id } 전달 = 본인 ID → auth.uid() 와 동일 → 동작 불변.
--   - service_role 직접 호출(auth.uid() null): 전달 p_user_id 유지 → 동작 불변.
--   - 반환 형(boolean)·rate_limit 테이블 형 불변 → 카운트 로직 동작 동일.
--   - search_path 고정으로 검색경로 주입 방지(check_entitlement 패턴 동일).

create or replace function public.check_rate_limit(p_user_id uuid, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), p_user_id);
    -- 인증 호출자는 auth.uid() 강제(IDOR/DoS 차단). service_role(null)만 인자 사용.
  w timestamptz;
  c int;
begin
  if v_uid is null then
    -- 미인증 + 인자 없음 → 카운트 불가, 안전하게 거부(fail-closed).
    return false;
  end if;

  w := date_trunc('minute', now());
  insert into rate_limit(user_id, window_min, cnt) values (v_uid, w, 1)
    on conflict(user_id, window_min) do update set cnt = rate_limit.cnt + 1
    returning cnt into c;
  return c <= p_max;
end;
$$;

-- PUBLIC(anon 포함) EXECUTE 회수 → authenticated + service_role 만 호출 가능.
revoke all on function public.check_rate_limit(uuid, int) from public;
grant execute on function public.check_rate_limit(uuid, int) to authenticated, service_role;
