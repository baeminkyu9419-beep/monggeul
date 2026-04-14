-- 커뮤니티 실시간화 (Phase 2-3)
-- 게시물, 댓글, 리액션 테이블 + Realtime + 인기 알고리즘

-- 1. 커뮤니티 게시물
create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  avatar text default 'a1',
  post_type text default '꿈기록',
  title text not null,
  body text not null,
  tag text,
  badges text[] default '{}',
  stats jsonb default '{}',
  similar text,
  anon_mode text default 'anon',
  like_count integer default 0,
  comment_count integer default 0,
  created_at timestamptz default now()
);

-- 2. 커뮤니티 댓글
create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  body text not null,
  created_at timestamptz default now()
);

-- 3. 커뮤니티 리액션
create table if not exists community_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  comment_id uuid references community_comments(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  reaction_type text not null,
  created_at timestamptz default now(),
  unique(post_id, user_id, reaction_type, comment_id)
);

-- 인덱스
create index if not exists idx_posts_created on community_posts(created_at desc);
create index if not exists idx_posts_tag on community_posts(tag);
create index if not exists idx_posts_popularity on community_posts(like_count desc, created_at desc);
create index if not exists idx_comments_post on community_comments(post_id, created_at);
create index if not exists idx_reactions_post on community_reactions(post_id);

-- RLS
alter table community_posts enable row level security;
alter table community_comments enable row level security;
alter table community_reactions enable row level security;

create policy "Anyone can read posts" on community_posts for select using (true);
create policy "Auth users can insert posts" on community_posts for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can update own posts" on community_posts for update using (auth.uid() = user_id);
create policy "Users can delete own posts" on community_posts for delete using (auth.uid() = user_id);

create policy "Anyone can read comments" on community_comments for select using (true);
create policy "Auth users can insert comments" on community_comments for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can delete own comments" on community_comments for delete using (auth.uid() = user_id);

create policy "Anyone can read reactions" on community_reactions for select using (true);
create policy "Auth users can insert reactions" on community_reactions for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can delete own reactions" on community_reactions for delete using (auth.uid() = user_id);

-- 좋아요 토글 RPC
create or replace function toggle_post_like(p_post_id uuid, p_user_id uuid)
returns boolean as $$
declare
  existed boolean;
begin
  select exists(
    select 1 from community_reactions
    where post_id = p_post_id and user_id = p_user_id
      and reaction_type = 'like' and comment_id is null
  ) into existed;

  if existed then
    delete from community_reactions
    where post_id = p_post_id and user_id = p_user_id
      and reaction_type = 'like' and comment_id is null;
    update community_posts set like_count = greatest(like_count - 1, 0)
    where id = p_post_id;
    return false;
  else
    insert into community_reactions (post_id, user_id, reaction_type)
    values (p_post_id, p_user_id, 'like');
    update community_posts set like_count = like_count + 1
    where id = p_post_id;
    return true;
  end if;
end;
$$ language plpgsql security definer;

-- 인기 게시물 RPC (좋아요 × 시간 가중치)
create or replace function get_popular_posts(p_limit integer default 20)
returns setof community_posts as $$
begin
  return query
    select *
    from community_posts
    order by (
      like_count * 10.0 / (extract(epoch from (now() - created_at)) / 3600 + 1)
    ) desc
    limit p_limit;
end;
$$ language plpgsql stable;

-- 댓글 수 자동 동기화 트리거
create or replace function update_comment_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update community_posts set comment_count = comment_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update community_posts set comment_count = greatest(comment_count - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create or replace trigger on_comment_change
  after insert or delete on community_comments
  for each row execute function update_comment_count();

-- Supabase Realtime 활성화
alter publication supabase_realtime add table community_posts;
alter publication supabase_realtime add table community_comments;
