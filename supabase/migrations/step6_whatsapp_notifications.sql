-- ============================================================================
-- Step 6: Automatic WhatsApp Cloud API Notification Outbox & Idempotency
-- Siddipet Self Drive Cars
--
-- Execute this script in Supabase Dashboard -> SQL Editor (as postgres).
--
-- Safety & Integrity Guarantees:
-- - Non-destructive: preserves all existing vehicles, profiles, bookings,
--   overlap exclusion constraint (`bookings_no_overlapping_active_slots`),
--   pricing rules, guest booking token security, and RLS policies.
-- - Stores explicit per-booking customer WhatsApp opt-in consent
--   (`whatsapp_opt_in`, `whatsapp_opt_in_at`) on `public.bookings`.
-- - Uses a database-backed idempotent outbox (`public.whatsapp_notification_events`)
--   with UNIQUE `idempotency_key` so:
--     1. One booking creation produces at most ONE admin notification (`6302543640`).
--     2. One `pending -> confirmed` status transition produces at most ONE
--        customer confirmation notification (only when `whatsapp_opt_in = true`).
--     3. Cancelling, completing, or editing other fields NEVER triggers a
--        confirmation notification.
--     4. Repeated clicks, refreshes, or webhooks cannot send duplicates.
-- - Never stores Meta tokens or secrets in database tables or frontend code.
-- ============================================================================

-- 1. Add WhatsApp opt-in consent columns to public.bookings (non-destructive)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz;

-- 2. Create idempotent notification outbox table
CREATE TABLE IF NOT EXISTS public.whatsapp_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN ('booking_created_admin', 'booking_confirmed_customer')
  ),
  idempotency_key text NOT NULL UNIQUE,
  recipient_role text NOT NULL CHECK (recipient_role IN ('admin', 'customer')),
  recipient_phone text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'skipped')
  ),
  skip_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_notification_unique_booking_event UNIQUE (booking_id, event_type)
);

