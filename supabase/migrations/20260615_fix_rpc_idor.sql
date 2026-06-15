-- [보안 P1: RPC IDOR 차단] toggle_post_like + increment_dream_count 소유권 강화
-- 2026-06-15
--
-- 문제 1 — toggle_post_like(p_post_id, p_user_id):
--   p_user_id 를 클라가 자유롭게 지정 가능 → 공격자가 피해자 UUID 를 알거나 추측하면
--   toggle_post_like('<post_id>', '<victim_uuid>') 로 피해자 명의 좋아요 삽입/삭제 가능.
--   SECURITY DEFINER 이므로 RLS community_reactions 정책(insert with check auth.uid()=user_id)을
--   우회해 직접 INSERT/DELETE 가 실행됨 → 피해자 PII(UUID) 가 community_reactions 에 무단 기록.
--
-- 문제 2 — increment_dream_count(p_user_id):
--   0001_init_schema 및 schema.sql 에 SECURITY DEFINER 버전이 존재.
--   p_user_id 를 외부에서 받으므로 공격자가 피해자 UUID 를 전달하면
--   피해자의 usage_daily.count 를 무단 증가시켜 당일 무료 해몽 한도(2회) 소진 유발(서비스 거부).
--   역방향 가능성: count를 대량 증가로 정수 오버플로우/DB 부하 유발.
--
-- 해결:
--   (a) toggle_post_like: p_user_id 파라미터 제거 → auth.uid() 사용.
--       클라이언트(community-storage.js) 는 p_user_id 를 보내지 않도록 교체(JS 수정).
--   (b) increment_dream_count: auth.uid() 기준으로만 카운트. p_user_id 인자 제거.
--   (c) 두 함수 모두 authenticated 만 실행 가능(REVOKE ALL + GRANT authenticated).
--       anon 호출 차단 — 서비스 거부 공격 비용 상승.
--
-- 하위호환:
--   - openai-proxy 가 check_rate_limit(p_user_id) 를 호출하므로 해당 함수는 변경 없음.
--   - toss-confirm/webhook 은 service_role 클라이언트 사용 → 영향 없음.
--   - community-storage.js toggleLikePost 는 p_user_id 전달 제거(JS 동시 수정).
--   - subscription.js incDreamCount 는 p_user_id 전달 제거(JS 동시 수정).
--   - GRANT 은 idempotent.

-- ── 1. toggle_post_like: p_user_id 제거, auth.uid() 강제 ──
create or replace function public.toggle_post_like(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  existed boolean;
begin
  -- 미인증 차단 (anon 호출이 어떻게든 도달해도 거부)
  if v_uid is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select exists(
    select 1 from community_reactions
    where post_id = p_post_id
      and user_id = v_uid
      and reaction_type = 'like'
      and comment_id is null
  ) into existed;

  if existed then
    delete from community_reactions
    where post_id = p_post_id
      and user_id = v_uid
      and reaction_type = 'like'
      and comment_id is null;
    update community_posts set like_count = greatest(like_count - 1, 0)
    where id = p_post_id;
    return false;
  else
    insert into community_reactions (post_id, user_id, reaction_type)
    values (p_post_id, v_uid, 'like');
    update community_posts set like_count = like_count + 1
    where id = p_post_id;
    return true;
  end if;
end;
$$;

-- 구버전(p_user_id 있는 오버로드) 제거 — 충돌 방지
drop function if exists public.toggle_post_like(uuid, uuid);

revoke all on function public.toggle_post_like(uuid) from public;
grant execute on function public.toggle_post_like(uuid) to authenticated;

-- ── 2. increment_dream_count: p_user_id 제거, auth.uid() 강제 ──
create or replace function public.increment_dream_count()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  insert into usage_daily (user_id, date, "count")
  values (v_uid, current_date, 1)
  on conflict (user_id, date)
  do update set "count" = usage_daily."count" + 1;
end;
$$;

-- 구버전(p_user_id 있는 오버로드) 제거
drop function if exists public.increment_dream_count(uuid);

revoke all on function public.increment_dream_count() from public;
grant execute on function public.increment_dream_count() to authenticated;
