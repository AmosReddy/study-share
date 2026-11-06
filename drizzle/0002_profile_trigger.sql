-- Keeps public.profiles in step with auth.users. Runs as the function owner
-- (security definer) with an empty search_path, so every name is schema-qualified.
-- raw_user_meta_data is writable by the user, so only text values are read from it;
-- the accepted/confirmed timestamps always come from now(), never from metadata.
CREATE OR REPLACE FUNCTION public.handle_auth_user_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  explicit_name text := left(btrim(coalesce(meta ->> 'display_name', '')), 50);
  fallback_name text;
  terms text := nullif(btrim(coalesce(meta ->> 'terms_version', '')), '');
BEGIN
  IF tg_op = 'INSERT' THEN
    fallback_name := left(btrim(coalesce(
      nullif(btrim(coalesce(meta ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(meta ->> 'name', '')), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )), 50);
    INSERT INTO public.profiles (id, display_name, terms_version, terms_accepted_at, age_confirmed_at)
    VALUES (
      new.id,
      coalesce(nullif(explicit_name, ''), nullif(fallback_name, ''), 'New user'),
      terms,
      CASE WHEN terms IS NOT NULL THEN now() END,
      CASE WHEN terms IS NOT NULL THEN now() END
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    UPDATE public.profiles
    SET display_name = coalesce(nullif(explicit_name, ''), display_name),
        terms_version = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN terms ELSE terms_version END,
        terms_accepted_at = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN now() ELSE terms_accepted_at END,
        age_confirmed_at = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN now() ELSE age_confirmed_at END
    WHERE id = new.id;
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_change ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_change
AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();
