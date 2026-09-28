-- Remove the free-trial and refer-a-friend features: everything in Apis
-- Financial is free, so neither is needed anymore.

-- Revert plan_state(): drop the trial and referral-reward checks.
CREATE OR REPLACE FUNCTION public.plan_state(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_pro boolean;
  had_access boolean;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN RETURN 'pro'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.invite_redemptions r
    WHERE r.user_id = _user_id AND (r.access_until IS NULL OR r.access_until > now())
  ) OR EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND (
        (s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        OR (s.status = 'canceled' AND s.current_period_end > now())
      )
  ) INTO has_pro;

  IF has_pro THEN RETURN 'pro'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user_id)
      OR EXISTS (SELECT 1 FROM public.invite_redemptions r WHERE r.user_id = _user_id)
    INTO had_access;

  IF had_access THEN RETURN 'lapsed'; END IF;
  RETURN 'free';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plan_state(uuid) FROM PUBLIC, anon, authenticated;

-- Revert new-user provisioning: no trial window, no referral code.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Drop the referral-rewards table and its code generator entirely.
DROP TABLE IF EXISTS public.referral_rewards;
DROP FUNCTION IF EXISTS public.generate_referral_code();

-- Drop the trial and referral columns from profiles (this also drops the
-- referral_code unique index and the referred_by foreign key automatically).
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS referral_code,
  DROP COLUMN IF EXISTS referred_by;
