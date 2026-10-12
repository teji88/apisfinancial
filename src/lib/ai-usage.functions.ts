import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_PAGES_PER_MONTH, currentMonthKey } from "./ai-usage";

export type AiQuota = {
  used: number;
  limit: number;
  remaining: number;
  /** "YYYY-MM" */
  month: string;
  /** True when the ai_usage table is missing/unreadable — quota not enforced. */
  unknown: boolean;
};

/**
 * Minimal surface of the Supabase admin client used for quota accounting.
 * Intentionally permissive (`any` chain) so the real SupabaseClient and test
 * fakes both satisfy it without deep type gymnastics.
 */
export type AiUsageDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Read this month's AI page usage. Returns null when the ai_usage table is
 * missing or unreadable — callers treat null as "unknown, fail open".
 */
async function readUsage(db: AiUsageDb, userId: string, month: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from("ai_usage")
      .select("pages_used")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();
    if (error) {
      console.warn(`[ai-usage] read failed, failing open: ${error.message}`);
      return null;
    }
    return data?.pages_used ?? 0;
  } catch (e) {
    console.warn(`[ai-usage] read threw, failing open: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Current month's AI usage for the signed-in user. Fail-open when unknown. */
export const getAiUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiQuota> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const month = currentMonthKey();
    const used = await readUsage(supabaseAdmin as AiUsageDb, context.userId, month);
    if (used == null) {
      return { used: 0, limit: AI_PAGES_PER_MONTH, remaining: AI_PAGES_PER_MONTH, month, unknown: true };
    }
    return {
      used,
      limit: AI_PAGES_PER_MONTH,
      remaining: Math.max(0, AI_PAGES_PER_MONTH - used),
      month,
      unknown: false,
    };
  });

export type QuotaCheck =
  | { ok: true; remaining: number | null }
  | { ok: false; remaining: 0 };

/**
 * Check the monthly AI quota and consume `pages` when allowed.
 *
 * Fail-open by design: if the ai_usage table does not exist yet (migration not
 * applied) or any read/write fails, the AI call is ALLOWED and a warning is
 * logged. Quota must never hard-block a paying user because of missing infra.
 */
export async function checkAndConsumeAiQuota(
  db: AiUsageDb,
  userId: string,
  pages: number,
): Promise<QuotaCheck> {
  const month = currentMonthKey();
  const used = await readUsage(db, userId, month);
  if (used == null) return { ok: true, remaining: null };
  if (used + pages > AI_PAGES_PER_MONTH) return { ok: false, remaining: 0 };
  const next = used + pages;
  try {
    const { error } = await db.from("ai_usage").upsert(
      { user_id: userId, month, pages_used: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id,month" },
    );
    if (error) {
      console.warn(`[ai-usage] write failed, failing open: ${error.message}`);
      return { ok: true, remaining: null };
    }
  } catch (e) {
    console.warn(`[ai-usage] write threw, failing open: ${e instanceof Error ? e.message : e}`);
    return { ok: true, remaining: null };
  }
  return { ok: true, remaining: AI_PAGES_PER_MONTH - next };
}
