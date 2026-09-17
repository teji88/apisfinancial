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

## Phase 4 — benchmarking
- [ ] Cash-flow-matched benchmark simulation vs SPY, XIC.TO, XEQT.TO (direct alpha)

## Phase 5 — Canadian retirement planner
- [ ] Assumptions + spouse inputs, manual override mode
- [ ] 2026 federal + provincial tax engine, CPP and OAS (with clawback), pension splitting
- [ ] RRIF minimums, LIF maximums, age-71 conversions
- [ ] Engine 1: when can I retire (depletion chart)
- [ ] Engine 2: tax-efficient drawdown solver + year-by-year matrix
