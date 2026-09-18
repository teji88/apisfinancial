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

REVOKE EXECUTE ON FUNCTION public.plan_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  state text;
  n integer;
BEGIN
  state := public.plan_state(COALESCE(NEW.user_id, OLD.user_id));

  IF state = 'lapsed' THEN
    RAISE EXCEPTION 'Your plan has ended, so your data is view-only. Restart Pro to make changes again.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF state = 'free' AND TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'accounts' THEN
      SELECT count(*) INTO n FROM public.accounts WHERE user_id = NEW.user_id;
      IF n >= 1 THEN
        RAISE EXCEPTION 'The free plan includes one account. Upgrade to Pro to add more.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF TG_TABLE_NAME = 'holdings' THEN
      SELECT count(*) INTO n FROM public.holdings WHERE user_id = NEW.user_id;
      IF n >= 10 THEN
        RAISE EXCEPTION 'The free plan includes ten holdings. Upgrade to Pro to add more.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_plan_limits
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();

CREATE TRIGGER holdings_plan_limits
  BEFORE INSERT OR UPDATE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();

CREATE TRIGGER transactions_plan_limits
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();