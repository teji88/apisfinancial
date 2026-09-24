CREATE TABLE public.portfolio_monthly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL,
  month_end date NOT NULL,
  ledger_hash text NOT NULL,
  portfolio_value numeric NOT NULL DEFAULT 0,
  benchmarks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, month_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_monthly_snapshots TO authenticated;
GRANT ALL ON public.portfolio_monthly_snapshots TO service_role;
ALTER TABLE public.portfolio_monthly_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own snapshots" ON public.portfolio_monthly_snapshots FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER portfolio_monthly_snapshots_updated BEFORE UPDATE ON public.portfolio_monthly_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();