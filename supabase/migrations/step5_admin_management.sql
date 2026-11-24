-- ============================================================================
-- Step 5: Secure Administrator Management RPCs (Non-Destructive)
-- Siddipet Self Drive Cars
--
-- Run in Supabase Dashboard -> SQL Editor (as postgres).
--
-- Safety Guarantees:
-- - Preserves existing tables, vehicles, bookings, profiles, admin roles,
--   triggers, and RLS policies.
-- - Does NOT create administrator accounts or enable public admin signup.
-- - Only authenticated administrators verified by public.is_admin() may
--   list registered accounts or promote an existing registered account.
-- - Target accounts must have verified their email before promotion.
-- ============================================================================

-- 1. List existing registered accounts & administrators

DROP FUNCTION IF EXISTS public.admin_list_profiles();

CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permissions required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      ''
    )::text AS full_name,
    coalesce(u.email, '')::text AS email,
    coalesce(
      nullif(btrim(p.phone), ''),
      nullif(btrim(u.phone), ''),
      ''
    )::text AS phone,
    coalesce(nullif(btrim(p.role), ''), 'customer')::text AS role,
    coalesce(p.created_at, u.created_at) AS created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY
    CASE
      WHEN lower(coalesce(p.role, ''))
        IN ('admin', 'super_admin', 'administrator') THEN 0
      ELSE 1
    END,
    coalesce(p.created_at, u.created_at) DESC;
END;
$$;

ALTER FUNCTION public.admin_list_profiles() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_list_profiles()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_profiles()
TO authenticated;


-- 2. Promote an existing registered account to administrator

DROP FUNCTION IF EXISTS public.admin_promote_user_to_admin(text);

CREATE OR REPLACE FUNCTION public.admin_promote_user_to_admin(p_email text)
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text;
  v_user record;
  v_profile public.profiles;
BEGIN
  -- Only an authenticated existing administrator may promote accounts.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permissions required.'
      USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(coalesce(p_email, '')));

  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please enter a valid registered email address.';
  END IF;

  -- Find the existing account and check its email verification status.
  SELECT
    u.id,
    u.email,
    u.phone,
    u.email_confirmed_at,
    u.created_at,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      ''
    ) AS meta_name
  INTO v_user
  FROM auth.users u
  WHERE lower(coalesce(u.email, '')) = v_email
  LIMIT 1;

  -- Do not create new accounts.
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION
      'No existing registered account found for %. Public admin signup is disabled.',
      v_email;
  END IF;

  -- Email verification is mandatory before administrator promotion.
  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION
      'This account must verify its email address before receiving administrator access.';
  END IF;

  -- Create or promote the profile while preserving existing name and phone.
  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (
    v_user.id,
    v_user.meta_name,
    coalesce(v_user.phone, ''),
    'admin'
  )
  ON CONFLICT ON CONSTRAINT profiles_pkey
  DO UPDATE SET role = 'admin'
  RETURNING * INTO v_profile;

  RETURN QUERY
  SELECT
    v_profile.id,
    coalesce(
      nullif(btrim(v_profile.full_name), ''),
      v_user.meta_name,
      ''
    )::text AS full_name,
    coalesce(v_user.email, '')::text AS email,
    coalesce(
      nullif(btrim(v_profile.phone), ''),
      coalesce(v_user.phone, ''),
      ''
    )::text AS phone,
    v_profile.role::text AS role,
    coalesce(v_profile.created_at, v_user.created_at) AS created_at;
END;
$$;

ALTER FUNCTION public.admin_promote_user_to_admin(text)
OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_promote_user_to_admin(text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_promote_user_to_admin(text)
TO authenticated;

-- ============================================================================
-- END OF STEP 5 ADMIN MANAGEMENT MIGRATION
-- ============================================================================