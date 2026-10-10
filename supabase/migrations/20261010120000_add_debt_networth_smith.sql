-- Unified debt / net-worth / Smith Manoeuvre inputs (roadmap: net-worth tracking,
-- debt payoff vs invest comparator, Smith Manoeuvre / HELOC tracker).
-- debts: the shared debt inventory (mortgage, HELOC, loans, cards) used by the
--   net-worth total, the payoff-vs-invest comparator, and as facilities for
--   Smith tranches. [{ id, name, kind, balance, rate, payment, deductible }]
-- net_worth: illiquid property values; liquid assets (investments + cash) come
--   from the existing profile balances. { homeValue, otherPropertyValue }
-- smith_tranches: per-tranche Smith Manoeuvre ledger per the verified CRA
--   tracing rules (ITA s.20(1)(c), Folio S3-F6-C1). See SmithTranche in profile.ts.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS debts JSONB,
  ADD COLUMN IF NOT EXISTS net_worth JSONB,
  ADD COLUMN IF NOT EXISTS smith_tranches JSONB;
