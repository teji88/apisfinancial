# Fix price fetching + once-a-day price updates

## What's happening now

Your LIRA account holds 100 FNDX, but the price lookup comes back empty. I checked the live request the app made at 18:54: it completed successfully but returned zero quotes and fell back to the default 1.37 USD/CAD rate, and the saved-prices table is still empty. So the app is asking for prices correctly — the price source is returning nothing when called from the server.

Calling Yahoo directly from this sandbox does work, so the most likely cause is Yahoo refusing or throttling requests coming from the app server (it commonly blocks datacenter traffic). Right now that failure is swallowed silently, which is why you just see blanks instead of an error. Confirming the exact cause is step one below, before anything else is changed.

## Plan

1. **Confirm the cause.** Add temporary server-side logging around the price call and run one real request, so we see the actual status/response Yahoo returns to the app server rather than guessing.

2. **Make the price source reliable.**
   - If Yahoo is being blocked, switch the default source to a free endpoint that allows server traffic (Stooq end-of-day, which covers US and Toronto-listed tickers, with Yahoo kept as a secondary attempt), keeping the existing swap-in structure so a paid provider can replace it later with no other changes.
   - Keep the USD/CAD rate from a dedicated free FX source instead of defaulting to 1.37 silently.
   - Surface failures: if a symbol can't be priced, the app says "price unavailable" for that holding instead of showing nothing.

3. **Once-a-day updates, as you asked.**
   - Prices become end-of-day values refreshed once per trading day, not hourly.
   - A scheduled daily job (after North American market close) refreshes every symbol anyone holds, plus the USD/CAD rate, and stores them.
   - The app reads stored prices instantly; it only fetches live if a symbol has never been priced (for example right after you add a new holding).
   - A "Prices as of <date>" label in the header, with a manual Refresh button if you want an intraday update.

4. **Fix the stored-prices permissions.** The price table currently has no write permission granted to the background job's role, which would block the daily save even once fetching works. This is a small database change.

5. **Verify end to end.** Run the daily job manually, confirm FNDX and the USD/CAD rate land in storage, and confirm your dashboard shows a real market value and day change for the 100 FNDX position.

## Technical notes

- `src/lib/market.server.ts`: add a Stooq provider (`https://stooq.com/q/l/?s=<sym>&f=sd2t2ohlcv&e=csv`, symbol mapping `FNDX` → `fndx.us`, `XIC.TO` → `xic.ca`) behind the existing `MarketProvider` interface; chain providers with fallback; FX via an FX endpoint rather than the `USDCAD=X` ticker.
- `src/lib/market.functions.ts`: cache window becomes "same trading day"; log provider failures; return a `stale`/`asOf` flag per quote.
- New public server route `src/routes/api/public/refresh-prices.ts` guarded by `LOVABLE_CRON_SECRET`, scheduled with `pg_cron` + `pg_net` once daily at 21:30 UTC weekdays. One run per day only.
- Migration: `GRANT ALL ON public.price_cache TO service_role;` and add an `as_of` date column.
- Dashboard/header: show `Prices as of`, manual refresh invalidates the `["quotes"]` query.
