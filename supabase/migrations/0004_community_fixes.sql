-- 커뮤니티 봇 seeding + 인기글 수정 (2026-05-22)
-- 원인: 0001 ins_posts 정책이 user_id IS NULL 거부 → 봇 게시물(user_id null) insert 400
--       similar 컬럼 부재 → 봇 payload 400 / get_popular_posts 함수 미생성 → 인기탭 404

-- 1) 봇 게시물 insert 허용 (user_id IS NULL) — schema.sql 정본 정책과 일치
drop policy if exists ins_posts on community_posts;
drop policy if exists "Auth users can insert posts" on community_posts;
create policy "Auth users can insert posts" on community_posts for insert with check (auth.uid() = user_id or user_id is null);

-- 2) 봇 게시물 similar 컬럼 (saveBotPost가 사용, similar는 SQL 예약어라 따옴표 필수)
alter table community_posts add column if not exists "similar" jsonb;

-- 3) 인기 게시물 RPC (좋아요 × 시간 가중치)
create or replace function get_popular_posts(p_limit integer default 20)
returns setof community_posts as $func$
begin
  return query
    select * from community_posts
    order by (like_count * 10.0 / (extract(epoch from (now() - created_at)) / 3600 + 1)) desc
    limit p_limit;
end;
$func$ language plpgsql security definer;
