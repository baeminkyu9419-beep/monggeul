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
