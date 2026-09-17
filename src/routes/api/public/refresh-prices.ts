import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily end-of-day price refresh. Called once per weekday by the scheduled job
 * after the North American close. Protected by a shared secret because the
 * /api/public prefix bypasses site auth.
 */
async function handleRefresh(request: Request): Promise<Response> {
  const accepted = [
    process.env["LOVABLE_CRON_SECRET"],
    process.env["SUPABASE_PUBLISHABLE_KEY"],
    process.env["SUPABASE_ANON_KEY"],
  ].filter((v): v is string => Boolean(v));
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!provided || !accepted.includes(provided)) {
    return new Response("Unauthorized", { status: 401 });
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

  console.log(`[market] refresh: ${saved} prices saved for ${asOf}; missing: ${missing.join(",")}`);
  return Response.json({ ok: true, asOf, requested: symbols.length, saved, missing });
}

export const Route = createFileRoute("/api/public/refresh-prices")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRefresh(request),
      GET: async ({ request }) => handleRefresh(request),
    },
  },
});
