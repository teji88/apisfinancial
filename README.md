# Canadian Portfolio Tracker

# SYSTEM PROMPT: Build "MapleWealth" — A Production-Ready Web-Based Canadian Portfolio Tracker & Retirement Planner

Build a web application called **MapleWealth**: a Canadian-focused portfolio tracker, AI-powered document parser, dividend projecting engine, and tax-optimized retirement planning suite.

If in doubt at any point, ask question to me before building the app. I want to use my credits in this app if responsible manner, efficiently while getting all these features.

---

## 🛠️ Tech Stack Requirements

- **Frontend**: React (Vite), TypeScript, Tailwind CSS, Shadcn UI components, Lucide Icons, Recharts for financial charts.

- **Backend & Database**: Supabase (PostgreSQL), Supabase Auth, Supabase Edge Functions (Deno/Node.js) for external API calls, AI document parsing, and financial math execution.

- **AI Integrations**: OpenAI API (GPT-4o) via Supabase Edge Functions for parsing CSV, PDF broker statements, and transaction screenshots into structured JSON.

- **Market Data Abstraction**: Backend proxy service targeting Yahoo Finance API or Financial Modeling Prep (EOD updates cached once per day). Structure API calls behind an interface so a paid real-time service (e.g., Polygon.io or Alpha Vantage) can be swapped in later via environment variables.

---

## MODULE 1: Account & Asset Infrastructure (Canadian Accounts)

### Supported Account Types

Provide support for the following Canadian tax-advantaged and taxable accounts:

- `TFSA` (Tax-Free Savings Account)

- `RRSP` (Registered Retirement Savings Plan)

- `Spousal RRSP`

- `LIRA` (Locked-In Retirement Account) / `LRSP`

- `RESP` (Registered Education Savings Plan)

- `RDSP` (Registered Disability Savings Plan)

- `FHSA` (First Home Savings Account)

- `Non-Registered` (Cash / Margin)

- `Corporate` (HoldCo / Taxable)

### Multi-Currency Engine (CAD/USD)

- Default display currency: **CAD**.

- Live/EOD FX conversion rate engine (USD/CAD).

- Store all transactions in their original currency (`CAD` or `USD`), but convert and track account totals, ACB, and returns in CAD using historical or current FX rates.

---

## MODULE 2: Transaction Ledger & Core Financial Math Engine

### Database Schema (PostgreSQL via Supabase)

Implement tables for:

1. `profiles`: User preferences, retirement settings, baseline assumptions.

2. `accounts`: `id`, `user_id`, `account_type`, `account_name`, `currency` (CAD/USD), `institution`.

3. `holdings`: `id`, `account_id`, `symbol`, `name`, `asset_type` (Stock, ETF, Cash), `currency`.

4. `transactions`: `id`, `account_id`, `holding_id`, `transaction_type` (`BUY`, `SELL`, `DIVIDEND`, `DRIP`, `DEPOSIT`, `WITHDRAWAL`, `FEE`), `units`, `price_per_unit`, `fx_rate`, `fee`, `transaction_date`.

### Key Metrics Math Requirements

For every holding and account, compute dynamically:

1. **Adjusted Cost Base (ACB)**: Track cumulative CAD cost for Non-Registered accounts using Canadian tax rules (weighted average cost per share adjusted on every BUY).

2. **Current Market Value**: `Shares Held * Current Unit Price * FX Rate`.

3. **Realized Gains / Losses**:

   - `Capital Gain/Loss = Net Proceeds from Sell - ACB of Sold Shares`.

   - **Crucial Rule**: Include taxable dividends received within the total account-level realized returns calculation.

4. **Money-Weighted Return (MWRR / Internal Rate of Return - IRR)**: Calculate using exact daily cashflow timing (deposits, withdrawals, ending market value) using Newton-Raphson approximation.

5. **Time-Weighted Return (TWRR)**: Break performance into sub-periods between external cash flows to isolate true portfolio performance from deposit/withdrawal timing.

---

## MODULE 3: AI-Powered Transaction Ingestion (CSV / PDF / Screenshots)

### Ingestion Interface

Create a drag-and-drop file upload modal supporting:

1. **Manual Entry**: Form with symbol, transaction type, quantity, price, date, fee, currency.

