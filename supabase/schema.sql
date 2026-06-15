-- 몽글몽글 Supabase DB 스키마
-- Supabase Dashboard → SQL Editor 에서 실행

-- 1. 사용자
create table if not exists users (
  id uuid references auth.users primary key,
  nickname text default '꿈탐험가',
  created_at timestamptz default now(),
  subscription_tier text default 'free',  -- 'free' | 'starlight'
  subscription_expires_at timestamptz,
  xp integer default 0,
  streak integer default 0,
  last_checkin date
);

-- 2. 꿈 기록
create table if not exists dreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  content text not null,
  title text,
  badges text[],
  emotions text[],
  keywords text[],
  result jsonb,         -- AI 해몽 결과 전체
  radar_data jsonb,     -- 6축 스탯
  created_at timestamptz default now()
);

-- 3. 해몽 사용량 (일별)
create table if not exists usage_daily (
  user_id uuid references users(id) on delete cascade,
  date date default current_date,
  dream_count integer default 0,
  primary key (user_id, date)
);

-- 4. 달이 메모리
create table if not exists dali_memory (
  user_id uuid references users(id) on delete cascade primary key,
  memories jsonb default '[]',
  chat_history jsonb default '[]',
  updated_at timestamptz default now()
);

-- 5. 이벤트 로그 (Phase 6용, 미리 생성)
create table if not exists events (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  event text not null,
  properties jsonb default '{}',
  created_at timestamptz default now()
);

-- 6. 커뮤니티 게시물
create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  avatar text default 'a1',
  post_type text default '꿈기록',  -- '꿈기록' | '질문' | '일상' | 'bot'
  title text not null,
  body text not null,
  tag text,                        -- '뱀 꿈','추락 꿈','이별 꿈' 등
  badges text[] default '{}',
  stats jsonb default '{}',        -- 레이더 차트 데이터
  similar text,                    -- "🐍 뱀 꿈 · 128명"
  anon_mode text default 'anon',   -- 'anon' | 'nickname' | 'profile'
  like_count integer default 0,
  comment_count integer default 0,
  created_at timestamptz default now()
);

-- 7. 커뮤니티 댓글
create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  body text not null,
  created_at timestamptz default now()
);

-- 8. 커뮤니티 리액션 (좋아요 + 스티커)
create table if not exists community_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  comment_id uuid references community_comments(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  reaction_type text not null,     -- 'like' | 'correct' | 'similar' | 'psych' | 'comfort'
  created_at timestamptz default now(),
  unique(post_id, user_id, reaction_type, comment_id)
);

-- 커뮤니티 인덱스
create index if not exists idx_posts_created on community_posts(created_at desc);
create index if not exists idx_posts_tag on community_posts(tag);
create index if not exists idx_posts_popularity on community_posts(like_count desc, created_at desc);
create index if not exists idx_comments_post on community_comments(post_id, created_at);
create index if not exists idx_reactions_post on community_reactions(post_id);

-- 커뮤니티 RLS
alter table community_posts enable row level security;
alter table community_comments enable row level security;
alter table community_reactions enable row level security;

-- 게시물: 누구나 읽기, 본인만 쓰기/수정/삭제
create policy "Anyone can read posts" on community_posts for select using (true);
create policy "Auth users can insert posts" on community_posts for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can update own posts" on community_posts for update using (auth.uid() = user_id);
create policy "Users can delete own posts" on community_posts for delete using (auth.uid() = user_id);

-- 댓글: 누구나 읽기, 본인만 쓰기/삭제
create policy "Anyone can read comments" on community_comments for select using (true);
create policy "Auth users can insert comments" on community_comments for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can delete own comments" on community_comments for delete using (auth.uid() = user_id);

-- 리액션: 누구나 읽기, 본인만 쓰기/삭제
create policy "Anyone can read reactions" on community_reactions for select using (true);
create policy "Auth users can insert reactions" on community_reactions for insert with check (auth.uid() = user_id or user_id is null);
create policy "Users can delete own reactions" on community_reactions for delete using (auth.uid() = user_id);

-- RPC: 좋아요 토글 (like_count 자동 증감)
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

-- RPC: 인기 게시물 (좋아요 × 시간 가중치)
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

-- RPC: 댓글 수 동기화 트리거
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

-- RPC: 해몽 횟수 증가
create or replace function increment_dream_count(p_user_id uuid)
returns void as $$
begin
  insert into usage_daily (user_id, date, dream_count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, date)
  do update set dream_count = usage_daily.dream_count + 1;
end;
$$ language plpgsql security definer;

-- RLS (Row Level Security)
alter table users enable row level security;
alter table dreams enable row level security;
alter table usage_daily enable row level security;
alter table dali_memory enable row level security;
alter table events enable row level security;

-- 정책: 본인 데이터만 접근
create policy "Users can read own data" on users for select using (auth.uid() = id);
create policy "Users can update own data" on users for update using (auth.uid() = id);
create policy "Users can insert own data" on users for insert with check (auth.uid() = id);

create policy "Users can CRUD own dreams" on dreams for all using (auth.uid() = user_id);
-- usage_daily: select 전용. 쓰기는 increment_dream_count RPC(security definer)만 → 무료 일일한도 자가 리셋(API비용 DoS) 차단.
drop policy if exists "Users can CRUD own usage" on usage_daily;
create policy "Users can read own usage" on usage_daily for select using (auth.uid() = user_id);
create policy "Users can CRUD own dali" on dali_memory for all using (auth.uid() = user_id);
create policy "Users can insert own events" on events for insert with check (auth.uid() = user_id);

-- 트리거: 새 사용자 생성 시 users 테이블에 자동 삽입
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
