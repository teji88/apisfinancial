ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_referral_code() FROM PUBLIC, anon, authenticated;

UPDATE public.profiles
   SET trial_ends_at = COALESCE(trial_ends_at, now() + interval '30 days'),
       referral_code = COALESCE(referral_code, public.generate_referral_code());

ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles (referral_code);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, trial_ends_at, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    now() + interval '30 days',
    public.generate_referral_code()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'pro',
  price_id text,
  access_from timestamptz NOT NULL DEFAULT now(),
  access_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_rewards TO service_role;

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own referral rewards" ON public.referral_rewards;
CREATE POLICY "read own referral rewards"
  ON public.referral_rewards FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON public.referral_rewards (referrer_id);

CREATE OR REPLACE FUNCTION public.plan_state(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_pro boolean;
  had_access boolean;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN RETURN 'pro'; END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.trial_ends_at > now()) THEN
    RETURN 'pro';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referral_rewards r
    WHERE r.referrer_id = _user_id AND r.access_until > now()
  ) THEN
    RETURN 'pro';
  END IF;

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