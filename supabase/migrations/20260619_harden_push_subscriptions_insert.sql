-- [보안 R2: push_subscriptions permissive insert 격리] 2026-06-19
--
-- 문제(노출 클래스 — ONGLE 결제테이블에서 발견된 with check (true) write 와 동형):
--   20260407_push_subscriptions.sql 의
--     create policy "Anyone can insert subs" on push_subscriptions
--       for insert with check (true);
--   는 user_id 격리가 전혀 없다. anon/authenticated 키(브라우저 콘솔)로
--     supabase.from('push_subscriptions').insert({ user_id: '<victim>', endpoint, keys })
--   를 직접 호출하면 타인 user_id 로 구독 행을 위조 적재할 수 있다.
--   → push-scheduler 가 그 행을 읽어 엉뚱한 endpoint 로 알림을 보내거나,
--     피해자 user_id 에 공격자 endpoint 를 묶어 알림 가로채기/스팸이 가능하다.
--
-- 정본 write 경로는 RLS 와 무관(영향 없음):
--   클라이언트(src/services/web-push.js)는 테이블에 직접 insert 하지 않고
--   POST /functions/v1/push-subscribe 로만 전송한다. 그 Edge Function
--   (supabase/functions/push-subscribe/index.ts)은 SUPABASE_SERVICE_ROLE_KEY 로
--   createClient → upsert 하므로 RLS 를 우회한다. 따라서 permissive insert 정책은
--   정상 기능에 불필요하고, 오직 직접 REST 위조 경로만 열어준다.
--
-- 해결:
--   permissive "Anyone can insert subs" 를 드롭하고, 본인(user_id = auth.uid())
--   격리 insert 정책으로 교체한다. 정상 클라 경로(Edge Function/service_role)는
--   RLS 우회로 그대로 동작하고, 직접 위조 insert 만 fail-closed 로 차단된다.
--   (select/update/delete 정책은 이미 auth.uid() = user_id 격리 — 변경 없음.)
--
-- 순서: 파일명 타임스탬프(20260619) > 20260407_push_subscriptions →
--   드롭 시점에 대상 정책이 이미 존재함이 보장됨. idempotent(if exists).

drop policy if exists "Anyone can insert subs" on public.push_subscriptions;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'Users can insert own subs'
  ) then
    create policy "Users can insert own subs" on public.push_subscriptions
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;