2. **AI Document & Vision Parser**:

   - Upload Questrade, Wealthsimple, TD Direct Investing, RBC Direct Investing, or Interactive Brokers statements (CSV, PDF, or PNG/JPEG screenshots).

   - Send payload to a Supabase Edge Function running OpenAI GPT-4o with Structured Outputs.

   - Extract standard array of transaction objects:

     ```json

     {

       "transactions": [

         {

           "account_type": "TFSA",

           "date": "YYYY-MM-DD",

           "type": "BUY" | "SELL" | "DIVIDEND",

           "symbol": "XEQT.TO",

           "quantity": 100,

           "price": 28.50,

           "currency": "CAD",

           "fee": 0.00

         }

       ]

     }

     ```

   - Present a **Verification Table UI** showing extracted entries with confidence flags, allowing user edits before committing to the ledger.

---

## MODULE 4: Dividend Intelligence & 10-Year Growth Engine

### Features & Calculations

1. **Forward Annual Income**: Sum of `(Shares Held * Forward Annual Dividend per Share * FX Rate)` across holdings.

2. **Portfolio Yield**: `Forward Annual Dividend Income / Total Portfolio Market Value`.

3. **Yield on Cost (YOC)**: `Forward Annual Dividend Income / Total Portfolio ACB`.

4. **Received (12-Month Rolling)**: Total cash dividends collected in the last 365 days.

5. **Ex-Dividend Ledger Sync**:

   - Track upcoming ex-dividend dates and estimated payout amounts based on current share balance.

   - Provide an "Approve & Record to Ledger" button to auto-create `DIVIDEND` cash entries upon payment date.

6. **10-Year Dividend Compounder Projection Engine**:

   - Interactive projection graph with user controls for:

     - Dividend Growth Rate % (default from stock history or custom slider).

     - Share Price Appreciation Rate % (default 5%-7%).

     - Monthly Recurring Cash Contributions (CAD).

     - Toggle: DRIP (Reinvest Dividends) ON/OFF.

   - Run compounding formula month-by-month and plot projected annual income for years 1 through 10.

---

## MODULE 5: Benchmark Comparison Suite

Compare portfolio performance (per account and combined total) against major market indexes:

- **S&P 500** (`SPY` or `IVV`)

- **S&P/TSX Composite** (`XIC.TO` or `VCN.TO`)

- **All-Equity Global ETF** (`XEQT.TO` or `VEQT.TO`)

### Cash-Flow Matched Benchmark Methodology (Direct Alpha)

Do not use simple static chart overlays. Instead, simulate buying the benchmark ETF with the **exact same cash deposit dates and amounts** as the user's actual portfolio history. Show whether the user's portfolio is outperforming or underperforming the index on a dollar-matched basis.

---

## MODULE 6: Comprehensive Canadian Retirement Planner

### Sync Engine

Automatically pull live CAD values for TFSA, RRSP, LIRA, FHSA, and Non-Registered accounts from the portfolio tracker database into the Retirement Planner. Provide a **"Manual Override Mode"** toggle so users can model custom scenarios without altering their main ledger.

### Global Assumptions Input Interface

- **Personal Details**: Current Age, Target Retirement Age, Marital Status (Single / Married / Common-Law).

- **Spouse Details (if Married)**: Spouse Age, Spouse RRSP/LIRA Balances, Spouse TFSA, Expected Spouse Income.