ALTER TABLE public.whatsapp_notification_events OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_status_retry
  ON public.whatsapp_notification_events (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_booking_id
  ON public.whatsapp_notification_events (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_events_provider_msg_id
  ON public.whatsapp_notification_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION public.touch_whatsapp_notification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.touch_whatsapp_notification_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_whatsapp_notification_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_touch_whatsapp_notification_updated_at ON public.whatsapp_notification_events;
CREATE TRIGGER trg_touch_whatsapp_notification_updated_at
  BEFORE UPDATE ON public.whatsapp_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_whatsapp_notification_updated_at();

-- Strict RLS: anonymous & customers cannot read or modify notification outbox;
-- only verified admins can view delivery logs, and only service_role (Edge Functions)
-- updates delivery state.
ALTER TABLE public.whatsapp_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_notification_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.whatsapp_notification_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_notification_events TO service_role;

DROP POLICY IF EXISTS "Admins can view WhatsApp notification logs" ON public.whatsapp_notification_events;
CREATE POLICY "Admins can view WhatsApp notification logs"
  ON public.whatsapp_notification_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Indian mobile normalization helper for SQL outbox triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_indian_e164_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cleaned text;
  v_local text;
BEGIN
  v_cleaned := regexp_replace(trim(coalesce(p_raw, '')), '[\s\-()]+', '', 'g');
  IF v_cleaned = '' THEN
    RETURN NULL;
  END IF;

  IF v_cleaned LIKE '+91%' THEN
    v_local := substr(v_cleaned, 4);
  ELSIF v_cleaned LIKE '+%' THEN
    RETURN NULL;
  ELSIF v_cleaned LIKE '91%' AND length(v_cleaned) = 12 THEN
    v_local := substr(v_cleaned, 3);
  ELSIF v_cleaned LIKE '0%' AND length(v_cleaned) = 11 THEN
    v_local := substr(v_cleaned, 2);
  ELSE
    v_local := v_cleaned;
  END IF;

  IF v_local !~ '^[6-9][0-9]{9}$' THEN
    RETURN NULL;
  END IF;

  RETURN '+91' || v_local;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_indian_e164_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_indian_e164_phone(text) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. Update enforce_booking_integrity() preserving ALL Step 4 protections
--    plus immutable whatsapp_opt_in consent capture on INSERT/UPDATE
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
      IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create a booking.' USING ERRCODE = '42501';
      END IF;
      NEW.user_id := v_caller;
      NEW.is_guest := false;
      NEW.guest_name := NULL;
      NEW.guest_phone := NULL;
      NEW.status := 'pending';
    ELSE
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

    -- Record explicit customer WhatsApp opt-in timestamp cleanly
    NEW.whatsapp_opt_in := COALESCE(NEW.whatsapp_opt_in, false);
    NEW.whatsapp_opt_in_at := CASE WHEN NEW.whatsapp_opt_in THEN now() ELSE NULL END;

    -- Always generate SSDC booking reference on server for non-admin customer inserts
    IF (NOT v_is_admin AND NOT v_is_guest_rpc) OR COALESCE(trim(NEW.booking_reference), '') = '' THEN
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

    IF (v_is_guest_rpc OR NOT v_is_admin) AND NEW.start_date < (now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
    END IF;

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
         OR NEW.whatsapp_opt_in IS DISTINCT FROM OLD.whatsapp_opt_in
         OR NEW.whatsapp_opt_in_at IS DISTINCT FROM OLD.whatsapp_opt_in_at
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

DROP TRIGGER IF EXISTS trg_enforce_booking_integrity ON public.bookings;
CREATE TRIGGER trg_enforce_booking_integrity
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_integrity();

-- ----------------------------------------------------------------------------
-- 5. Update create_guest_booking() to persist explicit WhatsApp opt-in
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.create_guest_booking(
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_phone text,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_rental_duration text,
  p_pickup_type text,
  p_delivery_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_whatsapp_opt_in boolean DEFAULT false
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
  whatsapp_opt_in boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name text;
  v_normalized_phone text;
  v_vehicle_name text;
  v_vehicle_active boolean;
  v_created public.bookings;
  v_reference text;
  v_auth_token uuid;
  v_txid bigint;
BEGIN
  v_clean_name := trim(coalesce(p_guest_name, ''));
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Please enter your full name (2 to 100 characters).';
  END IF;

  v_normalized_phone := public.normalize_indian_e164_phone(p_guest_phone);
  IF v_normalized_phone IS NULL THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
  END IF;

  IF p_start_date < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
  END IF;

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
    booking_reference,
    whatsapp_opt_in
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
    v_reference,
    COALESCE(p_whatsapp_opt_in, false)
  )
  RETURNING * INTO v_created;

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
    v_created.whatsapp_opt_in,
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

ALTER FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guest_booking(uuid, text, text, timestamptz, timestamptz, text, text, text, text, boolean) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Update create_booking() (registered customers) to persist WhatsApp opt-in
--    and backfill blank profile phone when provided during booking
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text, boolean, text);

CREATE OR REPLACE FUNCTION public.create_booking(
  p_vehicle_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_rental_duration text,
  p_pickup_type text,
  p_delivery_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_whatsapp_opt_in boolean DEFAULT false,
  p_contact_phone text DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles;
  v_normalized_phone text;
  v_created public.bookings;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in to your customer account before booking a car.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your customer profile could not be found. Please sign out and sign in again.';
  END IF;

  IF NOT public.is_admin() AND p_start_date < (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Pickup date and time cannot be in the past.';
  END IF;

  IF p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'Return date and time must be after pickup date and time.';
  END IF;

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

  -- Backfill profile.phone ONLY if currently blank, valid Indian mobile provided,
  -- and after schedule/vehicle/overlap checks pass
  v_normalized_phone := public.normalize_indian_e164_phone(p_contact_phone);
  IF coalesce(btrim(v_profile.phone), '') = '' AND v_normalized_phone IS NOT NULL THEN
    UPDATE public.profiles
    SET phone = v_normalized_phone
    WHERE id = v_user_id;
  END IF;

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
    whatsapp_opt_in
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
    p_notes,
    COALESCE(p_whatsapp_opt_in, false)
  )
  RETURNING * INTO v_created;

  RETURN v_created;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Another customer just booked this vehicle for an overlapping time slot. Please choose different dates or another car.'
      USING ERRCODE = '23P01';
END;
$$;

ALTER FUNCTION public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, timestamptz, timestamptz, text, text, text, text, boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Shared Snapshot Builder + Outbox Trigger Functions (Idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_booking_whatsapp_snapshot(p_booking public.bookings)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_vehicle record;
  v_profile record;
  v_auth_user record;
  v_customer_name text;
  v_raw_phone text;
  v_customer_phone text;
  v_vehicle_make_model text;
  v_duration_label text;
  v_pickup_label text;
  v_delivery_display text;
  v_pickup_ist text;
  v_return_ist text;
  v_reference text;
  v_amount_display text;
BEGIN
  SELECT v.make, v.model, v.registration_number
  INTO v_vehicle
  FROM public.vehicles v
  WHERE v.id = p_booking.vehicle_id;

  v_vehicle_make_model := COALESCE(
    NULLIF(trim(concat_ws(' ', v_vehicle.make, v_vehicle.model)), ''),
    'Self-Drive Vehicle'
  );

  IF COALESCE(p_booking.is_guest, false) = true OR p_booking.user_id IS NULL THEN
    v_customer_name := COALESCE(NULLIF(trim(p_booking.guest_name), ''), 'Guest Customer');
    v_raw_phone := p_booking.guest_phone;
  ELSE
    SELECT p.full_name, p.phone
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_booking.user_id;

    SELECT
      u.phone,
      u.email,
      COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') AS meta_name
    INTO v_auth_user
    FROM auth.users u
    WHERE u.id = p_booking.user_id;

    v_customer_name := COALESCE(
      NULLIF(trim(v_profile.full_name), ''),
      NULLIF(trim(v_auth_user.meta_name), ''),
      NULLIF(split_part(coalesce(v_auth_user.email, ''), '@', 1), ''),
      'Registered Customer'
    );
    v_raw_phone := COALESCE(
      NULLIF(trim(v_profile.phone), ''),
      NULLIF(trim(v_auth_user.phone), '')
    );
  END IF;

  v_customer_phone := COALESCE(
    public.normalize_indian_e164_phone(v_raw_phone),
    NULLIF(trim(coalesce(v_raw_phone, '')), ''),
    'Not provided'
  );

  v_reference := COALESCE(
    NULLIF(trim(p_booking.booking_reference), ''),
    'SSDC-' || upper(substr(replace(p_booking.id::text, '-', ''), 1, 8))
  );

  IF p_booking.rental_duration = '12h' AND COALESCE(p_booking.duration_hours, 12) = 12 THEN
    v_duration_label := '12 Hours';
  ELSIF p_booking.rental_duration = '24h' AND COALESCE(p_booking.duration_hours, 24) = 24 THEN
    v_duration_label := '24 Hours';
  ELSIF COALESCE(p_booking.duration_hours, 0) >= 24 AND MOD(p_booking.duration_hours, 24) = 0 THEN
    v_duration_label :=
      (p_booking.duration_hours / 24)::text ||
      CASE WHEN (p_booking.duration_hours / 24) = 1 THEN ' Day' ELSE ' Days' END ||
      ' (' || p_booking.duration_hours::text || ' Hours)';
  ELSE
    v_duration_label := COALESCE(p_booking.duration_hours, 12)::text || ' Hours';
  END IF;

  v_pickup_label := CASE
    WHEN p_booking.pickup_type = 'doorstep_delivery' THEN 'Doorstep Delivery'
    ELSE 'Hub Pickup (Siddipet)'
  END;

  v_delivery_display := CASE
    WHEN p_booking.pickup_type = 'doorstep_delivery'
         AND NULLIF(trim(coalesce(p_booking.delivery_address, '')), '') IS NOT NULL
      THEN trim(p_booking.delivery_address)
    ELSE 'Not applicable (Hub Pickup)'
  END;

  v_pickup_ist := to_char(p_booking.start_date AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || ' IST';
  v_return_ist := to_char(p_booking.end_date AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || ' IST';
  v_amount_display := 'INR ' || trim(to_char(ROUND(COALESCE(p_booking.total_amount, 0))::bigint, 'FM999999990'));

  RETURN jsonb_build_object(
    'booking_id', p_booking.id,
    'booking_reference', v_reference,
    'is_guest', COALESCE(p_booking.is_guest, false),
    'customer_name', v_customer_name,
    'customer_phone', v_customer_phone,
    'vehicle_make_model', v_vehicle_make_model,
    'pickup_ist', v_pickup_ist,
    'return_ist', v_return_ist,
    'rental_duration_label', v_duration_label,
    'pickup_type_label', v_pickup_label,
    'delivery_address', v_delivery_display,
    'estimated_amount_display', v_amount_display,
    'estimated_amount_numeric', COALESCE(p_booking.total_amount, 0),
    'booking_status', initcap(coalesce(p_booking.status, 'pending')),
    'whatsapp_opt_in', COALESCE(p_booking.whatsapp_opt_in, false),
    'business_contact_phone', '6302543640'
  );
END;
$$;

ALTER FUNCTION public.build_booking_whatsapp_snapshot(public.bookings) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.build_booking_whatsapp_snapshot(public.bookings) FROM PUBLIC, anon, authenticated;

-- Trigger A: Enqueue ONE admin notification when a booking is created
CREATE OR REPLACE FUNCTION public.enqueue_booking_created_whatsapp_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  v_snapshot := public.build_booking_whatsapp_snapshot(NEW);

  INSERT INTO public.whatsapp_notification_events (
    booking_id,
    event_type,
    idempotency_key,
    recipient_role,
    recipient_phone,
    template_key,
    payload,
    status
  )
  VALUES (
    NEW.id,
    'booking_created_admin',
    'booking_created_admin:' || NEW.id::text,
    'admin',
    '+916302543640',
    'admin_new_booking',
    v_snapshot,
    'pending'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_booking_created_whatsapp_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_booking_created_whatsapp_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_notify_booking_created ON public.bookings;
CREATE TRIGGER trg_whatsapp_notify_booking_created
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_booking_created_whatsapp_notification();

-- Trigger B: Enqueue ONE customer notification ONLY when status transitions pending -> confirmed
CREATE OR REPLACE FUNCTION public.enqueue_booking_confirmed_whatsapp_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
  v_customer_e164 text;
  v_status text;
  v_skip_reason text;
BEGIN
  -- Strictly trigger ONLY on pending -> confirmed status transition
  IF NOT (OLD.status = 'pending' AND NEW.status = 'confirmed') THEN
    RETURN NEW;
  END IF;

  v_snapshot := public.build_booking_whatsapp_snapshot(NEW);
  v_customer_e164 := public.normalize_indian_e164_phone(v_snapshot ->> 'customer_phone');

  IF COALESCE(NEW.whatsapp_opt_in, false) = false THEN
    v_status := 'skipped';
    v_skip_reason := 'Customer did not opt in to WhatsApp notifications at booking time.';
    v_customer_e164 := COALESCE(v_customer_e164, 'opt_out');
  ELSIF v_customer_e164 IS NULL THEN
    v_status := 'skipped';
    v_skip_reason := 'No valid +91 customer mobile number available on booking/profile.';
    v_customer_e164 := 'missing';
  ELSE
    v_status := 'pending';
    v_skip_reason := NULL;
  END IF;

  INSERT INTO public.whatsapp_notification_events (
    booking_id,
    event_type,
    idempotency_key,
    recipient_role,
    recipient_phone,
    template_key,
    payload,
    status,
    skip_reason
  )
  VALUES (
    NEW.id,
    'booking_confirmed_customer',
    'booking_confirmed_customer:' || NEW.id::text,
    'customer',
    v_customer_e164,
    'customer_booking_confirmed',
    v_snapshot,
    v_status,
    v_skip_reason
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_booking_confirmed_whatsapp_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_booking_confirmed_whatsapp_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_notify_booking_confirmed ON public.bookings;
CREATE TRIGGER trg_whatsapp_notify_booking_confirmed
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_booking_confirmed_whatsapp_notification();

-- ----------------------------------------------------------------------------
-- 8. Atomic Worker Claim & Admin Log/Retry RPCs
-- ----------------------------------------------------------------------------
-- Service-role only atomic claim with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_whatsapp_notification_events(
  p_event_id uuid DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.whatsapp_notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.whatsapp_notification_events e
    WHERE (p_event_id IS NULL OR e.id = p_event_id)
      AND (p_booking_id IS NULL OR e.booking_id = p_booking_id)
      AND (p_event_type IS NULL OR e.event_type = p_event_type)
      AND (
        e.status = 'pending'
        OR (
          e.status = 'failed'
          AND e.attempt_count < e.max_attempts
          AND (e.next_retry_at IS NULL OR e.next_retry_at <= now())
        )
        OR (
          -- Recover stale 'processing' lock if an edge worker crashed > 5 minutes ago
          e.status = 'processing'
          AND e.last_attempt_at < (now() - interval '5 minutes')
          AND e.attempt_count < e.max_attempts
        )
      )
    ORDER BY e.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 25))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_notification_events target
  SET
    status = 'processing',
    attempt_count = target.attempt_count + 1,
    last_attempt_at = now()
  FROM candidates
  WHERE target.id = candidates.id
  RETURNING target.*;
END;
$$;

ALTER FUNCTION public.claim_whatsapp_notification_events(uuid, uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_whatsapp_notification_events(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_notification_events(uuid, uuid, text, integer) TO service_role;

-- Admin-only RPC to view delivery logs cleanly in the Admin Dashboard
DROP FUNCTION IF EXISTS public.admin_list_whatsapp_notifications(uuid);

CREATE OR REPLACE FUNCTION public.admin_list_whatsapp_notifications(
  p_booking_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  booking_reference text,
  event_type text,
  recipient_role text,
  recipient_phone text,
  template_key text,
  payload jsonb,
  status text,
  skip_reason text,
  attempt_count integer,
  max_attempts integer,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz
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
    e.id,
    e.booking_id,
    COALESCE(
      NULLIF(trim(b.booking_reference), ''),
      'SSDC-' || upper(substr(replace(e.booking_id::text, '-', ''), 1, 8))
    ) AS booking_reference,
    e.event_type,
    e.recipient_role,
    e.recipient_phone,
    e.template_key,
    e.payload,
    e.status,
    e.skip_reason,
    e.attempt_count,
    e.max_attempts,
    e.last_attempt_at,
    e.next_retry_at,
    e.sent_at,
    e.provider_message_id,
    e.last_error,
    e.created_at
  FROM public.whatsapp_notification_events e
  LEFT JOIN public.bookings b ON b.id = e.booking_id
  WHERE p_booking_id IS NULL OR e.booking_id = p_booking_id
  ORDER BY e.created_at DESC
  LIMIT 100;
END;
$$;

ALTER FUNCTION public.admin_list_whatsapp_notifications(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_whatsapp_notifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_whatsapp_notifications(uuid) TO authenticated;

-- Admin-only RPC to safely queue a failed notification for retry (never resends 'sent' rows)
CREATE OR REPLACE FUNCTION public.admin_retry_whatsapp_notification(p_event_id uuid)
RETURNS public.whatsapp_notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.whatsapp_notification_events;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permissions required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event
  FROM public.whatsapp_notification_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WhatsApp notification event not found.';
  END IF;

  IF v_event.status = 'sent' THEN
    RAISE EXCEPTION 'This notification was already delivered successfully and cannot be sent again.';
  END IF;

  IF v_event.status = 'skipped' THEN
    RAISE EXCEPTION 'Skipped notifications cannot be retried (%).', coalesce(v_event.skip_reason, 'Opt-in or phone missing');
  END IF;

  IF v_event.status = 'processing' THEN
    RAISE EXCEPTION 'This notification is currently being processed. Please wait and refresh.';
  END IF;

  IF v_event.status = 'pending' THEN
    RETURN v_event;
  END IF;

  UPDATE public.whatsapp_notification_events
  SET
    status = 'pending',
    next_retry_at = now(),
    attempt_count = LEAST(attempt_count, max_attempts - 1)
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

ALTER FUNCTION public.admin_retry_whatsapp_notification(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_retry_whatsapp_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_whatsapp_notification(uuid) TO authenticated;
