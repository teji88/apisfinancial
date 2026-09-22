DROP POLICY IF EXISTS "users record own valid redemption" ON public.invite_redemptions;
DROP FUNCTION IF EXISTS public.invite_code_redeemable(uuid);