- **Financial Inputs**: Desired After-Tax Annual Income (in Today's CAD), Expected Inflation Rate (default 2.5%), Expected Portfolio Growth Rate (default 6.0%), Life Expectancy Horizon (e.g., Age 95).

---

### Core Canadian Tax & Government Benefit Logic

1. **2026 Federal & Provincial Tax Integration**:

   - Integrate current tax brackets (Federal + Alberta baseline, with dropdown selector for ON, BC, QC, etc.).

   - Calculate gross taxable income needed to achieve the target after-tax net income.

2. **Canada Pension Plan (CPP) Estimator**:

   - Calculate CPP based on historic/future income profile questionnaire.

   - Base benchmark: Max 2026 payout at age 65 ($1,507.65/month).

   - Adjust for early/late start:

     - **Early (Age 60-64)**: Reduced by 0.6% per month (max 36% reduction at 60).

     - **Delayed (Age 66-70)**: Increased by 0.84% per month (max 42% bonus at 70).

3. **Old Age Security (OAS) & Clawback Engine**:

   - Standard baseline monthly OAS payout at age 65.

   - Delay bonus: +0.6% per month up to age 70 (+36%).

   - **OAS Recovery Tax (Clawback)**: If individual Net World Income exceeds the 2026 threshold of **$95,323 CAD**, enforce a 15% clawback tax on every dollar above $95,323 until OAS is fully clawed back.

4. **Pension Income Splitting (Post-65)**:

   - For married couples, automatically calculate optimal income splitting (up to 50%) of eligible RRIF/LIF/Pension income from the higher-earning spouse to the lower-earning spouse to minimize combined household marginal taxes and eliminate OAS clawbacks.

5. **Account Specific Rules & Mandatory Conversion Engine**:

   - **TFSA**: 100% tax-free withdrawals. Does NOT count toward Net Income for OAS clawback calculations.

   - **RRSP / LIRA Conversion at Age 71**: Automatically force conversion of RRSPs to RRIFs and LIRAs to LIFs at age 71.

   - **RRIF Minimum Schedule**: Enforce government minimum annual withdrawal percentages starting at age 71.

   - **LIF Maximum Schedule**: Enforce strict provincial/federal maximum annual withdrawal caps on LIF accounts.

   - **Non-Registered (Taxable Cash)**: Track capital gains vs. ACB. Only the capital gain portion is subject to inclusion rates and income tax.

---

### Engine 1: "When Can I Retire?" (Depletion & Sustainability Engine)

- Run a forward projection calculation starting at the target retirement age.

- Factor inflation-adjusted annual spending requirements, ongoing CPP/OAS indexing, tax drag, and investment compounding.

- Output: The exact age the user can retire without exhausting funds prior to their life expectancy.

- Render an interactive **Recharts Area/Line Chart** showing total asset trajectory, pointing out the exact year assets reach $0 (or remain sustainable through age 95+).

---

### Engine 2: Tax-Efficient Drawdown Strategy Solver

Implement a dynamic withdrawal sequence algorithm that avoids naive sequential depletion (e.g., depleting non-registered completely, then RRSP, then TFSA).

#### Optimal Withdrawal Mix Logic:

1. Draw taxable RRIF/LIF minimums and taxable non-registered capital gains up to the top of lower tax brackets and **just below the OAS clawback threshold ($95,323)**.

2. Use Non-Registered principal (tax-free capital return) for baseline needs.

3. Top up remaining cash needs dynamically using **TFSA withdrawals** to keep taxable income low and preserve government benefits.

4. Output a **Year-by-Year Withdrawal Schedule Matrix Table**:

   - Columns: `Age`, `RRSP/RRIF Draw`, `LIRA/LIF Draw`, `Non-Reg Draw`, `TFSA Draw`, `CPP Income`, `OAS Income (Net of Clawback)`, `Total Taxes Paid`, `Ending Portfolio Balance`.

---

## 🎨 UI/UX & Layout Architecture

1. **Global Header**: Logo, CAD/USD FX Ticker, Portfolio Overall Value, Net Day Change, Dark/Light mode, User Profile menu.

2. **Tabbed Navigation**:

   - 📊 **Dashboard & Holdings**: Summary metrics, account breakdown pie charts, holdings list with live/EOD quotes.

   - 📑 **Ledger & Transactions**: Transaction table, manual add form, AI file/screenshot parser dropzone.

   - 💵 **Dividends**: Yield stats, forward calendar, ex-dividend manager, 10-Year DRIP growth simulator.

   - 📈 **Performance & Benchmarking**: Matched cash-flow charts comparing portfolio vs. SPY, TSX, XEQT.

   - 🍁 **Retirement Planner**: Engine 1 (Retirement Age Finder), Engine 2 (Tax Drawdown Optimizer), CPP/OAS Calculators, Year-by-Year Withdrawal Table.

Assemble this application cleanly with responsive Tailwind layouts, Shadcn modals, proper TypeScript typing, and edge function support.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://apisfinancial.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/55adf55c-9ad0-4a97-b9f6-850c041d7185).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
