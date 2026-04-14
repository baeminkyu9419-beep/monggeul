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
create policy "Anyone can read products"
  on public.products for select using (true);
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
create policy "Users read own payments"
  on public.payments for select using (auth.uid() = user_id);
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
create policy "Users read own entitlements"
  on public.entitlements for select using (auth.uid() = user_id);
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
