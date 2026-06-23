-- =============================================================================
-- 몽글몽글 — DB 스키마 정본 문서 (CANONICAL STATE DOC) — 2026-06-18 reconcile
-- =============================================================================
-- ★ 본 파일은 "현재 live DB 상태를 기술하는 문서"다. 적용 경로(apply path)가 아니다.
--   실제 마이그레이션 정본 = supabase/migrations/*.sql (config.toml db.migrations.enabled=true).
--   init 정본 = supabase/migrations/0001_init_schema.sql (b32efb0, 실 출시).
--   본 schema.sql 은 0001 + 후속 마이그레이션 누적을 사람이 읽기 쉽게 통합 문서화한 것이다.
--   → 새 변경은 반드시 migrations/ 에 타임스탬프 파일로 추가하고, 그 결과를 본 문서에 반영한다.
--   → 본 문서를 SQL Editor 에 그대로 붙여 라이브에 재실행하지 말 것(드리프트 위험).
--
-- 정합 근거(런타임 ↔ 스키마):
--   - src/services/auth.js : dali_memory 에 { memories, chat } upsert → chat 컬럼(jsonb)
--   - src/tabs/dream.js    : dreams 에 badges/emotions/keywords/result/radar_data 매핑(jsonb)
--   - 옛 디자인(text[], chat_history, subscription_tier) = 20260320000000_init_schema.sql(DEPRECATED).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- §1. 코어 테이블 (init 정본 = 0001_init_schema.sql)
-- ─────────────────────────────────────────────────────────────────────────

-- 1. 사용자
create table if not exists users (
  id uuid primary key,
  nickname text,
  created_at timestamptz default now()
);

-- 2. 꿈 기록 (배열은 jsonb — 0001 정본 + 0002_fix_columns 누적)
create table if not exists dreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  content text,
  title text,
  badges jsonb default '[]'::jsonb,
  emotions jsonb default '[]'::jsonb,
  keywords jsonb default '[]'::jsonb,   -- src/tabs/dream.js _dreamRow 매핑(고도화)
  result jsonb,                          -- AI 해몽 결과 전체
  radar_data jsonb,                      -- 6축 스탯
  created_at timestamptz default now()
);

-- 3. 달이 메모리 (chat 컬럼 — 런타임 auth.js 정합. chat_history 아님)
create table if not exists dali_memory (
  user_id uuid primary key,
  memories jsonb default '[]'::jsonb,
  chat jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- 4. 해몽 사용량 (일별). count = increment_dream_count RPC 만 갱신
create table if not exists usage_daily (
  user_id uuid,
  date date default current_date,
  count int default 0,
  primary key (user_id, date)
);

-- 5. 이벤트 로그
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event text,
  props jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 6. 반복꿈 예측 캐시 (push-scheduler 패턴 알림용)
create table if not exists dream_pattern_cache (
  user_id uuid primary key,
  pattern jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- §2. 커뮤니티 (0001 + 20260407_community_realtime 누적)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  avatar text default 'a1',
  post_type text default '꿈기록',  -- '꿈기록' | '질문' | '일상' | 'bot'
  title text not null,
  body text not null,
  tag text,
  badges jsonb default '[]'::jsonb,
  stats jsonb default '{}'::jsonb,
  similar jsonb,                    -- 봇 게시물(0004_community_fixes)
  anon_mode text default 'anon',
  like_count integer default 0,
  comment_count integer default 0,
  created_at timestamptz default now()
);

create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  nick text not null default '꿈탐험가',
  icon text default '🌙',
  body text not null,
  created_at timestamptz default now()
);

create table if not exists community_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references community_posts(id) on delete cascade,
  comment_id uuid references community_comments(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  reaction_type text not null,
  created_at timestamptz default now(),
  unique(post_id, user_id, reaction_type, comment_id)
);

-- 커뮤니티 인덱스
create index if not exists idx_posts_created on community_posts(created_at desc);
create index if not exists idx_posts_tag on community_posts(tag);
create index if not exists idx_posts_popularity on community_posts(like_count desc, created_at desc);
create index if not exists idx_comments_post on community_comments(post_id, created_at);
create index if not exists idx_reactions_post on community_reactions(post_id);

-- ─────────────────────────────────────────────────────────────────────────
-- §3. 수익/권한 — app_stats (20260321_app_stats)
-- ─────────────────────────────────────────────────────────────────────────
-- ★ 형 정합(RESOLVED 2026-06-19): 0001 정본(bigint) vs 20260321_app_stats(text) 드리프트를
--   20260619_unify_app_stats_value_type.sql 이 bigint 로 명시 통일(ALTER ... TYPE bigint
--   USING value::bigint, default 0). 카운터 누적 RPC increment_app_stat 가 정수 증분(value+1)을
--   기대하므로 bigint 가 정본이며, live 형도 본 마이그레이션 적용 후 bigint 로 수렴한다.
create table if not exists app_stats (
  key text primary key,
  value bigint default 0
);

-- ─────────────────────────────────────────────────────────────────────────
-- §4. 수익/권한 — entitlements v1/v2 (20260321_billing_schema, 20260324_payment_system)
-- ─────────────────────────────────────────────────────────────────────────

-- v1: 단일행 권한(구독 상태 + 팩 크레딧). 티어/크레딧 판정 정본 테이블.
create table if not exists user_entitlements (
  user_id              uuid primary key,
  entitlement_key      text default 'free',
  premium_credits      integer default 0,
  source_platform      text,
  product_key          text,
  status               text default 'inactive',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  will_renew           boolean default true,
  auto_renew           boolean default true,
  last_verified_at     timestamptz,
  updated_at           timestamptz default now()
);

-- 상품 카탈로그 (20260324_payment_system + 20260407_reconcile_products)
create table if not exists products (
  id            text primary key,
  name          text not null,
  type          text not null check (type in ('pack', 'subscription', 'one_time')),
  price         integer not null,
  count         integer,
  duration_days integer,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 결제 내역 (PG 통합: stripe/toss/apple/google)
create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_id     text unique not null,
  pg           text not null check (pg in ('stripe', 'toss', 'apple', 'google')),
  method       text,
  payment_key  text,
  product_id   text not null references products(id),
  amount       integer not null,
  status       text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'failed', 'refunded')),
  billing_key  text,
  raw_response jsonb default '{}',
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- v2 권한 (구독 + 팩 다중행 공존). check_entitlement/use_pack_credit 가 읽음.
create table if not exists entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('subscription', 'pack')),
  product_id text not null references products(id),
  payment_id uuid references payments(id),
  remaining  integer,
  expires_at timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- 빌링 감사/멱등 (20260321_billing_schema)
create table if not exists billing_transactions (
  id                   bigint generated always as identity primary key,
  user_id              uuid references auth.users(id) on delete cascade,
  platform             text not null,
  platform_account_ref text,
  product_key          text not null,
  transaction_ref      text not null,
  event_type           text not null,
  amount               numeric(12,2),
  currency             text default 'KRW',
  raw_payload          jsonb not null default '{}',
  occurred_at          timestamptz not null,
  created_at           timestamptz not null default now()
);

create table if not exists billing_events (
  event_id     text primary key,
  platform     text not null,
  event_type   text not null,
  payload      jsonb not null default '{}',
  processed    boolean not null default false,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- §5. 그로스 (20260321_growth_schema)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists referrals (
  id            bigint generated always as identity primary key,
  referrer_code text not null,
  referred_user uuid references auth.users(id) on delete cascade,
  converted_at  timestamptz not null default now(),
  rewarded      boolean default false
);

create table if not exists funnel_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  step        text not null,
  occurred_at timestamptz not null default now(),
  properties  jsonb default '{}'
);

create table if not exists ad_revenue (
  id          bigint generated always as identity primary key,
  date        date not null,
  platform    text not null,
  ad_type     text not null,
  impressions integer default 0,
  clicks      integer default 0,
  revenue_usd numeric(10,4) default 0,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- §6. 인프라 (20260407_push_subscriptions, 0003_rate_limit)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade,
  endpoint     text not null unique,
  keys         jsonb not null,
  prefs        jsonb default '{"morning":true,"pattern":true,"dali_weekly":true}',
  created_at   timestamptz default now(),
  last_sent_at timestamptz
);

create table if not exists rate_limit (
  user_id    uuid,
  window_min timestamptz,
  cnt        int default 0,
  primary key (user_id, window_min)
);

-- =============================================================================
-- §7. RLS / RPC / 트리거 — 정본 = migrations/ 각 파일. 보안 하드닝 누적은 아래 참조.
-- =============================================================================
-- RLS 정책/RPC 의 권위 있는 정의는 다음 마이그레이션에 있다(본 문서는 색인):
--   - 0001_init_schema.sql                       : 기본 RLS(own_* / read_* / ins_*) + RPC
--   - 20260408_drop_legacy_permissive.sql        : community_posts IDOR(upd_posts) 차단
--   - 20260613_anon_error_events.sql             : 익명 에러 이벤트 적재 허용
--   - 20260614_drop_self_write_entitlements.sql  : user_entitlements 자기쓰기(결제우회) 차단
--   - 20260615_fix_rpc_idor.sql                  : toggle_post_like/increment_dream_count auth.uid() 강제
--   - 20260615_harden_use_pack_credit.sql        : use_pack_credit IDOR 차단 + EXECUTE 제한
--   - 20260615_use_credit_rpc.sql                : use_credit() 서버권위 차감
--   - 20260616_add_credits_rpc.sql               : add_credits() 원자 적립
--   - 20260616_fix_check_entitlement_idor.sql    : check_entitlement IDOR 차단
--   - 20260619_unify_app_stats_value_type.sql    : app_stats.value 형 통일(text↔bigint → bigint)
--   - 20260619_harden_push_subscriptions_insert.sql : push_subscriptions permissive insert(with check true)
--                                                  → user_id=auth.uid() 격리(타인 user_id 위조 적재 차단)
--   - 20260623_harden_check_rate_limit_idor.sql  : check_rate_limit auth.uid() 강제 + PUBLIC EXECUTE 회수
--                                                  → 임의 p_user_id rate-limit DoS + anon 호출 차단
-- =============================================================================
