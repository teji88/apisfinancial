# Fix Remaining Performance, Retirement & Auth Issues

Current build is clean (no build/runtime errors in logs). This plan covers the audited issues that are still unfixed. Stripe payment work is explicitly out of scope.

## 1. Performance section math fixes (`src/routes/_authenticated/performance.tsx`, `src/lib/benchmark.ts`)

- **TWR stat card 100× error:** `allTimeReturns` returns unit decimals but the card formats without ×100 — multiply before formatting so −49.4% no longer shows as −0.49%.
- **MWR double-multiply + wrong units:** `xirr()` already returns percent; remove the extra ×100 in `rebase()` and format MWR tooltips/axis as percent, not CAD dollars.
- **Benchmark "$0" on holidays/weekends:** in `closeOn()`, when a trade date has no close on or before it (e.g. Jan 1), fall back to the next available trading-day close instead of returning null; add a 30-day pre-inception buffer when fetching benchmark price history in `history.server.ts`.
- **True Day Zero:** inject the first transaction date as the first chart point at 0.00% for portfolio and benchmarks, instead of starting at the first month-end snapshot.
- **Y-axis in MWR mode:** remove the 100-point span floor so small percentage ranges aren't squashed.
- **Over-annualisation:** only annualise returns when the period is ≥ 1 year; show cumulative return for shorter periods.
- **Date handling:** clamp `setMonth` overflow (Mar 31 − 1 month → Feb 28, not Mar 3) and parse all `YYYY-MM-DD` dates consistently as local midnight.
- **Head-to-head label:** label the table "Head-to-head (all-time)" since period buttons only affect the chart.

## 2. Performance speed-up (`src/routes/_authenticated/performance.tsx`)

- Remove the `!stored.isLoading` gate so price history fetches in parallel with snapshots (cuts 1.5–2.5s off initial load).
- Fetch the full history range once; slice in memory when switching 1M/3M/6M/YTD/1Y/3Y/ALL — no network call per period button.
- Consolidate the three overlapping history queries (`history`, `benchmarkHistory`, `chartHistory`) into one.
- Set `isAnimationActive={false}` on chart lines to remove SVG re-render stutter.

## 3. Retirement page fixes (`src/routes/retirement.tsx`)

- **Stuck on "Loading your plan…":** when a signed-in user has no profile row yet, fall back to default profile values immediately instead of waiting forever.
- **Sticky summary cards:** give cards flexible min-height and text wrapping so "in today's dollars" explanations are never clipped.
- **Clarify "Savings at retirement":** relabel as "Projected at retirement (age X): $y,yyy,yyy" / "Current savings today: $x,xxx" with a note that figures are in today's purchasing power.
- **Navigation:** when signed in, show the standard app nav bar (Dashboard, Ledger, Dividends, Performance, Retirement, Accounts, Import) with Retirement highlighted; guests keep the current guest header.

## 4. Sign-in page (`src/routes/auth.tsx`)

- Remove the duplicate logo: switch `ApisLogo` from `variant="stacked"` to `variant="full"` so the bee mark appears once.

## 5. Dividends minor items (`src/routes/_authenticated/dividends.tsx`)

- Add a sort button to the "Forward income" column; align right-aligned header buttons with `inline-flex items-center justify-end gap-1`.

## Technical details

- No database migrations needed — the growth-rate columns are already applied.
- No new packages.
- Verification: `bunx tsgo --noEmit` clean, then Playwright checks of /performance (TWR/MWR values, day zero, benchmark lines), /retirement (new-profile load, sticky cards, nav), and /auth (single logo).
- Out of scope: Stripe integration (user is working on it), transaction-scaling work (parallel batching, delta sync, virtualized ledger) — can be a follow-up plan.
