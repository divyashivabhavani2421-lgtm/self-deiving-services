-- ============================================================================
-- Phase 4: Safe, Idempotent Migration for Admin Vehicle Management & Storage
-- Siddipet Self Drive Cars
--
-- Review and run this script in your Supabase Dashboard -> SQL Editor.
-- It preserves all existing records (Swift, Baleno, Hyundai i20), customer
-- profiles, and booking policies without weakening existing security.
-- ============================================================================

-- STEP 1 (Optional Read-Only Inspection): Run these separately first if you
-- want to inspect your current columns, RLS policies, and storage buckets:
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('profiles', 'vehicles', 'bookings') ORDER BY table_name, ordinal_position;
--   SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public';
--   SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets;

-- ----------------------------------------------------------------------------
-- STEP 2: Trusted Administrator Helper Function (SECURITY DEFINER)
-- Reads role directly from public.profiles for auth.uid().
-- Note: If your profiles table uses `user_id` instead of `id`, adjust `id = auth.uid()` below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND lower(coalesce(role, '')) IN ('admin', 'super_admin', 'administrator')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- STEP 3: Prevent Customers from Modifying Their Own Role on public.profiles
-- Keeps existing trigger/policies intact while blocking client-side role escalation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator or database migration can modify profile roles.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_role_self_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_role_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_self_escalation();

-- ----------------------------------------------------------------------------
-- STEP 4: Non-Destructively Ensure Required Columns Exist on public.vehicles
-- Preserves all existing Swift, Baleno, and Hyundai i20 rows intact.
-- ----------------------------------------------------------------------------
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'Hatchback',
  ADD COLUMN IF NOT EXISTS fuel_type text DEFAULT 'Petrol',
  ADD COLUMN IF NOT EXISTS transmission text DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS seating_capacity integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS daily_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS hourly_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS security_deposit numeric(10, 2),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ----------------------------------------------------------------------------
-- STEP 5: Additive RLS Policies on public.vehicles
-- Preserves any existing policies. Adds admin-only write policies and an
-- active-vehicle SELECT policy using public.is_admin().
-- Note: If you already have a broad public SELECT policy such as
-- "Enable read access for all users" with USING (true), review pg_policies
-- from STEP 1 and restrict it to (COALESCE(is_active, true) = true OR public.is_admin())
-- if you also want inactive rows hidden at the SQL layer (frontend already hides them).
-- ----------------------------------------------------------------------------
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Admins can insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Admins can update vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Admins can delete vehicles" ON public.vehicles;

CREATE POLICY "Public can view active vehicles"
  ON public.vehicles
  FOR SELECT
  TO anon, authenticated
  USING (COALESCE(is_active, true) = true OR public.is_admin());

CREATE POLICY "Admins can insert vehicles"
  ON public.vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update vehicles"
  ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete vehicles"
  ON public.vehicles
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- STEP 6: Supabase Storage Bucket `vehicle-images` & Admin-Only Write Policies
-- Creates `vehicle-images` if missing (5 MB limit, JPG/PNG/WebP).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can view vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete vehicle images" ON storage.objects;

CREATE POLICY "Public can view vehicle images"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'vehicle-images');

CREATE POLICY "Admins can upload vehicle images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'vehicle-images' AND public.is_admin());

CREATE POLICY "Admins can update vehicle images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'vehicle-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'vehicle-images' AND public.is_admin());

CREATE POLICY "Admins can delete vehicle images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'vehicle-images' AND public.is_admin());

-- ----------------------------------------------------------------------------
-- STEP 7: Manual Admin Promotion (Run Separately for YOUR Verified Email Only)
-- Replace 'your-verified-email@example.com' with your own verified account.
-- ----------------------------------------------------------------------------
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE id = (
--   SELECT id FROM auth.users WHERE email = 'your-verified-email@example.com'
-- );
