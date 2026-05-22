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
