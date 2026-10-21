-- Build 5: ai_usage table for the AI monthly fair-use cap (50 AI pages/month/Pro user).
-- APPLY IN SUPABASE SQL EDITOR BEFORE BUILD 5 SHIPS. The server code is
-- fail-open: AI features keep working if this table is missing, but quota is
-- not enforced until the migration is applied.

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,              -- YYYY-MM
  pages_used INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Explicit grants: from 2026-10-30 Supabase no longer auto-grants Data API
-- access to new tables, so these are required for the API to reach the table.
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

-- Users can read their own usage rows (powers the "N of 50 left" display).
DROP POLICY IF EXISTS "ai_usage_select_own" ON public.ai_usage;
CREATE POLICY "ai_usage_select_own"
  ON public.ai_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies: all writes go through the service-role
-- client inside the AI server functions (checkAndConsumeAiQuota).
