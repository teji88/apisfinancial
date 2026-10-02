# Remaining Fixes After GitHub Sync

Verified the current code after your GitHub changes synced in. These are already fixed: benchmark holiday/weekend price fallback, single logo on sign-in, TWR stat card 100× error, annualisation only for periods ≥ 1 year, MWR chart reworked to dollar-value mode, sticky card min-height, and the clarified "Projected at retirement" savings card wording.

Still outstanding:

## 1. Retirement page stuck on "Loading your plan…" for new profiles (`src/routes/retirement.tsx`)

- Line ~270 still has `if (!profileQuery.data) return;` — a signed-in user whose profile row doesn't exist yet waits forever.
- Fix: when the profile query has finished and returned nothing, fall back to the default profile values (with the user's ID) so the planner renders immediately.

## 2. App navigation on /retirement (`src/routes/retirement.tsx`)

- Signed-in users still only see "Back to dashboard" (line ~552).
- Fix: when signed in, render the standard app nav bar (Dashboard, Ledger, Dividends, Performance, Retirement, Accounts, Import) with Retirement highlighted; guests keep the current guest header.

## 3. Performance page speed (`src/routes/_authenticated/performance.tsx`)

- Line ~239 still gates the history fetch on `!stored.isLoading` — remove it so price history fetches in parallel with snapshots (cuts 1.5–2.5s off initial load).
- `benchmarkHistory` and `chartHistory` still fire a new server request every time the period button changes — fetch the full range once and slice in memory for 1M/3M/6M/YTD/1Y/3Y/ALL, so period switching is instant.
- Add `isAnimationActive={false}` to the chart lines to remove SVG re-render stutter.

## 4. True Day Zero on the performance chart (`src/routes/_authenticated/performance.tsx`)

- The chart still starts at the first month-end snapshot, not the first trade date.
- Fix: inject the first transaction date as the first chart point at 0.00% for the portfolio and each benchmark.

## 5. Dividends table minor item (`src/routes/_authenticated/dividends.tsx`)

- "Forward income" column header (line ~661) has no sort button while neighbouring columns do — add `sortBy("forwardIncome")` consistent with the others.

## Technical details

- No database migrations, no new packages.
- Verification: `bunx tsgo --noEmit` clean, then Playwright checks of /retirement (fresh-profile load, nav bar), /performance (day-zero point, instant period switching), and /dividends (sort button).
- Out of scope: Stripe integration (you're handling it), transaction-scaling work (parallel batching, delta sync, virtualized ledger) — separate follow-up if wanted.
