/**
 * Debt payoff vs invest comparator.
 *
 * Compares putting an extra monthly amount toward a debt versus investing it:
 *   - Payoff side: interest saved (after-tax when deductible) + months shaved.
 *   - Invest side: future value of the same monthly contributions at an
 *     expected return over the accelerated payoff horizon.
 *
 * The payoff saving is guaranteed; the invest outcome is expected, not
 * promised — the result states both and lets the numbers speak.
 */

export interface PayoffVsInvestInputs {
  /** Outstanding balance ($). */
  balance: number;
  /** Annual interest rate as a decimal (e.g. 0.055). */
  annualRate: number;
  /** Current regular payment ($/mo). */
  monthlyPayment: number;
  /** Extra amount being considered ($/mo). */
  extraMonthly: number;
  /** Expected annual investment return as a decimal. */
  expectedReturn: number;
  /** Marginal tax rate as a decimal (for deductible interest). */
  marginalRate: number;
  /** Whether the debt interest is tax-deductible. */
  interestDeductible: boolean;
}

export interface PayoffVsInvestResult {
  baseMonths: number;
  acceleratedMonths: number;
  monthsSaved: number;
  baseInterest: number;
  acceleratedInterest: number;
  /** Interest saved, after-tax when the interest is deductible. */
  interestSavedAfterTax: number;
  /** FV of investing extraMonthly for acceleratedMonths at expectedReturn. */
  investFutureValue: number;
  /** Positive favours investing on expected value; negative favours payoff. */
  netAdvantageInvesting: number;
  warnings: string[];
  disclaimer: string;
}

export const PAYOFF_DISCLAIMER =
  "Comparison based on the rates shown and assumes the extra amount is invested " +
  "monthly at the expected return. Investing involves risk — the payoff saving is " +
  "guaranteed, the investment outcome is not. For information only — not financial advice.";

function amortize(balance: number, annualRate: number, monthlyPayment: number): { months: number; interest: number } {
  if (balance <= 0) return { months: 0, interest: 0 };
  const r = annualRate / 12;
  if (monthlyPayment <= balance * r) {
    // Payment doesn't cover interest — never amortizes.
    return { months: Number.POSITIVE_INFINITY, interest: Number.POSITIVE_INFINITY };
  }
  let b = balance;
  let interest = 0;
  let months = 0;
  while (b > 0 && months < 1200) {
    const i = b * r;
    interest += i;
    b = b + i - monthlyPayment;
    months++;
    if (b < 0) b = 0;
  }
  return { months, interest };
}

export function comparePayoffVsInvest(inputs: PayoffVsInvestInputs): PayoffVsInvestResult {
  const warnings: string[] = [];
  const balance = Math.max(0, inputs.balance);
  const extra = Math.max(0, inputs.extraMonthly);
  const fullPayment = inputs.monthlyPayment + extra;

  const base = amortize(balance, inputs.annualRate, inputs.monthlyPayment);
  const accelerated = amortize(balance, inputs.annualRate, fullPayment);

  if (!Number.isFinite(base.months)) {
    warnings.push(
      "The regular payment does not cover the monthly interest — this debt never amortizes at the current payment.",
    );
  }

  const afterTaxFactor = inputs.interestDeductible ? 1 - inputs.marginalRate : 1;
  const interestSavedAfterTax = Number.isFinite(base.interest)
    ? Math.max(0, base.interest - accelerated.interest) * afterTaxFactor
    : 0;

  // Full-horizon wealth comparison at the base payoff month:
  // - Payoff path: debt gone at acceleratedMonths, then invest the FULL
  //   payment for the remaining months.
  // - Invest path: minimum payments for baseMonths, invest extra all along.
  const rm = inputs.expectedReturn / 12;
  const fv = (pmt: number, n: number) =>
    n > 0 && pmt > 0 ? (rm > 0 ? pmt * ((Math.pow(1 + rm, n) - 1) / rm) : pmt * n) : 0;

  const nBase = Number.isFinite(base.months) ? base.months : 0;
  const nAccel = Number.isFinite(accelerated.months) ? accelerated.months : 0;
  // Wealth at month nBase:
  //   payoff path: -acceleratedInterest + FV(fullPayment, nBase - nAccel)
  //   invest path: -baseInterest + FV(extra, nBase)
  const payoffWealth =
    -(Number.isFinite(accelerated.interest) ? accelerated.interest * afterTaxFactor : 0) +
    fv(fullPayment, nBase - nAccel);
  const investWealth =
    -(Number.isFinite(base.interest) ? base.interest * afterTaxFactor : 0) + fv(extra, nBase);
  const netAdvantageInvesting = investWealth - payoffWealth;

  // For display: FV of the extra invested over the accelerated horizon (simple view).
  const investFutureValue = fv(extra, nAccel);

  return {
    baseMonths: Number.isFinite(base.months) ? base.months : -1,
    acceleratedMonths: Number.isFinite(accelerated.months) ? accelerated.months : -1,
    monthsSaved: Number.isFinite(base.months) && Number.isFinite(accelerated.months)
      ? base.months - accelerated.months
      : 0,
    baseInterest: Number.isFinite(base.interest) ? base.interest : -1,
    acceleratedInterest: Number.isFinite(accelerated.interest) ? accelerated.interest : -1,
    interestSavedAfterTax,
    investFutureValue,
    netAdvantageInvesting,
    warnings,
    disclaimer: PAYOFF_DISCLAIMER,
  };
}
