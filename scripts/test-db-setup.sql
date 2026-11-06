-- Used only by CI, against plain Postgres. Supabase provides these itself.
-- Minimal stand-in for the auth schema so migrations that reference
-- auth.users can run, and the profile trigger has the columns it reads.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
