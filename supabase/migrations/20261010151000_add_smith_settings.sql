-- Smith Manoeuvre settings (per-tab configuration).
-- smith_settings: { priorInterestClaimed: number, helocDebtId: string }
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS smith_settings JSONB;
