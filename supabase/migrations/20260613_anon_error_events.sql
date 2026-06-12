-- P1-3 (2026-06-13 감사): 비로그인 FE 에러 전량 유실 차단 — 익명 에러 이벤트 적재 허용
--
-- 배경: events RLS 두 세대 정책 모두 익명(anon role) insert 불가였다:
--   - "Users can insert own events"  with check (auth.uid() = user_id)  → 세션 없으면 NULL 비교 = 거부
--   - "ins_events"                   to authenticated with check (true) → anon role 미포함
--   → 부팅 직후(익명 세션 확립 전)·정식 오픈 후 비로그인·signInAnonymously 실패 사용자의
--     js_error/js_rejection 이 전량 유실 (FE 가 보내도 DB 가 거부).
--
-- 조치: 익명 insert 를 최소 범위로 개방 — user_id null + 에러 이벤트 2종만.
--   - select 정책은 추가하지 않음 = 익명 읽기 불가 불변.
--   - user_id 는 users(id) FK → 위장 uuid 삽입 불가, null 강제.
--   - authenticated 포함 이유: 세션은 있으나 store.currentUser 확립 전 레이스 윈도우
--     (이때 FE 는 user_id null 로 보냄) — init 세대에 따라 ins_events 부재 시도 커버.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon_error_events') then
    create policy "anon_error_events" on events
      for insert to anon, authenticated
      with check (user_id is null and event in ('js_error', 'js_rejection'));
  end if;
end $$;
