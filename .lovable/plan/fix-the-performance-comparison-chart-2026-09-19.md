# Fix the performance comparison chart

## What's actually wrong

The chart asks for price history for every holding you own _plus_ all six benchmark funds in a single request. That request has a hard cap of 40 symbols built in. You currently hold 39 different investments, so the request asks for 44 and is rejected outright before any data is fetched — which is why you always see "Market history could not be loaded right now", every time, regardless of the market data services.

I checked the three data services the app uses directly, and all three are healthy right now:

- US-listed funds and stocks: works, returns exactly 10 years of daily closing prices (a hard limit of that service).
- Toronto-listed (.TO) funds and stocks: works, returns 25+ years of daily closing prices.
- US/CAD exchange rate history: works, 25+ years.

So the data range you want is available: 25 years for anything Canadian-listed, 10 years for anything US-listed.

## The fix

1. **Remove the cause.** Raise the per-request limit well above any realistic portfolio, and only request the three benchmarks you actually have selected instead of all six.
2. **Don't let one bad symbol break the page.** A few of your tickers (for example crypto and some multi-class TSX symbols) have no history at these services. Today the page is all-or-nothing; it will instead draw the chart with whatever loaded and list the ones it couldn't find underneath.
3. **Fetch politely.** Prices will be fetched a handful at a time rather than 44 at once, with one automatic retry, so a burst doesn't get throttled.
4. **Build our own price library** (answering your question — yes, exactly that; details below).
5. **Show the real reason when something does fail.** Instead of the generic sentence, the page will say what's missing (for example "3 of 42 could not be loaded") and offer a Try again button.

## Our own shared price history

Every daily closing price the app ever fetches gets stored in a shared table in your own database, keyed by ticker and date and reused by everyone:

- First time anyone adds a stock, the app pulls its full available history once (25 years for Toronto-listed, 10 years for US-listed) and saves it.
- After that, the page reads from your database — no outside call at all. When user 11 adds the same stock, it's instant and free.
- Each night the existing price-refresh job appends yesterday's close for every ticker already in the library, so it keeps growing forward on its own.
- If a ticker is only partly covered (say we have 2021 onward and someone needs 2018), only the missing stretch gets fetched and saved — never the whole thing again.
- The library is shared and read-only to users: it holds nothing personal, just ticker, date and closing price. Size is negligible — roughly 2,500 rows per ticker for 10 years.

Same treatment for the daily US/CAD exchange rate, which is one shared series for the whole app.

This also makes the app resilient: if an outside price service is down or blocks us (Yahoo already does), the charts still work from stored history.

## Long-term range

The benchmark line will cover the full life of your ledger (your first transaction is March 2020, so ~6.5 years today) and can go back 25 years for the Canadian benchmarks and 10 years for the US ones. Once a stretch is stored it stays stored, so even though the US source only offers a 10-year window today, our own library keeps extending beyond that as years pass.

No reduction in which benchmarks you can compare against is needed — all three groups stay.

## Technical notes

- Migration: `price_history (symbol text, date date, close numeric, currency text, primary key (symbol, date))` plus `price_history_coverage (symbol, currency, first_date, last_date, checked_at)` and `fx_history (date, usd_cad)`. `GRANT SELECT` to `authenticated`, `GRANT ALL` to `service_role`, RLS on with an authenticated read-only policy; writes only via service role.
- `src/lib/history.server.ts`: `getSeries(symbol, start, end)` reads coverage → serves from DB when covered, otherwise fetches the missing window from TMX/Nasdaq, upserts, and returns. Concurrency-limited runner (6 in flight) with one retry; in-memory 6h cache stays as the top layer.
- `src/lib/history.functions.ts`: raise `symbols` cap from 40 to 150; report per-symbol misses instead of dropping silently.
- `src/routes/_authenticated/performance.tsx`: request only `selection` symbols plus holdings (not `BENCHMARK_GROUPS.flatMap`); render the chart whenever `history.data` exists, even with `missing` entries; replace the blanket `isError` branch with a reason + retry.
- Nightly backfill added to the existing `PRICE_REFRESH_CRON_KEY` job: append yesterday's close for every symbol in `price_history_coverage`, and warm any holding symbol with no coverage row yet.
