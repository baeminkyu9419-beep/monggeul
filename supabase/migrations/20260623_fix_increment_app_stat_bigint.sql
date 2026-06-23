-- [RPC 형 정합 R3-#7: increment_app_stat = bigint 산술 단일화] 2026-06-23
--
-- 문제(실측 드리프트 — 20260619 가 value 형은 통일했으나 RPC 는 미정합):
--   같은 RPC increment_app_stat 가 두 init/마이그레이션에서 다르게 정의됐고,
--   파일명 타임스탬프 순서상 마지막 create-or-replace 가 20260321_app_stats.sql 의
--   text 캐스팅 버전으로 굳었다:
--     20260321_app_stats.sql:17  set value = (value::int + 1)::text, updated_at = now()
--   그런데 정본 테이블(0001_init_schema.sql) = app_stats(key text pk, value bigint) 이며
--   updated_at 컬럼이 없다(20260321 의 create table if not exists 는 0001 존재로 no-op →
--   updated_at 미생성). 게다가 20260619_unify_app_stats_value_type.sql 가 value 를 bigint
--   로 확정했다. 결과:
--     (a) value = (...)::text  → bigint 컬럼에 text 대입 → "column is of type bigint
--         but expression is of type text" 런타임 실패.
--     (b) updated_at = now()   → 존재하지 않는 컬럼 참조 → 런타임 실패.
--   즉 카운터 증가(total_dreams 등)가 live 에서 RPC 호출 시 깨진다(잠재 버그, DB 미실행
--   테스트에선 미검출). 이 파일은 20260619 직후 정렬되어(타임스탬프 20260623) 최종 정의를 잡는다.
--
-- 해결(멱등 — 어느 상태에서 흘러도 안전):
--   1) updated_at 컬럼을 ALTER ADD COLUMN IF NOT EXISTS 로 명시 보장(관측성 유지).
--   2) increment_app_stat 을 bigint 산술(value = app_stats.value + 1)로 단일 재정의 —
--      text 캐스팅 제거, upsert 로 행 부재 시에도 안전(0001 패턴과 정합).
--   3) search_path 고정(repo 하드닝 패턴 = use_credit/check_entitlement 동일).
--
-- 영향:
--   - 카운터 증가 RPC = bigint 일관 → 형 사고 제거.
--   - 데이터 손실 없음(컬럼 추가 + 함수 재정의만). value 기존값 보존.
--   - read 정책(select using true, 공개 카운터) 영향 없음.

alter table public.app_stats
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.increment_app_stat(stat_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_stats (key, value, updated_at)
  values (stat_key, 1, now())
  on conflict (key) do update
    set value = public.app_stats.value + 1,
        updated_at = now();
end;
$$;
