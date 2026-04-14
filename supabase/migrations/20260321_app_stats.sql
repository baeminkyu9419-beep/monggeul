-- 앱 통계 테이블 (카운터 등)
create table if not exists public.app_stats (
  key text primary key,
  value text not null default '0',
  updated_at timestamptz not null default now()
);

-- 초기값
insert into public.app_stats (key, value) values ('total_dreams', '1331')
on conflict (key) do nothing;

-- 카운터 증가 함수
create or replace function increment_app_stat(stat_key text)
returns void as $$
begin
  update public.app_stats
  set value = (value::int + 1)::text, updated_at = now()
  where key = stat_key;
end;
$$ language plpgsql security definer;

-- RLS
alter table public.app_stats enable row level security;
create policy "Anyone can read app stats"
  on public.app_stats for select using (true);
create policy "Service role manages stats"
  on public.app_stats for all using (auth.role() = 'service_role');
