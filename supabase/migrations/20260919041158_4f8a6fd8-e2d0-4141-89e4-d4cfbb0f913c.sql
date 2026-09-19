CREATE TABLE public.price_history (
  symbol text NOT NULL,
  date date NOT NULL,
  close numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
);

GRANT SELECT ON public.price_history TO authenticated;
GRANT ALL ON public.price_history TO service_role;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read price history" ON public.price_history FOR SELECT TO authenticated USING (true);

CREATE TABLE public.price_history_coverage (
  symbol text PRIMARY KEY,
  currency text NOT NULL DEFAULT 'USD',
  first_date date,
  last_date date,
  unavailable boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.price_history_coverage TO authenticated;
GRANT ALL ON public.price_history_coverage TO service_role;
ALTER TABLE public.price_history_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read price coverage" ON public.price_history_coverage FOR SELECT TO authenticated USING (true);

CREATE TABLE public.fx_history (
  date date PRIMARY KEY,
  usd_cad numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fx_history TO authenticated;
GRANT ALL ON public.fx_history TO service_role;
ALTER TABLE public.fx_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read fx history" ON public.fx_history FOR SELECT TO authenticated USING (true);

CREATE INDEX price_history_symbol_date_idx ON public.price_history (symbol, date DESC);