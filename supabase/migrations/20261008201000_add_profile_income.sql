-- Main user's other pension income in retirement (today's $/yr).
-- Mirrors the existing spouse_income column; previously the main user's
-- otherIncome was hardcoded to 0 with no UI field.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS income NUMERIC NOT NULL DEFAULT 0;
