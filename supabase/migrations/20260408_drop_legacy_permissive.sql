-- [보안 P1: IDOR 차단] community_posts 레거시 permissive UPDATE 정책 제거
-- 문제: 0001_init_schema 의 "upd_posts" (for update using (true)) 가
--   20260407_community_realtime 의 소유권 정책 "Users can update own posts"
--   (using auth.uid() = user_id) 와 PostgreSQL RLS 에서 OR 결합 →
--   유효 권한 = true OR 소유권 = true → 인증된 누구나 타인 게시글 수정 가능(IDOR).
-- 해결: 레거시 permissive 정책을 드롭. 소유권 정책만 남아 본인 글만 수정 가능.
-- 순서: 파일명 타임스탬프(20260408)가 community_realtime(20260407) 이후 →
--   드롭 시점에 소유권 정책이 이미 존재함이 보장됨. idempotent(if exists).

drop policy if exists "upd_posts" on community_posts;
