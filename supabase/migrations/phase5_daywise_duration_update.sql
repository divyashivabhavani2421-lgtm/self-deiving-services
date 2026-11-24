-- ============================================================================
-- Phase 5 Incremental Update: Custom Day-Wise (1 to 30 Days) Trigger Enforcement
-- Siddipet Self Drive Cars
--
-- Use this script ONLY if you have ALREADY run `phase5_booking_system.sql`.
-- If you have NOT run `phase5_booking_system.sql` yet, run the full
-- `supabase/migrations/phase5_booking_system.sql` file instead.
--
-- Preserves all existing tables, rows, constraints, overlap exclusion
-- (`bookings_no_overlapping_active_slots`), and RLS policies.
-- ============================================================================

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
