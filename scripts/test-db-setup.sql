-- Used only by CI, against plain Postgres. Supabase provides these itself.
-- Minimal stand-in for the auth schema so migrations that reference
-- auth.users can run, and the profile trigger and the account directory
-- have the columns they read. Real Supabase has many more columns.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
-- Columns the account directory reads (an older stand-in lacks them).
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;

-- Like Supabase: deleting a user deletes their identities. provider_id and the
-- (provider_id, provider) uniqueness match the real table; its other columns are not used.
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}',
  unique (provider_id, provider)
);
