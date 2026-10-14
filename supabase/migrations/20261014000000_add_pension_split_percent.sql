-- Pension income splitting percentage for married couples (post-65).
-- pension_split_percent: 0-50, percentage of eligible pension income to split
-- to the lower-earning spouse. Used by the retirement withdrawal engine.
-- NOTE: This column was referenced by the app code but never had a migration;
-- added 2026-10-14 after production outage (Debts/Retirement pages failing
-- with "column profiles.pension_split_percent does not exist").
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pension_split_percent NUMERIC NOT NULL DEFAULT 0;
