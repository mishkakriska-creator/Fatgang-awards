-- The caller runs this in one transaction, before accepting traffic.
select pg_advisory_xact_lock(160622026);
set local search_path = public, pg_catalog;
create table if not exists users(id serial primary key,name text unique not null,hash text not null);
create table if not exists ballots(user_id integer references users(id),category text,choices jsonb not null,primary key(user_id,category));
create table if not exists session(sid varchar primary key,sess json not null,expire timestamp not null);
-- Check the legacy contract before extending it. Errors roll back the migration.
select id, lower(name), length(hash) from users limit 0;
select user_id, category, jsonb_array_length(choices) from ballots limit 0;
select sid, sess::json, expire - now() from session limit 0;
alter table ballots add column if not exists browser_key text;
alter table ballots add column if not exists fingerprint_key text;
create unique index if not exists ballots_browser_key_unique on ballots(browser_key) where browser_key is not null;
create index if not exists ballots_fp on ballots(fingerprint_key) where fingerprint_key is not null;
create index if not exists "IDX_session_expire" on session(expire);
create table if not exists award_limits(bucket text primary key,until_at timestamptz not null,hits integer not null);
create table if not exists award_activity(hour timestamptz not null,kind text not null,action text not null,category text not null,hits bigint not null,primary key(hour,kind,action,category));
create table if not exists award_device_accounts(device_key text primary key,user_id integer not null references users(id));
do $$
declare t text; r text;
begin
 foreach t in array array['users','ballots','session','award_limits','award_activity','award_device_accounts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public',t);
  for r in select rolname from pg_roles where rolname in ('anon','authenticated') loop
   execute format('revoke all on public.%I from %I',t,r);
   if has_any_column_privilege(r,format('public.%I',t),'select,insert,update,references') or has_table_privilege(r,format('public.%I',t),'delete,truncate,trigger') then
    raise exception 'Unexpected inherited or column grant on % for %',t,r;
   end if;
  end loop;
 end loop;
end $$;
