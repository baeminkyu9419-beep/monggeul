-- ============================================
-- 몽글몽글 빌링 스키마 선별 적용 (products/payments/entitlements + RPC + 상품 시드)
-- 20260324_payment_system + 20260407_reconcile_products 통합. 멱등(재실행 안전).
-- 적용: Supabase Dashboard > SQL Editor 에 붙여넣기 실행 (1회).
-- ============================================

-- ============================================
-- 몽글몽글 결제 시스템 v4: 한국형 PG 통합
-- Stripe(카드) + 토스페이먼츠(카카오/네이버/계좌이체)
-- ============================================

-- 1) 상품 정의
create table if not exists public.products (
  id         text primary key,
    -- 'pack_1', 'pack_5', 'pack_10', 'starlight_monthly' 등
  name       text not null,
  type       text not null check (type in ('pack', 'subscription')),
  price      integer not null,
    -- KRW 기준 (500, 1900, 3500, 4900 등)
  count      integer,
    -- pack일 때 횟수 (1, 5, 10). subscription은 null
  duration_days integer,
    -- subscription일 때 기간 (30). pack은 null
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- 기본 상품 데이터 (가격은 추후 조정)
insert into public.products (id, name, type, price, count, duration_days) values
  ('pack_1',   '단건 해석',     'pack', 500,  1,  null),
  ('pack_5',   '해석팩 5회',    'pack', 1900, 5,  null),
  ('pack_10',  '해석팩 10회',   'pack', 3500, 10, null),
  ('starlight_monthly', '별빛 월간 구독', 'subscription', 4900, null, 30)
on conflict (id) do nothing;

-- RLS: 모두 읽기 가능 (상품 목록은 공개)
alter table public.products enable row level security;
drop policy if exists "Anyone can read products" on public.products;
create policy "Anyone can read products"
  on public.products for select using (true);
drop policy if exists "Service role manages products" on public.products;
create policy "Service role manages products"
  on public.products for all using (auth.role() = 'service_role');

-- 2) 결제 내역 (PG 통합)
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_id     text unique not null,
    -- 클라이언트 생성 주문번호 (MG_{timestamp}_{random})
  pg           text not null check (pg in ('stripe', 'toss', 'apple', 'google')),
  method       text,
    -- 'card', 'kakaopay', 'naverpay', 'transfer', 'toss_pay' 등
  payment_key  text,
    -- 토스: paymentKey / Stripe: payment_intent_id
  product_id   text not null references public.products(id),
  amount       integer not null,
  status       text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'failed', 'refunded')),
  billing_key  text,
    -- 정기결제용 빌링키 (토스 billingKey / Stripe subscription_id)
  raw_response jsonb default '{}',
    -- PG 응답 원본 (디버깅/분쟁용)
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- RLS
alter table public.payments enable row level security;
drop policy if exists "Users read own payments" on public.payments;
create policy "Users read own payments"
  on public.payments for select using (auth.uid() = user_id);
drop policy if exists "Service role manages payments" on public.payments;
create policy "Service role manages payments"
  on public.payments for all using (auth.role() = 'service_role');

create index if not exists idx_payments_user on public.payments(user_id, created_at desc);
create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_payments_status on public.payments(status, created_at);

-- 3) 통합 권한 (entitlements v2 — 구독 + 팩 공존)
--    기존 user_entitlements는 유지 (하위호환)
--    새 entitlements 테이블은 여러 행 가능 (팩 + 구독 동시 보유)
create table if not exists public.entitlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('subscription', 'pack')),
  product_id   text not null references public.products(id),
  payment_id   uuid references public.payments(id),
    -- 어떤 결제로 생성된 권한인지
  remaining    integer,
    -- pack: 잔여 횟수, subscription: null
  expires_at   timestamptz,
    -- subscription: 만료일, pack: null (횟수 소진 시 비활성)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- RLS
alter table public.entitlements enable row level security;
drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements"
  on public.entitlements for select using (auth.uid() = user_id);
