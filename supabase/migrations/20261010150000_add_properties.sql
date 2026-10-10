-- Investment-property inputs (roadmap: real estate investing tracker).
-- properties: [{ id, name, currentValue, mortgageId (links to debts),
--   monthlyRent, otherIncome, vacancyPct, cashInvested,
--   expenses: { propertyTax, insurance, maintenance, managementPct,
--               condoFees, utilities, other } }]
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS properties JSONB;
