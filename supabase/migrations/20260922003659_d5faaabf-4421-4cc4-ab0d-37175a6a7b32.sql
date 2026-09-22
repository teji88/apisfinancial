CREATE OR REPLACE FUNCTION public.invite_code_redeemable(_code_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invite_codes
    WHERE id = _code_id
      AND NOT revoked
      AND (expires_at IS NULL OR expires_at > now())
      AND uses < max_uses
  )
$$;

REVOKE ALL ON FUNCTION public.invite_code_redeemable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_code_redeemable(uuid) TO authenticated;

CREATE POLICY "users record own valid redemption"
ON public.invite_redemptions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.invite_code_redeemable(code_id)
);