-- Small stand-ins for the parts of a NEW Supabase project that setup.sql and demo_data.sql expect, so both can be loaded
-- into an in-process test database (PGlite). NOT real Supabase: there is no real login service, storage engine, Vault
-- encryption, pg_net or Realtime here. Used only by supabase/tests/run-setup-tests.mjs.

-- Roles the API uses (service_role skips row level security, like on Supabase).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase gives the API roles full rights on new tables, functions and sequences in public (row level security still applies).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Extensions live in their own schema on Supabase.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- auth: the columns of auth.users / auth.identities that the scripts write.
create schema if not exists auth;
create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), phone text,
  confirmation_token text default '', recovery_token text default '', email_change_token_new text default '', email_change text default '',
  email_change_token_current text default '', phone_change text default '', phone_change_token text default '', reauthentication_token text default ''
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  unique (provider_id, provider)
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claim.role', true), current_user::text) $$;
grant usage on schema auth to anon, authenticated, service_role;

-- storage: buckets, files and the folder helper.
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select coalesce((string_to_array(name, '/'))[1:greatest(coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1, 0)], '{}') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

-- Realtime.
create publication supabase_realtime;

-- Vault stand-in (real Supabase encrypts; this just stores).
create schema if not exists vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid
  language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void
  language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
revoke all on schema vault from public;

-- pg_net stand-in: records each call instead of sending it.
create schema if not exists net;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb, at timestamptz default now());
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000) returns bigint
  language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
grant usage on schema net to anon, authenticated, service_role;
