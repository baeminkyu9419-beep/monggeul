-- ============================================
-- 몽글몽글 그로스/수익 추적 스키마
-- ============================================

-- 레퍼럴 추적
create table if not exists public.referrals (
  id            bigint generated always as identity primary key,
  referrer_code text not null,
  referred_user uuid references auth.users(id) on delete cascade,
  converted_at  timestamptz not null default now(),
  rewarded      boolean default false
);

create index if not exists idx_referrals_code on public.referrals(referrer_code);

alter table public.referrals enable row level security;
create policy "Service role manages referrals"
  on public.referrals for all
  using (auth.role() = 'service_role');

-- 전환 퍼널 (집계용)
create table if not exists public.funnel_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  step       text not null,
    -- app_opened / first_dream / second_dream / paywall_seen / checkout_started / converted
  occurred_at timestamptz not null default now(),
  properties jsonb default '{}'
);

create index if not exists idx_funnel_user on public.funnel_events(user_id, step);
create index if not exists idx_funnel_step on public.funnel_events(step, occurred_at desc);

alter table public.funnel_events enable row level security;
create policy "Service role manages funnel"
  on public.funnel_events for all
  using (auth.role() = 'service_role');

-- 광고 수익 로그 (AdMob 보고서 동기화용)
create table if not exists public.ad_revenue (
  id         bigint generated always as identity primary key,
  date       date not null,
  platform   text not null, -- ios / android / web
  ad_type    text not null, -- banner / interstitial / rewarded
  impressions integer default 0,
  clicks      integer default 0,
  revenue_usd numeric(10,4) default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ad_revenue_date on public.ad_revenue(date desc, platform);

alter table public.ad_revenue enable row level security;
create policy "Service role manages ad revenue"
  on public.ad_revenue for all
  using (auth.role() = 'service_role');

-- 일별 수익 요약 뷰
create or replace view public.daily_revenue_summary as
select
  date,
  sum(case when ad_type = 'banner' then revenue_usd else 0 end) as banner_revenue,
  sum(case when ad_type = 'interstitial' then revenue_usd else 0 end) as interstitial_revenue,
  sum(case when ad_type = 'rewarded' then revenue_usd else 0 end) as rewarded_revenue,
  sum(revenue_usd) as total_ad_revenue,
  sum(impressions) as total_impressions,
  sum(clicks) as total_clicks
from public.ad_revenue
group by date
order by date desc;
