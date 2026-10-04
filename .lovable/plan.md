# Fix the retirement planner: top bar numbers, Compare strategies, Stress tests

## What I found (tested live in the preview)

1. **Compare strategies and Stress tests are both broken by the same bug.** The page gets stuck redrawing itself over and over. The browser log shows "Maximum update depth exceeded". Each redraw counts as "your inputs changed", so the page clears any comparison or stress result the moment it arrives. You click the button, the work finishes, and the result is wiped right away.
   - Cause: when a list (accounts, holdings, transactions) is empty or still loading, the portfolio data hands the page a brand-new empty list on every redraw. The page reads that as new data, rebuilds the plan, clears the results, redraws, and the loop repeats. It's worst for guests and new profiles with no accounts.

2. **Top bar "At 65" shows the wrong year.** It reads the first row of the projection, which is **this year** (for example age 45), not your retirement year. In the default guest plan it shows about $276k, which is roughly today's savings, not what you'd have at 65 after 20 years of saving and growth.

3. Smaller things in the same area:
   - The plan doesn't refresh when you change the "gain ratio" override for non-registered accounts. That setting is missing from the list of things the plan watches.
   - "Lifetime tax" adds up tax from today onward, including working years. The detail text will say so, or it will count retirement years only (your choice below; default is retirement years only, to match the label's purpose).
   - In the Year-by-year table, the per-person "Taxable income" and "Tax" columns are always $0. The engine leaves them blank. They'll be filled from the household figures, or hidden if they can't be split per person.

The "Outcome", "Retire (earliest age)" and "Estate tax" figures were checked and are calculated correctly.

## Fixes

1. Stop the redraw loop: the portfolio data returns the same empty list every time instead of a new one. The planner also only treats inputs as "changed" when a value actually changes. Compare strategies and Stress tests will then keep their results.
2. "At 65" uses the row for your retirement age, so it shows your projected savings that year in today's dollars.
3. Add the gain-ratio setting to what the plan watches.
4. Lifetime tax: count retirement years only and say so in the detail text.
5. Year-by-year per-person tax columns: fill them in or hide them.
6. Check it in the preview: click Compare strategies and Run stress tests, confirm results stay on screen, the redraw error is gone, and "At 65" changes when you change the retirement age.

## Technical notes

- `src/lib/portfolio.ts` `usePortfolio`: replace `data ?? []` with module-level frozen `EMPTY` constants and memoize the `quotes` map so references stay stable.
- `src/routes/retirement.tsx`: add `gainRatioOverride` and `byType.nonregGainRatio` to the `inputs` memo deps. Key the clear-results effect on `JSON.stringify(inputs)` instead of object identity. Make `startBalance` use `rows.find(r => r.age === inputs.retirementAge)` (fallback to the first row at or after that age). `totalTaxes`/`totalClawback` filter to `r.age >= retirementAge`.
- `src/lib/retirement/adapter/oldApiAdapter.ts`: populate `people[].taxableIncome/taxes` if the engine exposes them per person; otherwise remove those two columns from the table.
- No database changes, no new packages. The Stripe work isn't touched.
