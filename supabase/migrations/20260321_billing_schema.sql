-- ============================================
-- 몽글몽글 빌링 스키마 (v3: 광고 + 단건결제)
-- ============================================

-- 1) 사용자 권한 상태
create table if not exists public.user_entitlements (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  entitlement_key      text not null default 'free',
    -- free (기본)
  premium_credits      integer not null default 0,
    -- 프리미엄 해석 잔여 횟수
  source_platform      text,
    -- web / ios / android
  product_key          text,
    -- monggeul_plus_monthly / monggeul_premium_monthly
  status               text not null default 'inactive',
    -- active / grace / hold / expired / canceled / refunded
  current_period_start timestamptz,
  current_period_end   timestamptz,
  will_renew           boolean default true,
  auto_renew           boolean default true,
  last_verified_at     timestamptz,
  updated_at           timestamptz not null default now()
);

-- RLS: 본인만 읽기
alter table public.user_entitlements enable row level security;
create policy "Users read own entitlement"
  on public.user_entitlements for select
  using (auth.uid() = user_id);

-- service_role만 쓰기 (Edge Function에서 업데이트)
create policy "Service role manages entitlements"
  on public.user_entitlements for all
  using (auth.role() = 'service_role');

-- 2) 원본 거래 로그 (감사/디버깅/분쟁 대응)
create table if not exists public.billing_transactions (
  id                   bigint generated always as identity primary key,
  user_id              uuid references auth.users(id) on delete cascade,
  platform             text not null,
    -- stripe / apple / google
  platform_account_ref text,
    -- Stripe customer_id / Apple originalTransactionId / Google purchaseToken
  product_key          text not null,
  transaction_ref      text not null,
    -- Stripe invoice_id / Apple transaction_id / Google order_id
  event_type           text not null,
    -- purchased / renewed / failed / expired / refunded / revoked
  amount               numeric(12,2),
  currency             text default 'KRW',
  raw_payload          jsonb not null default '{}',
  occurred_at          timestamptz not null,
  created_at           timestamptz not null default now()
);

-- RLS: service_role만
alter table public.billing_transactions enable row level security;
create policy "Service role manages transactions"
  on public.billing_transactions for all
  using (auth.role() = 'service_role');

-- 3) 웹훅/알림 멱등성 (중복 수신 방지)
create table if not exists public.billing_events (
  event_id    text primary key,
  platform    text not null,
  event_type  text not null,
  payload     jsonb not null default '{}',
  processed   boolean not null default false,
  processed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- RLS: service_role만
alter table public.billing_events enable row level security;
create policy "Service role manages billing events"
  on public.billing_events for all
  using (auth.role() = 'service_role');

-- 4) 인덱스
create index if not exists idx_entitlements_status on public.user_entitlements(entitlement_key, status);
create index if not exists idx_transactions_user on public.billing_transactions(user_id, created_at desc);
create index if not exists idx_billing_events_processed on public.billing_events(processed, created_at);
