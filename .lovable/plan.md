# Fix the performance comparison chart

## What's actually wrong

The chart asks for price history for every holding you own *plus* all six benchmark funds in a single request. That request has a hard cap of 40 symbols built in. You currently hold 39 different investments, so the request asks for 44 and is rejected outright before any data is fetched — which is why you always see "Market history could not be loaded right now", every time, regardless of the market data services.

I checked the three data services the app uses directly, and all three are healthy right now:

- US-listed funds and stocks: works, returns exactly 10 years of daily closing prices (a hard limit of that service).
- Toronto-listed (.TO) funds and stocks: works, returns 25+ years of daily closing prices.
- US/CAD exchange rate history: works, 25+ years.

So the data range you want is available: 25 years for anything Canadian-listed, 10 years for anything US-listed.

## The fix

1. **Remove the cause.** Raise the per-request limit well above any realistic portfolio, and only request the three benchmarks you actually have selected instead of all six.
2. **Don't let one bad symbol break the page.** A few of your tickers (for example crypto and some multi-class TSX symbols) have no history at these services. Today the page is all-or-nothing; it will instead draw the chart with whatever loaded and list the ones it couldn't find underneath.
3. **Fetch politely.** Prices will be fetched a handful at a time rather than 44 at once, with one automatic retry, so a burst doesn't get throttled.
4. **Cache per fund, not per date range.** Each symbol's history gets fetched once for its full available window and reused for six hours, so changing the benchmark or revisiting the page is instant instead of a fresh 44-request round trip.
5. **Show the real reason when something does fail.** Instead of the generic sentence, the page will say what's missing (for example "3 of 42 could not be loaded") and offer a Try again button.

## Long-term range

The benchmark line will cover the full life of your ledger (your first transaction is March 2020, so ~6.5 years today) and can go back 25 years for the Canadian benchmarks and 10 years for the US ones. I'll note the 10-year ceiling on US price history in the chart footnote so the comparison is never silently truncated.

No reduction in which benchmarks you can compare against is needed — all three groups stay.

## Technical notes

- `src/lib/history.functions.ts`: raise `symbols` cap from 40 to 150; return per-symbol errors rather than dropping silently.
- `src/routes/_authenticated/performance.tsx`: request only `selection` symbols plus holdings (not `BENCHMARK_GROUPS.flatMap`); render the chart when `history.data` exists even with `missing` entries; replace the blanket `isError` branch with a message + retry.
- `src/lib/history.server.ts`: cache keyed on symbol + full window (TSX 25y, US 10y) and slice on request; add a concurrency-limited runner (6 in flight) with a single retry on non-OK responses.
