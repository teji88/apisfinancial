-- Planning inputs for the savings allocator, DB pension UI, and asset-location screen.
-- JSONB keeps these flexible (nested/optional fields) without a column per field.
-- db_pension: single DB pension for the main user (v1); see DbPensionInput in profile.ts
-- asset_holdings: array of { name, taxType, value, yield, account } for asset location
-- employer_match: { offered, matchRatePct, maxPctOfSalary } for the savings allocator
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS db_pension JSONB,
  ADD COLUMN IF NOT EXISTS asset_holdings JSONB,
  ADD COLUMN IF NOT EXISTS employer_match JSONB;
