# Apis Financial

Canadian portfolio tracker and retirement planner. Track TFSA, RRSP, FHSA and
non-registered accounts in CAD, follow dividend income, benchmark against the
market, and build a retirement plan in today's dollars with Canadian tax rules.

**Live app:** https://www.apisfinancial.app/

## What it does

- **Accounts & ledger** — every Canadian account type (TFSA, RRSP, Spousal RRSP,
  LIRA/LRSP, RESP, RDSP, FHSA, non-registered, corporate) in CAD or USD,
  totalled in Canadian dollars. Deterministic transaction ledger with adjusted
  cost base (ACB), realized gains, money-weighted (XIRR) and time-weighted
  (TWRR) returns.
- **Dividends** — forward annual income, portfolio yield, yield on cost,
  trailing-12-month payments received, ex-dividend calendar, and a 10-year
  compounding projection.
- **Benchmarking** — cash-flow-matched simulation against the S&P 500, TSX
  Composite and global all-equity ETFs using your exact deposit dates and
  amounts.
- **Retirement planner** — CPP/OAS estimates from your own inputs, forced RRIF
  and LIF minimums, OAS clawback handling, pension splitting, and a
  year-by-year tax-efficient withdrawal schedule.
- **Debts & net worth** — mortgages, HELOCs and loans with a payoff-vs-invest
  comparison, plus liquid vs illiquid net worth over time.
- **Statement import** — CSV import plus AI reading of PDF statements and
  screenshots (Google Gemini). AI-drafted transactions always land in a
  verification table for your review before anything is saved to the ledger.

## Pricing

Everything is free: tracking, dividends, benchmarking, debts, properties, the
HELOC investing tracker and the full retirement planner. **Pro ($10/year CAD)**
covers AI statement reading — the one thing that costs money to run.

## Tech stack

- TanStack Start + React 19 + TypeScript + Vite + Tailwind CSS
- Supabase (PostgreSQL, Auth, Edge Functions)
- Stripe (embedded checkout, signed webhooks sync subscriptions to Supabase)
- Google Gemini for AI statement parsing (behind the Pro paywall)
- Vitest for tests

## Development

```sh
npm i
npm run dev
```

Run the test suite with `npx vitest run`, typecheck with `npx tsc --noEmit`,
and build with `npx vite build`.

### Environment

Set these in your environment (or Vercel project settings for deploys):

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase project
- `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (required for checkout;
  the app throws a clear error without it)

Never commit real `.env` files — `.gitignore` covers `.env*`.

## Disclaimer

Apis Financial is an informational and record-keeping tool. It does not provide
financial, investment or tax advice. Always verify figures yourself and consider
a qualified professional.
