-- Used only by CI, against plain Postgres. Supabase provides these itself.
-- Minimal stand-in for the auth schema so migrations that reference
-- auth.users can run.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
