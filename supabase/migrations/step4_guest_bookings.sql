-- ============================================================================
-- Step 4: Guest Bookings Without Mandatory Customer Login (Non-Destructive)
-- Siddipet Self Drive Cars
--
-- Execute this script in Supabase Dashboard -> SQL Editor (as `postgres`).
--
-- Architecture & Safety Guarantees:
-- - Preserves `bookings.user_id` foreign key referencing `public.profiles(id)`
--   while making `user_id` nullable so guest bookings store `user_id = NULL`
--   and `is_guest = true` (never linked to an arbitrary existing profile).
-- - Preserves all existing registered customer bookings (`user_id` untouched),
--   vehicles, profiles, admin roles, RLS policies, and the overlap exclusion
--   constraint `bookings_no_overlapping_active_slots`.
-- - Blocks all direct anonymous table access (`REVOKE ALL ... FROM PUBLIC, anon`).
-- - Allows guest inserts with `user_id = NULL` ONLY inside the trusted
--   `create_guest_booking()` SECURITY DEFINER RPC.
-- ============================================================================

-- 1. Make bookings.user_id nullable while preserving its FK to public.profiles(id)
ALTER TABLE public.bookings
  ALTER COLUMN user_id DROP NOT NULL;

-- 2. Non-destructively add guest booking metadata & reference columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guest_name text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guest_phone text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_reference text;

