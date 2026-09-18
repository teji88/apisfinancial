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