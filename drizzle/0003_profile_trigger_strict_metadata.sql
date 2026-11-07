-- Replaces the body of public.handle_auth_user_change() from 0002 (the trigger
-- itself is unchanged, so it is not recreated).
--
-- 0002's comment said only text values were read from raw_user_meta_data. That was
-- wrong: ->> turns numbers, booleans, objects and arrays into text, so
-- {"terms_version": false} was stamped as accepted. raw_user_meta_data is writable
-- by the user, so now each of display_name, full_name, name and terms_version is
-- read only when jsonb_typeof(...) = 'string'; any other type counts as absent.
-- A value that is blank after trimming also counts as absent. terms_version is
-- capped at 64 characters and display_name at 50. The accepted/confirmed
-- timestamps still come only from now(), are set once, and are never read from
-- metadata.
CREATE OR REPLACE FUNCTION public.handle_auth_user_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := CASE
    WHEN jsonb_typeof(new.raw_user_meta_data) = 'object' THEN new.raw_user_meta_data
    ELSE '{}'::jsonb
  END;
  explicit_name text := CASE WHEN jsonb_typeof(meta -> 'display_name') = 'string'
    THEN nullif(left(btrim(meta ->> 'display_name'), 50), '') END;
  full_name text := CASE WHEN jsonb_typeof(meta -> 'full_name') = 'string'
    THEN nullif(left(btrim(meta ->> 'full_name'), 50), '') END;
  short_name text := CASE WHEN jsonb_typeof(meta -> 'name') = 'string'
    THEN nullif(left(btrim(meta ->> 'name'), 50), '') END;
  terms text := CASE WHEN jsonb_typeof(meta -> 'terms_version') = 'string'
    THEN nullif(left(btrim(meta ->> 'terms_version'), 64), '') END;
BEGIN
  IF tg_op = 'INSERT' THEN
    INSERT INTO public.profiles (id, display_name, terms_version, terms_accepted_at, age_confirmed_at)
    VALUES (
      new.id,
      coalesce(
        explicit_name,
        full_name,
        short_name,
        nullif(left(btrim(split_part(coalesce(new.email, ''), '@', 1)), 50), ''),
        'New user'
      ),
      terms,
      CASE WHEN terms IS NOT NULL THEN now() END,
      CASE WHEN terms IS NOT NULL THEN now() END
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    UPDATE public.profiles
    SET display_name = coalesce(explicit_name, display_name),
        terms_version = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN terms ELSE terms_version END,
        terms_accepted_at = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN now() ELSE terms_accepted_at END,
        age_confirmed_at = CASE WHEN terms_accepted_at IS NULL AND terms IS NOT NULL THEN now() ELSE age_confirmed_at END
    WHERE id = new.id;
  END IF;
  RETURN new;
END;
$$;
