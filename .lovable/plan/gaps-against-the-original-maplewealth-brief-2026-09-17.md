# Gaps against the original MapleWealth brief

Everything in the six original modules is built and working: the ten Canadian account types, CAD/USD tracking, the ledger with ACB / realized gains / MWRR / TWRR, AI statement import with a review table, dividends with ex-dividend sync and the 10-year compounder, cash-flow-matched benchmarking, and the retirement planner with both engines.

Comparing the brief line by line against the app, six smaller items are still missing.

## What is missing

1. **Editing a transaction.** You can add and delete ledger entries, but not correct one. A wrong price or date has to be deleted and re-entered.
2. **Automatic exchange rate on a trade date.** The brief asked for historical FX conversion. Today the rate is typed in by hand on each entry (and the AI import always assumes 1.0). It should look up the USD/CAD rate for the transaction date and pre-fill it.
3. **Manual entry inside the upload window.** The brief described one drag-and-drop window offering both a manual form and the AI parser. Manual entry currently lives on the Ledger page only.
4. **Choosing the benchmark fund.** Comparison is locked to three funds (IVV, XIC.TO, XEQT.TO). The brief listed alternates — SPY, VCN.TO, VEQT.TO — so each benchmark should be switchable.
5. **A profile menu.** The header has only a sign-out button. Name, home province and display currency can only be changed from inside the Retirement page.
6. **RESP and RDSP in the retirement plan.** Those accounts can be tracked, but the planner ignores their balances. They should be shown, with a note that they are not retirement income (RESP is for education), and optionally included.

## Proposed order

Fix 1 and 2 first (they affect the accuracy of every number), then 5, then 3, 4 and 6.

## Technical notes

- Transaction edit: add an update mutation in `src/lib/portfolio.ts` and an edit dialog on `src/routes/_authenticated/ledger.tsx`, reusing the existing add form.
- Historical FX: extend `src/lib/history.server.ts` (Frankfurter already returns daily USD→CAD) with a single-date lookup exposed through a server function; call it when the date or currency changes in the ledger form and in the import review table.
- Profile menu: dropdown in `src/routes/_authenticated/route.tsx` writing to the existing `profiles` row (display_name, province, base_currency).
- Benchmark choice: make `BENCHMARKS` in `src/lib/benchmark.ts` a set of options per category with a selector on the Performance page.
- RESP/RDSP: add to the account-type buckets in `src/routes/_authenticated/retirement.tsx` with an include/exclude switch.
- No database changes are needed for any of this.
