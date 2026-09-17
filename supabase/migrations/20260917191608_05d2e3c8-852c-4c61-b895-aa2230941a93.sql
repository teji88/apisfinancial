ALTER TABLE public.price_cache
  ADD COLUMN IF NOT EXISTS dividend_rate numeric,
  ADD COLUMN IF NOT EXISTS dividend_yield numeric,
  ADD COLUMN IF NOT EXISTS div_ex_date date,
  ADD COLUMN IF NOT EXISTS div_amount numeric;