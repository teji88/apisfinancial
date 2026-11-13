import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Quarterly ETF holdings refresh. Called by the scheduled job (once every
 * three months). Reads every ETF any user holds, fetches the issuer's
 * published holdings file for each, and stores the rows in the shared
 * `etf_holdings` library. Protected by the private cron secret only
 * (timing-safe comparison) because the /api/public prefix bypasses site
 * auth. Public publishable keys are NOT accepted — they ship in the
 * client bundle.
 *
 * The Dashboard also refreshes stale holdings on demand when the
 * look-through view opens, so the library seeds itself even before the
 * first scheduled run.
 */
async function handleRefresh(request: Request): Promise<Response> {
  const authFailure = await authenticateCronRequest(request);
  if (authFailure) {
    // Also accept the dedicated refresh key used by the database-scheduled job,
    // compared timing-safe. Never accept public publishable/anon keys.
    const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
    const token = match?.[1];
    const refreshKey = process.env["PRICE_REFRESH_CRON_KEY"];
    if (!token || !refreshKey) return authFailure;
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
    if (!timingSafeEqual(digest(token), digest(refreshKey))) return authFailure;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { refreshEtfHoldings } = await import("@/lib/etfHoldings.server");

  const { data: holdings, error } = await supabaseAdmin
    .from("holdings")
    .select("symbol")
    .eq("asset_type", "ETF");
  if (error) {
    console.error(`[etf-holdings] refresh: holdings read failed: ${error.message}`);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const symbols = Array.from(
    new Set((holdings ?? []).map((h) => h.symbol.trim().toUpperCase()).filter(Boolean)),
  );
  const results = await refreshEtfHoldings(symbols);
  const ok = results.filter((r) => r.status === "ok" || r.status === "fresh").length;

  console.log(
    `[etf-holdings] refresh: ${ok}/${results.length} ETFs current; ` +
      results
        .filter((r) => r.status !== "ok" && r.status !== "fresh")
        .map((r) => `${r.symbol} (${r.status}${r.reason ? `: ${r.reason}` : ""})`)
        .join(", "),
  );
  return Response.json({ ok: true, requested: symbols.length, results });
}

export const Route = createFileRoute("/api/public/refresh-etf-holdings")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handleRefresh(request),
      // GET must never trigger this state-changing, expensive job:
      // link prefetchers, crawlers, and CSRF-style requests can issue
      // GETs, and a bearer token in a URL can be replayed from logs.
      GET: async () =>
        Response.json({ ok: false, error: "Method not allowed — use POST." }, { status: 405 }),
    },
  },
});
