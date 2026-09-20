import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Daily end-of-day price refresh. Called once per weekday by the scheduled job
 * after the North American close. Protected by the private cron secret only
 * (timing-safe comparison) because the /api/public prefix bypasses site auth.
 * Public publishable keys are NOT accepted — they ship in the client bundle.
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
  const { refreshPrices } = await import("@/lib/market.server");

  const { data: holdings, error } = await supabaseAdmin.from("holdings").select("symbol");
  if (error) {
    console.error(`[market] refresh: holdings read failed: ${error.message}`);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const symbols = Array.from(
    new Set((holdings ?? []).map((h) => h.symbol.trim().toUpperCase()).filter(Boolean)),
  );
  const { saved, asOf, quotes } = await refreshPrices(symbols);
  const missing = quotes.filter((q) => q.price == null).map((q) => q.symbol);

  // Extend the shared price-history library: append the latest closes for every
  // symbol we already store, plus any holding symbol we have never fetched.
  let library = { symbols: 0, updated: 0, failed: [] as string[] };
  try {
    const { backfillLibrary } = await import("@/lib/history.server");
    library = await backfillLibrary(symbols);
  } catch (err) {
    console.error(`[history] backfill failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Slowly fill the library from the common Canadian/US ticker universe:
  // a small bounded batch per run so the data sources are never hammered.
  let seed = { remaining: 0, attempted: [] as string[], seeded: 0, failed: [] as string[] };
  try {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("seed") ?? "12");
    const batch = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 40) : 12;
    if (batch > 0) {
      const { seedLibrary } = await import("@/lib/history.server");
      seed = await seedLibrary(batch);
    }
  } catch (err) {
    console.error(`[history] seed failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(
    `[market] refresh: ${saved} prices saved for ${asOf}; missing: ${missing.join(",")}; ` +
      `history: ${library.updated}/${library.symbols} symbols; ` +
      `seed: ${seed.seeded}/${seed.attempted.length} new, ${seed.remaining} left`,
  );
  return Response.json({
    ok: true,
    asOf,
    requested: symbols.length,
    saved,
    missing,
    library,
    seed,
  });
}

export const Route = createFileRoute("/api/public/refresh-prices")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRefresh(request),
      GET: async ({ request }) => handleRefresh(request),
    },
  },
});
