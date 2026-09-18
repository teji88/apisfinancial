REVOKE EXECUTE ON FUNCTION public.enforce_plan_limits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_readonly() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.free_limit_state(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_state(uuid) FROM PUBLIC, anon;