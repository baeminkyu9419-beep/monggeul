-- serverless 안전 rate limit (분당 카운터). openai-proxy in-memory _rateMap 대체.
create table if not exists rate_limit (user_id uuid, window_min timestamptz, cnt int default 0, primary key (user_id, window_min));
alter table rate_limit enable row level security;
create or replace function check_rate_limit(p_user_id uuid, p_max int) returns boolean language plpgsql security definer as $$
declare w timestamptz; c int;
begin
  w := date_trunc('minute', now());
  insert into rate_limit(user_id, window_min, cnt) values (p_user_id, w, 1)
    on conflict(user_id, window_min) do update set cnt = rate_limit.cnt + 1
    returning cnt into c;
  return c <= p_max;
end; $$;
