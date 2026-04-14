-- 푸시 알림 구독 테이블 (Phase 3-3)
-- push-subscribe Edge Function에서 사용

-- 1. 푸시 구독 정보
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,              -- { p256dh, auth }
  prefs jsonb default '{"morning":true,"pattern":true,"dali_weekly":true}',
  created_at timestamptz default now(),
  last_sent_at timestamptz
);

-- 인덱스
create index if not exists idx_push_subs_user on push_subscriptions(user_id);
create index if not exists idx_push_subs_endpoint on push_subscriptions(endpoint);

-- RLS
alter table push_subscriptions enable row level security;

create policy "Users can read own subs" on push_subscriptions
  for select using (auth.uid() = user_id);
create policy "Anyone can insert subs" on push_subscriptions
  for insert with check (true);
create policy "Users can update own subs" on push_subscriptions
  for update using (auth.uid() = user_id);
create policy "Users can delete own subs" on push_subscriptions
  for delete using (auth.uid() = user_id);

-- 2. 반복꿈 예측 캐시 (패턴 알림용)
-- push-scheduler가 per-user 패턴 알림을 보내기 위한 캐시
create table if not exists dream_pattern_cache (
  user_id uuid references users(id) on delete cascade primary key,
  clusters jsonb default '[]',      -- detectRecurringClusters() 결과
  next_pattern_date date,           -- 가장 가까운 반복꿈 예측일
  updated_at timestamptz default now()
);

create index if not exists idx_pattern_cache_next on dream_pattern_cache(next_pattern_date);
