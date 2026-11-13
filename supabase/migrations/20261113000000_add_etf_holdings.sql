-- ETF look-through holdings: shared library, like price_history.
-- One row per (ETF, underlying holding). The latest as_of per ETF is the
-- current view; rows are replaced per ETF on each refresh so a shrinking
-- fund leaves no stale rows behind. Underlying rows that are themselves
-- ETFs (fund-of-funds, e.g. XEQT -> XIC) resolve recursively in app code.
-- Refresh: quarterly via /api/public/refresh-etf-holdings, plus an
-- on-demand staleness refresh from the Dashboard (fresh = as_of within
-- 90 days). Holdings come from the issuer's own published file
-- (iShares CSV first); an ETF with no adapter simply has no rows, and
-- the look-through shows its value as unmapped rather than guessing.
CREATE TABLE IF NOT EXISTS public.etf_holdings (
  etf_symbol TEXT NOT NULL,
  underlying_symbol TEXT NOT NULL,
  underlying_name TEXT NOT NULL DEFAULT '',
  weight NUMERIC NOT NULL,
  as_of DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'ishares',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (etf_symbol, underlying_symbol)
);
CREATE INDEX IF NOT EXISTS etf_holdings_etf_symbol_idx ON public.etf_holdings (etf_symbol);

GRANT SELECT ON public.etf_holdings TO authenticated;
GRANT ALL ON public.etf_holdings TO service_role;
