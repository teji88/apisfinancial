ALTER TABLE public.price_cache ADD COLUMN IF NOT EXISTS as_of date;
GRANT SELECT ON public.price_cache TO authenticated;
GRANT ALL ON public.price_cache TO service_role;