drop policy if exists "Service role manages entitlements" on public.entitlements;
create policy "Service role manages entitlements"
  on public.entitlements for all using (auth.role() = 'service_role');

create index if not exists idx_entitlements_user on public.entitlements(user_id, is_active);

-- 4) 권한 확인 함수 (PG 무관 통합 판정)
create or replace function check_entitlement(p_user_id uuid)
returns jsonb as $$
declare
  v_sub record;
  v_pack_credits integer;
  v_result jsonb;
begin
  -- 활성 구독 확인
  select * into v_sub
  from public.entitlements
  where user_id = p_user_id
    and type = 'subscription'
    and is_active = true
    and expires_at > now()
  order by expires_at desc
  limit 1;

  -- 팩 잔여 횟수 합산
  select coalesce(sum(remaining), 0) into v_pack_credits
  from public.entitlements
  where user_id = p_user_id
    and type = 'pack'
    and is_active = true
    and remaining > 0;

  v_result := jsonb_build_object(
    'has_subscription', v_sub is not null,
    'subscription_expires', v_sub.expires_at,
    'pack_credits', v_pack_credits,
    'can_use', (v_sub is not null) or (v_pack_credits > 0)
  );

  return v_result;
end;
$$ language plpgsql security definer;

-- 5) 팩 크레딧 차감 함수
create or replace function use_pack_credit(p_user_id uuid)
returns boolean as $$
declare
  v_ent_id uuid;
begin
  -- 가장 오래된 활성 팩에서 1회 차감
  select id into v_ent_id
  from public.entitlements
  where user_id = p_user_id
    and type = 'pack'
    and is_active = true
    and remaining > 0
  order by created_at asc
  limit 1
  for update;

  if v_ent_id is null then
    return false;
  end if;

  update public.entitlements
  set remaining = remaining - 1,
      is_active = case when remaining - 1 <= 0 then false else true end
  where id = v_ent_id;

  return true;
end;
$$ language plpgsql security definer;
-- ============================================
-- 상품 카탈로그 정합: CLAUDE.md 과금 체계 기준으로 통일
-- 기존 migration(20260324)의 가격/ID를 payment.js PRODUCT_CATALOG과 맞춤
-- Source of truth: CLAUDE.md Phase 3-1 과금 체계
-- ============================================

-- 1) CHECK 제약 갱신: 'one_time' 타입 허용 (무의식 프로파일용)
-- 기존 CHECK: type in ('pack', 'subscription')
alter table public.products drop constraint if exists products_type_check;
alter table public.products add constraint products_type_check
  check (type in ('pack', 'subscription', 'one_time'));

-- 2) 기존 불일치 상품 비활성화 (pack_10, starlight_monthly는 CLAUDE.md에 없음)
update public.products set is_active = false
where id in ('pack_10', 'starlight_monthly');

-- 3) CLAUDE.md 기준 5개 상품 upsert
-- pack_1: 500 -> 1900, pack_5: 1900 -> 7900, pack_15 신규, unconscious_profile 신규, pro_monthly 신규
insert into public.products (id, name, type, price, count, duration_days) values
  ('pack_1',              '상세 해몽 1회',      'pack',         1900,  1,    null),
  ('pack_5',              '상세 해몽 5회 팩',    'pack',         7900,  5,    null),
  ('pack_15',             '상세 해몽 15회 팩',   'pack',         19900, 15,   null),
  ('unconscious_profile', '무의식 프로파일',     'one_time',     2900,  null, null),
  ('pro_monthly',         '프로 월간 구독',      'subscription', 9900,  null, 30),
  -- payment.js PRODUCT_CATALOG 정합: Plus/Premium 구독 (pro_monthly = plus_monthly alias)
  ('plus_monthly',        'Plus 월간 구독',     'subscription', 3900,  null, 30),
  ('premium_monthly',     'Premium 월간 구독',  'subscription', 19900, null, 30)
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  price = excluded.price,
  count = excluded.count,
  duration_days = excluded.duration_days,
  is_active = true;
