-- ============================================================================
-- Phase 5: Remaining Booking System Migration (Non-Destructive / Additive)
-- Siddipet Self Drive Cars
--
-- Prerequisites ALREADY applied in your Supabase database (omitted below):
--   - Extension `btree_gist`
--   - Exclusion constraint `bookings_no_overlapping_active_slots` on `public.bookings`
--   - Helper function `public.is_admin()` (from Phase 4 migration)
--
-- Execute this script in Supabase Dashboard -> SQL Editor (as `postgres`).
-- Preserves all existing tables, rows, constraints, and RLS policies.
-- ============================================================================

-- 1. Ensure bookings keeps RLS enabled (preserves all existing policies)
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- 2. Non-destructively add date-order check constraint if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_valid_date_order'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_valid_date_order
      CHECK (end_date > start_date);
  END IF;
END
$$;

-- 3. Helpful indexes for availability & customer/admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_status_dates
  ON public.bookings (vehicle_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_bookings_user_created
  ON public.bookings (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Server-Side Duration, Past-Pickup, Pricing, Ownership & Status Trigger
-- Runs on BOTH create_booking() and direct PostgREST inserts/updates so
-- customers cannot bypass validation, duration, pricing, or status rules.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle record;
  v_elapsed_seconds numeric;
  v_duration_hours integer;
  v_custom_days integer;
  v_raw_12h numeric;
  v_raw_24h numeric;
  v_effective_12h numeric;
  v_effective_24h numeric;
  v_base_amount numeric;
  v_delivery_fee numeric;
  v_is_admin boolean;
  v_caller uuid;
  v_jwt_role text;
BEGIN
  v_is_admin := public.is_admin();
  v_caller := auth.uid();
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role',
    ''
  );

  -- Allow trusted DBA / service_role SQL maintenance only when no browser/anon JWT is active
  IF v_caller IS NULL
     AND v_jwt_role IN ('', 'service_role')
     AND current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    v_is_admin := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Enforce authenticated ownership, pending initial status, and non-past pickup for customers
    IF NOT v_is_admin THEN
      IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create a booking.' USING ERRCODE = '42501';
      END IF;
      NEW.user_id := v_caller;
      NEW.status := 'pending';
    ELSE
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required when creating a booking.';
      END IF;
      IF COALESCE(NEW.status, '') = '' THEN
        NEW.status := 'pending';
      END IF;
      IF NEW.status NOT IN ('pending', 'confirmed', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid booking status: %', NEW.status;
      END IF;
    END IF;

    IF NEW.vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Vehicle selection is required.';
    END IF;

    IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.end_date <= NEW.start_date THEN
      RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
    END IF;

    -- Past pickup protection enforced inside trigger for all customer-created bookings
    IF NOT v_is_admin AND NEW.start_date < (now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
    END IF;

    -- Exact elapsed duration validation (minimum 12 hours remains enforced)
    v_elapsed_seconds := EXTRACT(EPOCH FROM (NEW.end_date - NEW.start_date));

    IF v_elapsed_seconds < 43200 THEN
      RAISE EXCEPTION 'Minimum rental duration is 12 full hours.';
    END IF;

    IF NEW.rental_duration NOT IN ('12h', '24h', 'custom') THEN
      RAISE EXCEPTION 'Invalid rental_duration value. Allowed: 12h, 24h, custom.';
    END IF;

    IF NEW.rental_duration = '12h' AND v_elapsed_seconds <> 43200 THEN
      RAISE EXCEPTION '12h rental option requires exactly 12 elapsed hours between pickup and return.';
    END IF;

    IF NEW.rental_duration = '24h' AND v_elapsed_seconds <> 86400 THEN
      RAISE EXCEPTION '24h rental option requires exactly 24 elapsed hours between pickup and return.';
    END IF;

    IF NEW.rental_duration = 'custom' THEN
      IF v_elapsed_seconds < 86400
         OR v_elapsed_seconds > (30 * 86400)
         OR v_elapsed_seconds <> ROUND(v_elapsed_seconds)
         OR MOD(ROUND(v_elapsed_seconds)::bigint, 86400) <> 0 THEN
        RAISE EXCEPTION 'Custom day-wise rentals must be between 1 and 30 full days (in 24-hour increments from pickup time).';
      END IF;
      v_custom_days := (ROUND(v_elapsed_seconds)::bigint / 86400)::integer;
      v_duration_hours := v_custom_days * 24;
    ELSE
      v_duration_hours := CEIL(v_elapsed_seconds / 3600.0)::integer;
    END IF;

    IF NEW.pickup_type NOT IN ('hub_pickup', 'doorstep_delivery') THEN
      RAISE EXCEPTION 'Invalid pickup_type. Allowed: hub_pickup, doorstep_delivery.';
    END IF;

    IF NEW.pickup_type = 'doorstep_delivery' THEN
      IF length(trim(coalesce(NEW.delivery_address, ''))) < 5 THEN
        RAISE EXCEPTION 'A valid delivery address is required for doorstep delivery.';
      END IF;
      NEW.delivery_address := trim(NEW.delivery_address);
      v_delivery_fee := ROUND(250.00::numeric, 2);
    ELSE
      NEW.delivery_address := NULL;
      v_delivery_fee := ROUND(0.00::numeric, 2);
    END IF;

    -- Lock vehicle row to serialize concurrent bookings and check active status
    SELECT v.id, v.price_12h, v.price_24h, v.is_active
    INTO v_vehicle
    FROM public.vehicles v
    WHERE v.id = NEW.vehicle_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected vehicle does not exist.';
    END IF;

    IF COALESCE(v_vehicle.is_active, false) = false THEN
      RAISE EXCEPTION 'This vehicle is currently inactive and unavailable for booking.';
    END IF;

    v_raw_12h := COALESCE(v_vehicle.price_12h, 0);
    v_raw_24h := COALESCE(v_vehicle.price_24h, 0);

    IF v_raw_12h <= 0 AND v_raw_24h <= 0 THEN
      RAISE EXCEPTION 'Rental pricing is not configured for this vehicle yet.';
    END IF;

    v_effective_12h := CASE WHEN v_raw_12h > 0 THEN v_raw_12h ELSE ROUND(v_raw_24h * 0.5, 2) END;
    v_effective_24h := CASE WHEN v_raw_24h > 0 THEN v_raw_24h ELSE ROUND(v_raw_12h * 2.0, 2) END;

    IF NEW.rental_duration = '12h' AND v_duration_hours = 12 THEN
      v_base_amount := ROUND(v_effective_12h, 2);
    ELSIF NEW.rental_duration = '24h' AND v_duration_hours = 24 THEN
      v_base_amount := ROUND(v_effective_24h, 2);
    ELSE
      -- Custom day-wise (1 to 30 days): number of days multiplied by price_24h
      v_base_amount := ROUND(v_custom_days * v_effective_24h, 2);
    END IF;

    NEW.duration_hours := v_duration_hours;
    NEW.base_amount := v_base_amount;
    NEW.delivery_fee := v_delivery_fee;
    NEW.total_amount := ROUND(v_base_amount + v_delivery_fee, 2);
    NEW.notes := NULLIF(trim(coalesce(NEW.notes, '')), '');

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT v_is_admin THEN
      IF v_caller IS NULL OR OLD.user_id <> v_caller THEN
        RAISE EXCEPTION 'You are only permitted to manage your own bookings.' USING ERRCODE = '42501';
      END IF;

      -- Customers cannot alter immutable fields, prices, dates, vehicle, notes, or ownership
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
         OR NEW.start_date IS DISTINCT FROM OLD.start_date
         OR NEW.end_date IS DISTINCT FROM OLD.end_date
         OR NEW.rental_duration IS DISTINCT FROM OLD.rental_duration
         OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
         OR NEW.pickup_type IS DISTINCT FROM OLD.pickup_type
         OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
         OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
         OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
         OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
         OR NEW.notes IS DISTINCT FROM OLD.notes
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'Customers cannot modify booking prices, dates, vehicle, notes, or ownership fields.' USING ERRCODE = '42501';
      END IF;

      -- Customers may only cancel their own pending bookings
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (OLD.status = 'pending' AND NEW.status = 'cancelled') THEN
          RAISE EXCEPTION 'Only pending bookings can be cancelled by customers.';
        END IF;
      END IF;

      RETURN NEW;
    END IF;

    -- Admin updates: enforce valid status values and allowed transitions
    IF NEW.status NOT IN ('pending', 'confirmed', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid booking status: %', NEW.status;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'pending' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
        RAISE EXCEPTION 'Pending bookings can only transition to confirmed or cancelled.';
      ELSIF OLD.status = 'confirmed' AND NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Confirmed bookings can only transition to completed or cancelled.';
      ELSIF OLD.status IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Bookings with status "%" cannot be changed.', OLD.status;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_booking_integrity ON public.bookings;
CREATE TRIGGER trg_enforce_booking_integrity
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_integrity();

-- ----------------------------------------------------------------------------
-- 5. Privacy-Safe Vehicle Availability RPCs (Public & Authenticated)
-- Never expose customer PII, notes, addresses, or booking amounts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unavailable_vehicle_ids(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (vehicle_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT b.vehicle_id
  FROM public.bookings b
  WHERE p_end_date > p_start_date
    AND b.status IN ('pending', 'confirmed')
    AND b.start_date < p_end_date
    AND b.end_date > p_start_date;
$$;

REVOKE ALL ON FUNCTION public.get_unavailable_vehicle_ids(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unavailable_vehicle_ids(timestamptz, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_vehicle_booked_slots(
  p_vehicle_id uuid,
  p_from timestamptz DEFAULT now(),
  p_to timestamptz DEFAULT (now() + interval '90 days')
)
RETURNS TABLE (
  start_date timestamptz,
  end_date timestamptz,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.start_date, b.end_date, b.status
  FROM public.bookings b
  WHERE b.vehicle_id = p_vehicle_id
    AND b.status IN ('pending', 'confirmed')
    AND b.end_date > p_from
    AND b.start_date < p_to
  ORDER BY b.start_date ASC;
$$;

REVOKE ALL ON FUNCTION public.get_vehicle_booked_slots(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_booked_slots(uuid, timestamptz, timestamptz) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Transactional Booking Creation RPC (Customer-facing, Atomic Overlap Lock)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_vehicle_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_rental_duration text,
  p_pickup_type text,
  p_delivery_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_created public.bookings;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in to your customer account before booking a car.' USING ERRCODE = '42501';
  END IF;

  -- Ensure profile row exists for foreign key bookings(user_id) -> profiles(id)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Your customer profile could not be found. Please sign out and sign in again.';
  END IF;

  IF NOT public.is_admin() AND p_start_date < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
  END IF;

  IF p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
  END IF;

  -- Lock vehicle row inside transaction so simultaneous booking attempts serialize cleanly
  PERFORM 1 FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected vehicle could not be found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.vehicle_id = p_vehicle_id
      AND b.status IN ('pending', 'confirmed')
      AND b.start_date < p_end_date
      AND b.end_date > p_start_date
  ) THEN
    RAISE EXCEPTION 'This vehicle is already reserved during the selected pickup and return window. Please pick another slot or car.'
      USING ERRCODE = '23P01';
  END IF;

  -- Trigger trg_enforce_booking_integrity validates exact duration, past pickup,
  -- vehicle availability, computes billable duration_hours & INR pricing,
  -- enforces user_id = auth.uid(), and sets status = 'pending'.
  INSERT INTO public.bookings (
    user_id,
    vehicle_id,
    start_date,
    end_date,
    rental_duration,
    duration_hours,
    pickup_type,
    delivery_address,
    base_amount,
    delivery_fee,
    total_amount,
    status,
    notes
  )
  VALUES (
    v_user_id,
    p_vehicle_id,
    p_start_date,
    p_end_date,
    p_rental_duration,
    GREATEST(12, CEIL(EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 3600.0)::integer),
    p_pickup_type,
    p_delivery_address,
    0,
    0,
    0,
    'pending',
    p_notes
  )
  RETURNING * INTO v_created;

  RETURN v_created;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Another customer just booked this vehicle for an overlapping time slot. Please choose different dates or another car.'
      USING ERRCODE = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Customer Booking History & Pending-Only Cancellation RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_bookings()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  vehicle_id uuid,
  start_date timestamptz,
  end_date timestamptz,
  rental_duration text,
  duration_hours integer,
  pickup_type text,
  delivery_address text,
  base_amount numeric,
  delivery_fee numeric,
  total_amount numeric,
  status text,
  notes text,
  created_at timestamptz,
  vehicle_name text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_slug text,
  vehicle_image_url text,
  vehicle_fuel_type text,
  vehicle_transmission text,
  vehicle_registration_number text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.user_id,
    b.vehicle_id,
    b.start_date,
    b.end_date,
    b.rental_duration,
    b.duration_hours,
    b.pickup_type,
    b.delivery_address,
    b.base_amount,
    b.delivery_fee,
    b.total_amount,
    b.status,
    b.notes,
    b.created_at,
    NULLIF(trim(concat_ws(' ', v.make, v.model)), '') AS vehicle_name,
    v.make AS vehicle_brand,
    v.model AS vehicle_model,
    NULL::text AS vehicle_slug,
    v.image_url AS vehicle_image_url,
    v.fuel_type AS vehicle_fuel_type,
    v.transmission AS vehicle_transmission,
    v.registration_number AS vehicle_registration_number
  FROM public.bookings b
  LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
  WHERE b.user_id = v_user_id
  ORDER BY b.start_date DESC, b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_own_booking(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_booking public.bookings;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking record not found.';
  END IF;

  IF v_booking.user_id <> v_user_id THEN
    RAISE EXCEPTION 'You are only permitted to cancel your own bookings.' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending bookings can be cancelled.';
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled'
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_own_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_own_booking(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Admin Booking Management RPCs (Verified via public.is_admin())
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_bookings()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  vehicle_id uuid,
  start_date timestamptz,
  end_date timestamptz,
  rental_duration text,
  duration_hours integer,
  pickup_type text,
  delivery_address text,
  base_amount numeric,
  delivery_fee numeric,
  total_amount numeric,
  status text,
  notes text,
  created_at timestamptz,
  vehicle_name text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_slug text,
  vehicle_image_url text,
  vehicle_registration_number text,
  customer_name text,
  customer_phone text,
  customer_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permissions required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.user_id,
    b.vehicle_id,
    b.start_date,
    b.end_date,
    b.rental_duration,
    b.duration_hours,
    b.pickup_type,
    b.delivery_address,
    b.base_amount,
    b.delivery_fee,
    b.total_amount,
    b.status,
    b.notes,
    b.created_at,
    NULLIF(trim(concat_ws(' ', v.make, v.model)), '') AS vehicle_name,
    v.make AS vehicle_brand,
    v.model AS vehicle_model,
    NULL::text AS vehicle_slug,
    v.image_url AS vehicle_image_url,
    v.registration_number AS vehicle_registration_number,
    p.full_name AS customer_name,
    p.phone AS customer_phone,
    u.email::text AS customer_email
  FROM public.bookings b
  LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
  LEFT JOIN public.profiles p ON p.id = b.user_id
  LEFT JOIN auth.users u ON u.id = b.user_id
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_booking_status(
  p_booking_id uuid,
  p_next_status text
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permissions required.' USING ERRCODE = '42501';
  END IF;

  IF p_next_status NOT IN ('confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid target booking status: %', p_next_status;
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking record not found.';
  END IF;

  IF v_booking.status = p_next_status THEN
    RETURN v_booking;
  END IF;

  IF v_booking.status = 'pending' AND p_next_status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Pending bookings can only be confirmed or cancelled.';
  ELSIF v_booking.status = 'confirmed' AND p_next_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Confirmed bookings can only be marked completed or cancelled.';
  ELSIF v_booking.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Bookings with status "%" cannot be modified.', v_booking.status;
  END IF;

  UPDATE public.bookings
  SET status = p_next_status
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN v_booking;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Cannot confirm this booking because another active booking overlaps the same vehicle and time window.'
      USING ERRCODE = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_booking_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_booking_status(uuid, text) TO authenticated;
