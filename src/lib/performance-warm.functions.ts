import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAnchoredComparison,
  completedMonthEnds,
  historyStartFor,
  monthEndHashes,
  validPrefix,
  type Snapshot,
} from "./snapshots";
import { closeOn, DEFAULT_BENCHMARKS, type SeriesMap } from "./benchmark";
import {
  cashBalance,
  cashTrackingIds,
  computePositions,
  type Account,
  type Holding,
  type Transaction,
} from "./finance";

const Input = z.object({ scope: z.string().default("all") });

export type WarmResult = { warmed: number; error?: string };

/**
 * Warm the Performance page's month-end snapshot cache in the background.
 *
 * Mirrors the client logic in performance.tsx: diffs the ledger's month hashes
 * against stored `portfolio_monthly_snapshots`, fetches price history only for
 * the months after the last valid snapshot, runs the anchored comparison, and
 * upserts the fresh rows. Fire-and-forget — any failure returns
 * `{ warmed: 0, error }` instead of throwing, so it can never break a ledger
 * write.
 */
export const warmPerformanceSnapshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<WarmResult> => {
    try {
      return await warm(data.scope, context.userId);
    } catch (e) {
      return { warmed: 0, error: e instanceof Error ? e.message : "Snapshot warm-up failed." };
    }
  });

async function warm(scope: string, userId: string): Promise<WarmResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);

  // Paged reads — Supabase caps at 1000 rows per request (same as the client).
  const accounts: Array<{ id: string; track_cash: boolean }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("accounts")
      .select("id, track_cash")
      .eq("user_id", userId)
      .range(from, from + 999);
    if (error) throw error;
    accounts.push(...((data ?? []) as Array<{ id: string; track_cash: boolean }>));
    if (!data || data.length < 1000) break;
  }
  const holdings: Holding[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("holdings")
      .select("id, account_id, symbol, name, asset_type, currency")
      .eq("user_id", userId)
      .range(from, from + 999);
    if (error) throw error;
    holdings.push(...((data ?? []) as Holding[]));
    if (!data || data.length < 1000) break;
  }
  const transactions: Transaction[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select(
        "id, account_id, holding_id, transaction_type, units, price_per_unit, amount, currency, fx_rate, fee, transaction_date",
      )
      .eq("user_id", userId)
      .range(from, from + 999);
    if (error) throw error;
    transactions.push(...((data ?? []) as Transaction[]));
    if (!data || data.length < 1000) break;
  }

  const txns = scope === "all" ? transactions : transactions.filter((t) => t.account_id === scope);
  const hlds = scope === "all" ? holdings : holdings.filter((h) => h.account_id === scope);
  if (txns.length === 0) return { warmed: 0 };

  const start = txns.map((t) => t.transaction_date).sort()[0]!;
  const monthEnds = completedMonthEnds(start, today);
  if (monthEnds.length === 0) return { warmed: 0 };

  const cashAccounts = cashTrackingIds(accounts as Account[]);
  const hashes = monthEndHashes(monthEnds, txns, hlds, cashAccounts, scope);

  const stored: Snapshot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("portfolio_monthly_snapshots")
      .select("month_end, ledger_hash, portfolio_value, benchmarks")
      .eq("user_id", userId)
      .eq("scope", scope)
      .order("month_end")
      .range(from, from + 999);
    if (error) throw error;
    stored.push(...((data ?? []) as unknown as Snapshot[]));
    if (!data || data.length < 1000) break;
  }

  const benchSymbols = DEFAULT_BENCHMARKS.map((b) => b.symbol);
  const anchors = validPrefix(monthEnds, hashes, stored, benchSymbols);
  if (anchors.length >= monthEnds.length) return { warmed: 0 }; // already fully warm

  const historyStart = historyStartFor(anchors[anchors.length - 1], start);

  // Only positions still held need a price curve — same derivation as the client.
  // computePositions with no quotes still computes units correctly from transactions.
  const positions = computePositions(hlds, txns, {}, 1);
  const held = positions.filter((p) => Math.abs(p.units) > 1e-9);
  const symbols = Array.from(
    new Set([...held.map((p) => p.symbol.toUpperCase()), ...benchSymbols]),
  ).sort();

  const { fetchSymbolHistories, fetchFxHistory } = await import("./history.server");
  const [histories, fx] = await Promise.all([
    fetchSymbolHistories(symbols, historyStart, today),
    fetchFxHistory(historyStart, today),
  ]);
  const history: SeriesMap = new Map();
  for (const h of histories) {
    if (h) history.set(h.symbol.toUpperCase(), { currency: h.currency, points: h.points });
  }

  const fxNow = fx.length > 0 ? fx[fx.length - 1]!.close : 1;
  // Approximate end value from the last history closes. Only the returned
  // `fresh` snapshots are kept — the comparison itself is discarded.
  let portfolioEndValue = Math.max(0, cashBalance(txns, cashAccounts));
  for (const p of held) {
    const h = history.get(p.symbol.toUpperCase());
    if (!h) continue;
    const c = closeOn(h.points, today);
    if (c == null) continue;
    portfolioEndValue += p.units * c * (h.currency === "USD" ? fxNow : 1);
  }

  const { fresh } = buildAnchoredComparison({
    transactions: txns,
    holdings: hlds,
    history,
    fx,
    fxNow,
    portfolioEndValue,
    selection: DEFAULT_BENCHMARKS,
    cashAccounts,
    windowStart: start,
    anchors,
    monthEnds,
    hashes,
  });
  if (fresh.length === 0) return { warmed: 0 };

  // Merge with existing benchmark legs exactly like the client does.
  const existing = new Map(stored.map((s) => [s.month_end, s]));
  const rows = fresh.map((f) => {
    const old = existing.get(f.month_end);
    const benchmarks =
      old && old.ledger_hash === f.ledger_hash
        ? { ...old.benchmarks, ...f.benchmarks }
        : f.benchmarks;
    return { user_id: userId, scope, ...f, benchmarks };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("portfolio_monthly_snapshots")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,scope,month_end" });
    if (error) throw error;
  }
  return { warmed: fresh.length };
}