-- 3. Enforce ownership consistency at the table level:
--    - Guest bookings (`is_guest = true`) must have `user_id IS NULL`
--    - Registered bookings (`is_guest = false`) must have `user_id IS NOT NULL`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_guest_user_id_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_guest_user_id_check
      CHECK (
        (is_guest = true AND user_id IS NULL)
        OR (is_guest = false AND user_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_reference_unique
  ON public.bookings (booking_reference)
  WHERE booking_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_is_guest_created
  ON public.bookings (is_guest, created_at DESC);

-- 4. Keep RLS enabled and revoke all direct table privileges from PUBLIC & anon
--    so anonymous users can NEVER read, insert, update, or delete bookings directly.
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon;

-- 4b. Private schema & per-transaction authorization table for guest booking RPC
--     Never exposed to PUBLIC, anon, or authenticated roles.
CREATE SCHEMA IF NOT EXISTS private;
ALTER SCHEMA private OWNER TO postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.guest_booking_authorizations (
  transaction_id bigint PRIMARY KEY,
  authorization_token uuid NOT NULL
);
ALTER TABLE private.guest_booking_authorizations OWNER TO postgres;
REVOKE ALL ON TABLE private.guest_booking_authorizations FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Update enforce_booking_integrity() trigger function
--    - Only the trusted `create_guest_booking()` RPC can insert a guest booking
--      with `user_id IS NULL` and `is_guest = true`
--    - Preserves all existing authenticated customer and admin protections
--    - Enforces active vehicle, IST non-past pickup, exact duration, delivery fee,
--      and server-computed INR pricing on every insert
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
  v_is_guest_rpc boolean := false;
  v_raw_guest_token text;
  v_guest_token uuid;
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

  -- Guest RPC mode is authorized ONLY on INSERT when:
  --   1) app.guest_booking_rpc holds a valid UUID token
  --   2) a matching row exists in private.guest_booking_authorizations for txid_current()
  --   3) the trigger is executing under the trusted postgres function owner
  IF TG_OP = 'INSERT'
     AND current_user = 'postgres'
     AND COALESCE(NEW.is_guest, false) = true
     AND NEW.user_id IS NULL THEN
    v_raw_guest_token := NULLIF(trim(coalesce(current_setting('app.guest_booking_rpc', true), '')), '');
    IF v_raw_guest_token IS NOT NULL
       AND v_raw_guest_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_guest_token := v_raw_guest_token::uuid;
      SELECT EXISTS (
        SELECT 1
        FROM private.guest_booking_authorizations a
        WHERE a.transaction_id = txid_current()
          AND a.authorization_token = v_guest_token
      )
      INTO v_is_guest_rpc;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_is_guest_rpc THEN
      -- Controlled guest booking path: strictly NULL user_id and pending status
      NEW.user_id := NULL;
      NEW.is_guest := true;
      NEW.guest_name := trim(coalesce(NEW.guest_name, ''));
      IF length(NEW.guest_name) < 2 OR length(NEW.guest_name) > 100 THEN
        RAISE EXCEPTION 'Please enter your full name (2 to 100 characters).';
      END IF;

      NEW.guest_phone := trim(coalesce(NEW.guest_phone, ''));
      IF NEW.guest_phone !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'Please enter a valid 10-digit Indian mobile number (+91).';
      END IF;

      NEW.status := 'pending';
    ELSIF NOT v_is_admin THEN
      -- Authenticated customer path: enforce ownership, non-guest, pending status
      IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create a booking.' USING ERRCODE = '42501';
      END IF;
      NEW.user_id := v_caller;
      NEW.is_guest := false;
      NEW.guest_name := NULL;
      NEW.guest_phone := NULL;
      NEW.status := 'pending';
    ELSE
      -- Admin / DBA direct insert path: must reference a valid user_id;
      -- guest bookings with NULL user_id may only be inserted via create_guest_booking()
      IF NEW.user_id IS NULL OR COALESCE(NEW.is_guest, false) = true THEN
        RAISE EXCEPTION 'Guest bookings with NULL user_id must be created via create_guest_booking().';
      END IF;
      NEW.is_guest := false;
      NEW.guest_name := NULL;
      NEW.guest_phone := NULL;
      IF COALESCE(NEW.status, '') = '' THEN
        NEW.status := 'pending';
      END IF;
      IF NEW.status NOT IN ('pending', 'confirmed', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid booking status: %', NEW.status;
      END IF;
    END IF;

    IF COALESCE(trim(NEW.booking_reference), '') = '' THEN
      NEW.booking_reference := 'SSDC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    ELSE
      NEW.booking_reference := upper(trim(NEW.booking_reference));
    END IF;

    IF NEW.vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Vehicle selection is required.';
    END IF;

    IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.end_date <= NEW.start_date THEN
      RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
    END IF;

    -- Past pickup protection enforced for guest & customer-created bookings
    IF (v_is_guest_rpc OR NOT v_is_admin) AND NEW.start_date < (now() - interval '5 minutes') THEN
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
      IF v_caller IS NULL
         OR OLD.user_id IS NULL
         OR OLD.user_id IS DISTINCT FROM v_caller
         OR COALESCE(OLD.is_guest, false) = true THEN
        RAISE EXCEPTION 'You are only permitted to manage your own bookings.' USING ERRCODE = '42501';
      END IF;

      -- Customers cannot alter immutable fields, prices, dates, vehicle, guest flags, notes, or ownership
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
         OR NEW.is_guest IS DISTINCT FROM OLD.is_guest
         OR NEW.guest_name IS DISTINCT FROM OLD.guest_name
         OR NEW.guest_phone IS DISTINCT FROM OLD.guest_phone
         OR NEW.booking_reference IS DISTINCT FROM OLD.booking_reference
      THEN
        RAISE EXCEPTION 'Customers cannot modify booking prices, dates, vehicle, notes, or ownership fields.' USING ERRCODE = '42501';
      END IF;

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

ALTER FUNCTION public.enforce_booking_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_booking_integrity() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Secure Guest Booking Creation RPC (`anon` & `authenticated`)
--    - Inserts with `user_id = NULL` and `is_guest = true`
--    - No arbitrary profile lookup or customer account association
--    - Never exposes `user_id` or any other booking rows
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_guest_booking(
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_phone text,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_rental_duration text,
  p_pickup_type text,
  p_delivery_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  booking_id uuid,
  booking_reference text,
  is_guest boolean,
  guest_name text,
  guest_phone text,
  vehicle_id uuid,
  vehicle_name text,
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
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name text;
  v_cleaned_phone text;
  v_local_phone text;
  v_normalized_phone text;
  v_vehicle_name text;
  v_vehicle_active boolean;
  v_created public.bookings;
  v_reference text;
  v_auth_token uuid;
  v_txid bigint;
BEGIN
  -- 1. Validate guest name
  v_clean_name := trim(coalesce(p_guest_name, ''));
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Please enter your full name (2 to 100 characters).';
  END IF;

  -- 2. Normalize and validate Indian 10-digit mobile number -> +91XXXXXXXXXX
  v_cleaned_phone := regexp_replace(trim(coalesce(p_guest_phone, '')), '[\s\-()]+', '', 'g');
  IF v_cleaned_phone = '' THEN
    RAISE EXCEPTION 'Please enter your 10-digit Indian mobile number.';
  END IF;

  IF v_cleaned_phone LIKE '+91%' THEN
    v_local_phone := substr(v_cleaned_phone, 4);
  ELSIF v_cleaned_phone LIKE '+%' THEN
    RAISE EXCEPTION 'Only Indian mobile numbers (+91) are supported.';
  ELSIF v_cleaned_phone LIKE '91%' AND length(v_cleaned_phone) = 12 THEN
    v_local_phone := substr(v_cleaned_phone, 3);
  ELSIF v_cleaned_phone LIKE '0%' AND length(v_cleaned_phone) = 11 THEN
    v_local_phone := substr(v_cleaned_phone, 2);
  ELSE
    v_local_phone := v_cleaned_phone;
  END IF;

  IF v_local_phone !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
  END IF;

  v_normalized_phone := '+91' || v_local_phone;

  -- 3. Validate dates
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
  END IF;

  IF p_start_date < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
  END IF;

  -- 4. Lock vehicle row to serialize concurrent bookings and verify active status
  SELECT
    NULLIF(trim(concat_ws(' ', v.make, v.model)), ''),
    COALESCE(v.is_active, false)
  INTO v_vehicle_name, v_vehicle_active
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected vehicle could not be found.';
  END IF;

  IF v_vehicle_active = false THEN
    RAISE EXCEPTION 'This vehicle is currently inactive and unavailable for booking.';
  END IF;

  -- 5. Check active overlap window
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

  v_reference := 'SSDC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- 6. Issue per-transaction authorization token in private table & transaction-local GUC
  v_auth_token := gen_random_uuid();
  v_txid := txid_current();

  INSERT INTO private.guest_booking_authorizations (transaction_id, authorization_token)
  VALUES (v_txid, v_auth_token)
  ON CONFLICT (transaction_id) DO UPDATE
    SET authorization_token = EXCLUDED.authorization_token;

  PERFORM set_config('app.guest_booking_rpc', v_auth_token::text, true);

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
    notes,
    is_guest,
    guest_name,
    guest_phone,
    booking_reference
  )
  VALUES (
    NULL,
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
    p_notes,
    true,
    v_clean_name,
    v_normalized_phone,
    v_reference
  )
  RETURNING * INTO v_created;

  -- 7. Consume and clear transaction authorization immediately after insert
  DELETE FROM private.guest_booking_authorizations
  WHERE transaction_id = v_txid
    AND authorization_token = v_auth_token;

  PERFORM set_config('app.guest_booking_rpc', '', true);

  RETURN QUERY
  SELECT
    v_created.id,
    v_created.booking_reference,
    v_created.is_guest,
    v_created.guest_name,
    v_created.guest_phone,
    v_created.vehicle_id,
    COALESCE(v_vehicle_name, 'Self-Drive Vehicle'),
    v_created.start_date,
    v_created.end_date,
    v_created.rental_duration,
    v_created.duration_hours,
    v_created.pickup_type,
    v_created.delivery_address,
    v_created.base_amount,
    v_created.delivery_fee,
    v_created.total_amount,
    v_created.status,
    v_created.notes,
    v_created.created_at;
EXCEPTION
  WHEN exclusion_violation THEN
    IF v_txid IS NOT NULL THEN
      DELETE FROM private.guest_booking_authorizations WHERE transaction_id = v_txid;
    END IF;
    PERFORM set_config('app.guest_booking_rpc', '', true);
    RAISE EXCEPTION 'Another customer just booked this vehicle for an overlapping time slot. Please choose different dates or another car.'
      USING ERRCODE = '23P01';
  WHEN OTHERS THEN
    IF v_txid IS NOT NULL THEN
      DELETE FROM private.guest_booking_authorizations WHERE transaction_id = v_txid;
    END IF;
    PERFORM set_config('app.guest_booking_rpc', '', true);
    RAISE;
END;
$$;

ALTER FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Update cancel_own_booking() with NULL-safe user_id & is_guest check
-- ----------------------------------------------------------------------------
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

  IF COALESCE(v_booking.is_guest, false) = true
     OR v_booking.user_id IS NULL
     OR v_booking.user_id IS DISTINCT FROM v_user_id THEN
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
-- 8. Update get_my_bookings() so guest bookings never appear in customer history
--    (Dropped first because RETURNS TABLE columns changed)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_bookings();

CREATE OR REPLACE FUNCTION public.get_my_bookings()
RETURNS TABLE (
  id uuid,
  booking_reference text,
  user_id uuid,
  is_guest boolean,
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
    COALESCE(
      NULLIF(trim(b.booking_reference), ''),
      'SSDC-' || upper(substr(replace(b.id::text, '-', ''), 1, 8))
    ) AS booking_reference,
    b.user_id,
    COALESCE(b.is_guest, false) AS is_guest,
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
    AND COALESCE(b.is_guest, false) = false
  ORDER BY b.start_date DESC, b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_bookings() TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Update admin_list_bookings() to surface guest (`user_id IS NULL`)
--    and registered customer bookings exclusively to authenticated admins
--    (Dropped first because RETURNS TABLE columns changed)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_bookings();

CREATE OR REPLACE FUNCTION public.admin_list_bookings()
RETURNS TABLE (
  id uuid,
  booking_reference text,
  user_id uuid,
  is_guest boolean,
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
    COALESCE(
      NULLIF(trim(b.booking_reference), ''),
      'SSDC-' || upper(substr(replace(b.id::text, '-', ''), 1, 8))
    ) AS booking_reference,
    b.user_id,
    COALESCE(b.is_guest, false) AS is_guest,
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
    CASE
      WHEN COALESCE(b.is_guest, false) THEN b.guest_name
      ELSE p.full_name
    END AS customer_name,
    CASE
      WHEN COALESCE(b.is_guest, false) THEN b.guest_phone
      ELSE p.phone
    END AS customer_phone,
    CASE
      WHEN COALESCE(b.is_guest, false) THEN NULL::text
      ELSE u.email::text
    END AS customer_email
  FROM public.bookings b
  LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
  LEFT JOIN public.profiles p ON p.id = b.user_id
  LEFT JOIN auth.users u ON u.id = b.user_id
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_bookings() TO authenticated;
