# MapleWealth roadmap

## Phase 1 — done

- [x] Accounts: all Canadian registered + taxable types, CAD/USD
- [x] Transaction ledger (BUY/SELL/DIVIDEND/DRIP/DEPOSIT/WITHDRAWAL/FEE) with FX rate per trade
- [x] Math engine: ACB (weighted average), realized gains, dividends, MWRR (XIRR, Newton-Raphson + bisection), TWRR (sub-periods between external flows)
- [x] Dashboard: totals, day change, account pie, holdings table
- [x] Market data: Yahoo Finance behind a swappable provider interface, hourly cached in `price_cache`, USD/CAD FX
- [x] Auth: email/password + Google

## Phase 2 — AI ingestion (done)

- [x] Drag-and-drop CSV / PDF / screenshot upload
- [x] Lovable AI structured parsing of broker statements (Questrade, Wealthsimple, TD, RBC, IBKR)
- [x] Verification table with confidence flags before committing to the ledger

## Phase 3 — dividends (done)

- [x] Forward annual income, portfolio yield, yield on cost, trailing 12-month received
- [x] Ex-dividend calendar + "approve & record" to the ledger
- [x] 10-year DRIP compounder projection with growth/contribution controls

## Phase 4 — benchmarking (done)

- [x] Cash-flow-matched benchmark simulation vs IVV, XIC.TO, XEQT.TO (direct alpha)

## Phase 5 — Canadian retirement planner (done)

- [x] Assumptions + spouse inputs, manual override mode
- [x] 2026 federal + provincial tax engine, CPP and OAS (with clawback), pension splitting
- [x] RRIF minimums, LIF maximums, age-71 conversions
- [x] Engine 1: when can I retire (depletion chart)
- [x] Engine 2: tax-efficient drawdown solver + year-by-year matrix

## Phase 6 — Retirement planner rebuild (done)

- CPP from past/future earnings and years worked; OAS from years of Canadian residence
- Savings split across TFSA / RRSP / non-registered
- Full spouse profile (earnings, residence, CPP/OAS timing, balances) with pension splitting
- Early registered meltdown to limit forced RRIF income and OAS clawback
- Rebuilt page: summary cards, income sources chart, balances chart, year-by-year and per-person tables

## Phase 7 — Plans and payments (done)

- Free: 1 account, 10 holdings; Pro: unlimited, $1/month or $10/year
- Limits enforced in the database as well as the interface
- Lapsed plan → view-only, nothing deleted
- Invite codes for free access (owner-only screen at /invites)
- Your plan page at /plan with checkout, invite-code redemption and billing management

## Phase 8 — Shared price history library (done)

- [x] `price_history` / `price_history_coverage` / `fx_history` tables (done)
- [x] History server reads from the database, fetches only missing windows, upserts
- [x] Performance page: only selected benchmarks, partial results render, retry
- [x] Nightly backfill appends yesterday's close for every stored symbol
- [x] US-dollar starting value investigated: chart uses real market closes (BN was $46.63 on 2026-01-02, not the $37.51 entered) — not a bug

## Phase 9 — Ticker universe, search rules, cheaper imports

- [x] History request limit raised to 500 symbols
- [x] ~500-ticker Canadian/US universe list (`src/lib/ticker-universe.ts`)
- [x] Slow nightly seed of the price library from that universe (small batch per run)
- [x] Standard ticker search: .TO rule shown, auto-suffix, suggestions, Canadian fallback lookup
- [x] Statement text condensed before AI reading to cut cost
