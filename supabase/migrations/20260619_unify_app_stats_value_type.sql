-- [형 정합 R2: app_stats.value 형 통일 = bigint] 2026-06-19
--
-- 문제(실측 드리프트):
--   같은 테이블 public.app_stats 가 두 init 경로에서 서로 다른 형으로 정의됐다.
--     - 0001_init_schema.sql        : value bigint default 0        (정본 init, 실 출시)
--     - 20260321_app_stats.sql      : value text not null default '0'
--   카운터 누적 RPC increment_app_stat 는 정수 증분을 기대한다:
--     - 0001: insert ... on conflict do update set value=app_stats.value+1  (bigint 산술)
--     - 20260321: update ... set value=(value::int + 1)::text             (text 캐스팅)
--   live DB 에 어느 형이 적용됐는지에 따라 다른 init 이 흘러도 형이 흔들린다.
--   schema.sql(정본 문서)도 본 불일치를 KNOWN ISSUE 로 남겨뒀었다(이번에 해소).
--
-- 해결(멱등 ALTER — text/bigint 어느 상태에서도 안전):
--   value 컬럼을 bigint 로 명시 통일하고 default 를 정수 0 으로 정렬한다.
--   USING value::bigint 로 text('0','1331' 등) 상태여도 무손실 변환된다.
--   already-bigint 인 경우에도 ALTER TYPE bigint USING value::bigint 는 NO-OP 수준(재정의).
--
-- 영향:
--   - increment_app_stat(0001 정본) = bigint 산술 → 형 일치로 안정화.
--   - read_stats 정책(select using true, 공개 카운터) = 형 무관, 영향 없음.
--   - 데이터 손실 없음(text→bigint 는 숫자 문자열 가정. app_stats 는 카운터 전용).
--
-- 순서: 파일명 타임스탬프(20260619) > 0001 / 20260321 → 두 init 적용 후 형 정규화 보장.

alter table public.app_stats
  alter column value type bigint using value::bigint;

alter table public.app_stats
  alter column value set default 0;

alter table public.app_stats
  alter column value set not null;
