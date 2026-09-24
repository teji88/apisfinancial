# Pro gating, landing page, and dividend review

## 1. Statement upload becomes Pro-only

On the Import page, the drag-and-drop area and "Choose a file" button stay visible but are locked for free users: clicking either opens the upgrade window with the reason "Reading statements with AI is part of Pro." Typing transactions in by hand stays free, so free users can still add trades from that page. The same check is repeated on the server so the AI reading cannot be triggered by a free account another way.

## 2. New landing page at the home address

A public marketing page becomes the site's front door for signed-out visitors. Anyone already signed in is sent straight to their dashboard, exactly as today.

Sections:

- Header with the MapleWealth name, a "Sign in" link and a "Get started" button.
- Hero: what the app does (Canadian portfolio tracking, dividends, retirement planning in today's dollars).
- Features: holdings and accounts across all ten Canadian account types, ledger with adjusted cost base and returns, dividends with ex-dividend tracking and the ten-year compounder, benchmarking against the S&P 500 / TSX / global all-equity, retirement planning with tax-efficient withdrawals, and AI statement import.
- Pricing: Free vs Pro ($1/month or $10/year) side by side with a clear list of exactly what each includes, matching the limits enforced in the app.
- Comparison table: accounts (1 vs unlimited), holdings (10 vs unlimited), statement upload, retirement planner adjustability, everything else marked as included for both.
- Closing call to action and a small footer.

The dashboard moves from the home address to its own address; every menu link, redirect after sign-in, and in-app link is updated to match so nothing breaks.

## 3. Retirement planner: limited adjustability on the free plan

Free users can change: their age, desired after-tax income (defaulting to $60,000), province, and the full earnings/residency history used for CPP and OAS.

Locked for free users, shown with a small "Pro" tag and a tooltip, clicking opens the upgrade window:

- Target retirement age (fixed at 65)
- CPP start age and OAS start age (fixed at 65)
- Inflation (2.5%) and growth (10%)
- Life expectancy (95)
- Marital status (Single, which also keeps the spouse section hidden)
- Manual override mode

Every other part of the retirement section — charts, the plan summary, the year-by-year table, estate tax, the clawback panel — stays fully available to free users. When a free user's saved profile already holds different values (for example from an earlier Pro period), the planner runs on the free defaults so the numbers shown always match what they can control, and their saved values are left untouched for when they upgrade.

## 4. Review a dividend before recording it

"Approve & record" is replaced by a short review step. Clicking it opens a small window pre-filled with the suggested payment — date, number of units, amount per share, total amount and currency — all editable, with the account and symbol shown for context. The total recalculates as units or per-share amount change, and can also be typed directly. "Record dividend" saves the reviewed figures to the ledger; "Cancel" closes without saving. Skip behaves as it does now.

## Technical notes

- `src/routes/_authenticated/index.tsx` is renamed to `src/routes/_authenticated/dashboard.tsx` (`/dashboard`); a new public `src/routes/index.tsx` holds the landing page with its own `head()` metadata. Nav items in `_authenticated/route.tsx`, the post-auth redirect in `auth.tsx`, and the `_authenticated` guard (unauthenticated users go to `/auth`) are updated.
- Gating uses the existing `useEntitlement()` hook: `isPro = tier !== "free"` (owner/pro/invite all count). A small shared `ProLock` wrapper renders the lock tag and opens `UpgradeDialog`.
- Free defaults are applied where `PlannerInputs` is assembled in `retirement.tsx` (target age 65, CPP/OAS start 65, inflation 2.5, growth 10, life expectancy 95, marital status Single, manual override off, desired income falling back to 60,000) without writing to the profile.
- `parseStatement` in `src/lib/import.functions.ts` gains a server-side plan check that throws a clear message for free accounts.
- The dividend review dialog lives in `dividends.tsx` and feeds the existing `addTransaction` mutation with the edited values.
