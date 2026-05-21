alter table usage_daily add column if not exists "count" int default 0;
alter table dali_memory add column if not exists chat jsonb default '[]'::jsonb;
alter table dali_memory add column if not exists memories jsonb default '[]'::jsonb;
notify pgrst, 'reload schema';
