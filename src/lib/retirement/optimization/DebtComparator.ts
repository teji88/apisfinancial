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

/** Outcome of amortizing one payment schedule — discriminated, no Infinity/-1 sentinels. */
export type AmortizationOutcome =
  | { ok: true; months: number; interest: number }
  | { ok: false; reason: "never-amortizes" };

export interface PayoffVsInvestSuccess {
  ok: true;
  /** Null when the base scenario never amortizes (regular payment doesn't cover interest). */
  baseMonths: number | null;
  acceleratedMonths: number;
  /** Null when the base scenario never amortizes. */
  monthsSaved: number | null;
  baseInterest: number | null;
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

export interface PayoffVsInvestBlocked {
  ok: false;
  reason: "missing-payment" | "never-amortizes";
  /** Monthly interest on the balance — shown so the user sees the shortfall. */
  monthlyInterest: number;
  monthlyPayment: number;
  /** Regular payment + extra. */
  fullPayment: number;
  disclaimer: string;
}

export type PayoffVsInvestResult = PayoffVsInvestSuccess | PayoffVsInvestBlocked;

export const PAYOFF_DISCLAIMER =
  "Comparison based on the rates shown and assumes the extra amount is invested " +
  "monthly at the expected return. Investing involves risk — the payoff saving is " +
  "guaranteed, the investment outcome is not. For information only — not financial advice.";

export const MISSING_PAYMENT_PROMPT =
  "Enter the regular monthly payment for this debt in the Debts tab — the extra amount goes on top of it, " +
  "so the comparison needs the real payment underneath. (It can't be derived from the balance and rate: " +
  "the remaining amortization is unknowable.)";

function amortize(balance: number, annualRate: number, monthlyPayment: number): AmortizationOutcome {
  if (balance <= 0) return { ok: true, months: 0, interest: 0 };
  const r = annualRate / 12;
  if (monthlyPayment <= balance * r) {
    // Payment doesn't cover interest — never amortizes.
    return { ok: false, reason: "never-amortizes" };
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
  return { ok: true, months, interest };
}

export function comparePayoffVsInvest(inputs: PayoffVsInvestInputs): PayoffVsInvestResult {
  const balance = Math.max(0, inputs.balance);
  const extra = Math.max(0, inputs.extraMonthly);
  const payment = Math.max(0, inputs.monthlyPayment);
  const fullPayment = payment + extra;
  const monthlyInterest = balance * (inputs.annualRate / 12);

  // Missing payment: block. The extra is meaningless without the real payment
  // underneath it — and the payment can't be derived from balance + rate.
  if (payment <= 0) {
    return {
      ok: false,
      reason: "missing-payment",
      monthlyInterest,
      monthlyPayment: payment,
      fullPayment,
      disclaimer: PAYOFF_DISCLAIMER,
    };
  }

  const base = amortize(balance, inputs.annualRate, payment);
  const accelerated = amortize(balance, inputs.annualRate, fullPayment);

  // Even with the extra, the payment doesn't cover monthly interest —
  // the balance would keep growing. Covers genuine interest-only debts too.
  if (!accelerated.ok) {
    return {
      ok: false,
      reason: "never-amortizes",
      monthlyInterest,
      monthlyPayment: payment,
      fullPayment,
      disclaimer: PAYOFF_DISCLAIMER,
    };
  }

  const warnings: string[] = [];
  if (!base.ok) {
    warnings.push(
      "The regular payment does not cover the monthly interest — this debt never amortizes at the current payment.",
    );
  }

  const afterTaxFactor = inputs.interestDeductible ? 1 - inputs.marginalRate : 1;
  const interestSavedAfterTax = base.ok
    ? Math.max(0, base.interest - accelerated.interest) * afterTaxFactor
    : 0;

  // Full-horizon wealth comparison at the base payoff month:
  // - Payoff path: debt gone at acceleratedMonths, then invest the FULL
  //   payment for the remaining months.
  // - Invest path: minimum payments for baseMonths, invest extra all along.
  const rm = inputs.expectedReturn / 12;
  const fv = (pmt: number, n: number) =>
    n > 0 && pmt > 0 ? (rm > 0 ? pmt * ((Math.pow(1 + rm, n) - 1) / rm) : pmt * n) : 0;

  const nBase = base.ok ? base.months : 0;
  const nAccel = accelerated.months;
  // Wealth at month nBase:
  //   payoff path: FV(fullPayment, nBase - nAccel) — debt gone at nAccel,
  //     then the full freed payment is invested for the remaining months.
  //   invest path: FV(extra, nBase) — the extra is invested all along.
  // Interest paid is NOT subtracted on top: both paths spend identical total
  // cash (fullPayment × nBase), and the interest saved by paying off early
  // is already embedded in the payoff path — it is what lets that path invest
  // the larger fullPayment in the tail period. Subtracting cumulative interest
  // as well counted the payoff saving twice and skewed the comparison in
  // favour of payoff by exactly the interest saved.
  const payoffWealth = fv(fullPayment, nBase - nAccel);
  const investWealth = fv(extra, nBase);
  const netAdvantageInvesting = investWealth - payoffWealth;

  // For display: FV of the extra invested over the accelerated horizon (simple view).
  const investFutureValue = fv(extra, nAccel);

  return {
    ok: true,
    baseMonths: base.ok ? base.months : null,
    acceleratedMonths: accelerated.months,
    monthsSaved: base.ok ? base.months - accelerated.months : null,
    baseInterest: base.ok ? base.interest : null,
    acceleratedInterest: accelerated.interest,
    interestSavedAfterTax,
    investFutureValue,
    netAdvantageInvesting,
    warnings,
    disclaimer: PAYOFF_DISCLAIMER,
  };
}
