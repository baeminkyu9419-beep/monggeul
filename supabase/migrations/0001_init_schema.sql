-- 몽글몽글 실 출시 스키마 (11 테이블 + RLS + RPC). 멱등(IF NOT EXISTS).

create table if not exists users (id uuid primary key, nickname text, created_at timestamptz default now());
create table if not exists dreams (id uuid primary key default gen_random_uuid(), user_id uuid, content text, title text, badges jsonb default '[]'::jsonb, emotions jsonb default '[]'::jsonb, created_at timestamptz default now());
create table if not exists dali_memory (user_id uuid primary key, memories jsonb default '[]'::jsonb, chat jsonb default '[]'::jsonb, updated_at timestamptz default now());
create table if not exists community_posts (id uuid primary key default gen_random_uuid(), user_id uuid, nick text, icon text, avatar text, post_type text, title text, body text, tag text, badges jsonb default '[]'::jsonb, stats jsonb default '{}'::jsonb, anon_mode text, like_count int default 0, comment_count int default 0, created_at timestamptz default now());
create table if not exists community_comments (id uuid primary key default gen_random_uuid(), post_id uuid, user_id uuid, nick text, body text, created_at timestamptz default now());
create table if not exists community_reactions (id uuid primary key default gen_random_uuid(), post_id uuid, user_id uuid, type text, created_at timestamptz default now());
create table if not exists user_entitlements (user_id uuid primary key, premium_credits int default 0, entitlement_key text, status text, updated_at timestamptz default now());
create table if not exists app_stats (key text primary key, value bigint default 0);
create table if not exists usage_daily (user_id uuid, date date, count int default 0, primary key (user_id, date));
create table if not exists events (id uuid primary key default gen_random_uuid(), user_id uuid, event text, props jsonb default '{}'::jsonb, created_at timestamptz default now());
create table if not exists dream_pattern_cache (user_id uuid primary key, pattern jsonb default '{}'::jsonb, updated_at timestamptz default now());

alter table users enable row level security;
alter table dreams enable row level security;
alter table dali_memory enable row level security;
alter table community_posts enable row level security;
alter table community_comments enable row level security;
alter table community_reactions enable row level security;
alter table user_entitlements enable row level security;
alter table app_stats enable row level security;
alter table usage_daily enable row level security;
alter table events enable row level security;
alter table dream_pattern_cache enable row level security;

do $$ begin
  -- 본인 데이터 CRUD
  if not exists (select 1 from pg_policies where policyname='own_users') then create policy "own_users" on users for all to authenticated using (id=auth.uid()) with check (id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='own_dreams') then create policy "own_dreams" on dreams for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='own_mem') then create policy "own_mem" on dali_memory for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='own_ent') then create policy "own_ent" on user_entitlements for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='own_usage') then create policy "own_usage" on usage_daily for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='own_pattern') then create policy "own_pattern" on dream_pattern_cache for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='ins_events') then create policy "ins_events" on events for insert to authenticated with check (true); end if;
  -- 커뮤니티: 공개 read + 본인 write
  if not exists (select 1 from pg_policies where policyname='read_posts') then create policy "read_posts" on community_posts for select using (true); end if;
  if not exists (select 1 from pg_policies where policyname='ins_posts') then create policy "ins_posts" on community_posts for insert to authenticated with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='upd_posts') then create policy "upd_posts" on community_posts for update to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where policyname='read_comments') then create policy "read_comments" on community_comments for select using (true); end if;
  if not exists (select 1 from pg_policies where policyname='ins_comments') then create policy "ins_comments" on community_comments for insert to authenticated with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='read_reactions') then create policy "read_reactions" on community_reactions for select using (true); end if;
  if not exists (select 1 from pg_policies where policyname='ins_reactions') then create policy "ins_reactions" on community_reactions for insert to authenticated with check (user_id=auth.uid()); end if;
  if not exists (select 1 from pg_policies where policyname='del_reactions') then create policy "del_reactions" on community_reactions for delete to authenticated using (user_id=auth.uid()); end if;
  -- app_stats 공개 read
  if not exists (select 1 from pg_policies where policyname='read_stats') then create policy "read_stats" on app_stats for select using (true); end if;
end $$;

-- RPC (plpgsql security definer = 런타임 검증, RLS 우회 카운터 갱신)
create or replace function increment_app_stat(stat_key text) returns void language plpgsql security definer as $$ begin insert into app_stats(key,value) values (stat_key,1) on conflict(key) do update set value=app_stats.value+1; end; $$;
create or replace function increment_dream_count(p_user_id uuid) returns void language plpgsql security definer as $$ begin insert into usage_daily(user_id,date,"count") values (p_user_id,current_date,1) on conflict(user_id,date) do update set "count"=usage_daily."count"+1; end; $$;
create or replace function check_entitlement(p_user_id uuid) returns jsonb language plpgsql security definer as $$ begin return coalesce((select jsonb_build_object('has_subscription', status='active', 'pack_credits', coalesce(premium_credits,0), 'entitlement_key', entitlement_key) from user_entitlements where user_id=p_user_id), jsonb_build_object('has_subscription',false,'pack_credits',0)); end; $$;
