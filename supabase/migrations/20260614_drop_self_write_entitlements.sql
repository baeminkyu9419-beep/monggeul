-- [보안 P0: 결제 우회 차단] user_entitlements 자기쓰기 정책 제거
-- 문제: 0001_init_schema 의 "own_ent" (for all using auth.uid()=user_id with check 동일) 가
--   20260321_billing_schema 의 의도된 읽기전용 정책 "Users read own entitlement" (for select)
--   + "Service role manages entitlements" 와 PostgreSQL RLS 에서 OR 결합된다.
--   permissive 정책은 OR 로 합쳐지므로 "own_ent" 의 INSERT/UPDATE 허용이 살아있으면
--   읽기전용 의도가 무력화 → 인증 사용자가 anon 키(브라우저 콘솔)로
--   supabase.from('user_entitlements').upsert({user_id:<myid>, entitlement_key:'premium',
--   status:'active', premium_credits:99999}) 실행 시 결제 없이 프리미엄/무제한 크레딧 획득.
--   티어/크레딧 판정 경로(check_entitlement RPC, subscription.js select)가 정확히 이 테이블을 읽음.
-- 해결: "own_ent" 를 드롭. 읽기는 "Users read own entitlement"(select) 가, 쓰기는
--   "Service role manages entitlements"(Edge Function/webhook) 가 담당 → fail-closed.
-- 순서: 파일명 타임스탬프(20260614)가 billing_schema(20260321) 이후 →
--   드롭 시점에 select/service_role 정책이 이미 존재함이 보장됨. idempotent(if exists).
-- 클라 영향: subscription.js useCredit/addCredits 의 직접 update/upsert(:93/:112)는 이제
--   RLS 로 거부되나 둘 다 try/catch 로 감싸져 있고 localStorage 캐시로 UX 유지 →
--   실 크레딧 정본은 서버(webhook/Edge Function)가 갱신하는 동일 테이블 읽기로 수렴.

drop policy if exists "own_ent" on user_entitlements;
