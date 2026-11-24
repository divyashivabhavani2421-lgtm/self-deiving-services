-- ============================================================================
-- Step 3: Safe, Non-Destructive SQL Migration for Phone OTP Auth & Profiles
-- Siddipet Self Drive Cars
--
-- Actual public.profiles columns:
--   id, full_name, phone, role, created_at
--
-- IMPORTANT:
-- - Do NOT delete or recreate any tables.
-- - Preserves all existing bookings, vehicles, customer profiles, and admin roles
--   (including Parvathi's admin access).
-- - Preserves all existing SELECT and UPDATE RLS policies on public.profiles.
-- - Leaves existing trigger trg_prevent_profile_role_self_escalation untouched.
-- - Prevents client-side role self-escalation on INSERT.
-- - Provides an idempotent SECURITY DEFINER RPC `ensure_customer_profile`
--   so newly verified phone-OTP users always get a `'customer'` profile row
--   without overwriting existing profiles or admin roles.
-- ============================================================================

-- 1. Ensure RLS remains enabled on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Prevent non-admin users from inserting any role other than 'customer'
CREATE OR REPLACE FUNCTION public.prevent_profile_role_insert_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow database migrations / service role (auth.uid() IS NULL) or trusted admins
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.role := 'customer';
  ELSIF NEW.role IS NULL OR btrim(NEW.role) = '' THEN
    NEW.role := 'customer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_role_insert_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_role_insert_escalation
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_insert_escalation();

-- 3. Add a safe INSERT policy for authenticated users creating their own customer profile,
--    only if one does not already exist. Existing SELECT and UPDATE policies are left untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can insert own customer profile'
  ) THEN
    CREATE POLICY "Users can insert own customer profile"
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = id
        AND lower(coalesce(role, 'customer')) = 'customer'
      );
  END IF;
END;
$$;

-- 4. Idempotent RPC to safely ensure a customer profile after Phone OTP verification
--    - Requires auth.uid().
--    - Preserves existing full_name, phone, and role (never overwrites admin).
--    - Only updates phone when existing profile phone is blank and auth.users.phone is available.
--    - Creates a missing profile with role = 'customer' and verified phone from auth.users.
CREATE OR REPLACE FUNCTION public.ensure_customer_profile(p_full_name text DEFAULT NULL)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_auth_phone text;
  v_meta_name text;
  v_resolved_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT
    u.phone,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
  INTO v_auth_phone, v_meta_name
  FROM auth.users u
  WHERE u.id = v_uid;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;

  IF v_profile.id IS NOT NULL THEN
    -- Preserve existing full_name and role untouched; backfill phone only if currently blank
    IF coalesce(btrim(v_profile.phone), '') = '' AND coalesce(btrim(v_auth_phone), '') <> '' THEN
      UPDATE public.profiles
      SET phone = v_auth_phone
      WHERE id = v_uid
      RETURNING * INTO v_profile;
    END IF;
    RETURN v_profile;
  END IF;

  v_resolved_name := coalesce(nullif(btrim(p_full_name), ''), nullif(btrim(v_meta_name), ''), '');

  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (
    v_uid,
    v_resolved_name,
    coalesce(v_auth_phone, ''),
    'customer'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_profile;

  IF v_profile.id IS NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_customer_profile(text) TO authenticated;
