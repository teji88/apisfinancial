CREATE OR REPLACE FUNCTION public.free_limit_state(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_accounts integer;
  n_holdings integer;
BEGIN
  SELECT count(*) INTO n_accounts FROM public.accounts WHERE user_id = _user_id;
  SELECT count(*) INTO n_holdings FROM public.holdings WHERE user_id = _user_id;
  IF n_accounts > 1 OR n_holdings > 10 THEN RETURN 'over'; END IF;
  IF n_accounts >= 1 OR n_holdings >= 10 THEN RETURN 'at'; END IF;
  RETURN 'under';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.free_limit_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_limit_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  state text;
  limits text;
  n integer;
BEGIN
  uid := COALESCE(NEW.user_id, OLD.user_id);
  state := public.plan_state(uid);

  IF state = 'lapsed' THEN
    RAISE EXCEPTION 'Your plan has ended, so your data is view-only. Restart Pro to make changes again.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF state = 'free' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    limits := public.free_limit_state(uid);

    IF limits = 'over' THEN
      RAISE EXCEPTION 'You are above the free plan limits (1 account, 10 holdings). Remove the extras or restart Pro to make changes again.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
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
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_plan_limits ON public.accounts;
DROP TRIGGER IF EXISTS holdings_plan_limits ON public.holdings;
DROP TRIGGER IF EXISTS transactions_plan_limits ON public.transactions;

CREATE TRIGGER accounts_plan_limits BEFORE INSERT OR UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();
CREATE TRIGGER holdings_plan_limits BEFORE INSERT OR UPDATE OR DELETE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();
CREATE TRIGGER transactions_plan_limits BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();

CREATE OR REPLACE FUNCTION public.enforce_profile_readonly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.plan_state(NEW.id) = 'lapsed' THEN
    RAISE EXCEPTION 'Your plan has ended, so your settings are view-only. Restart Pro to make changes again.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_readonly ON public.profiles;
CREATE TRIGGER profiles_readonly BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_readonly();