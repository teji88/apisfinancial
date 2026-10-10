/**
 * Smith Manoeuvre "morale" math — the tax savings from converting
 * non-deductible mortgage debt into deductible investment debt.
 *
 * Realized: every dollar of deductible HELOC interest is a dollar that would
 * otherwise have been non-deductible mortgage interest, so
 *   tax saved = deductible interest × marginal rate.
 * Projected: simulate the mortgage amortization; each month's principal
 * payment becomes new deductible borrowing, and the growing deductible
 * balance generates future tax shields until the mortgage hits zero.
 *
 * Investment growth is deliberately NOT part of "savings" — that's risk,
 * not savings. Only the tax shield is counted here.
 */

export interface SmithSavingsInputs {
  mortgageBalance: number;
  mortgageRate: number; // decimal
  mortgagePayment: number; // $/mo
  helocRate: number; // decimal
  marginalRate: number; // decimal
  /** Deductible interest paid year-to-date across tranches ($). */
  interestPaidYtd: number;
  /** Deductible interest claimed in all prior years ($). */
  interestClaimedPrior: number;
  /** Current deductible outstanding across tranches ($). */
  deductibleOutstanding: number;
  /** When false, the projection assumes no new redraws: deductible balance stays flat. */
  redraw?: boolean;
  /** Extra rate (decimal) added to the HELOC rate in the projection, e.g. 0.02. */
  rateBump?: number;
}

export interface SmithYearProjection {
  year: number;
  deductibleInterest: number;
  taxSaved: number;
}

export interface SmithSavingsResult {
  /** Tax saved so far this year ($). */
  taxSavedYtd: number;
  /** Tax saved all-time ($). */
  taxSavedAllTime: number;
  /** 0-100: share of total debt now deductible. */
  conversionPct: number;
  /** After-tax cost of the deductible borrowing (decimal). */
  effectiveRate: number;
  /** vs the non-deductible rate — the per-dollar edge. */
  rateEdge: number;
  yearlyProjection: SmithYearProjection[];
  totalProjected: number;
  yearsToConvert: number;
  disclaimer: string;
}

export const SMITH_SAVINGS_DISCLAIMER =
  "Projected savings assume the Smith rhythm continues (every principal dollar " +
  "re-borrowed and invested) and tax rates stay constant. Realized savings use " +
  "your marginal rate on deductible interest claimed. For information only — not tax advice.";

export function computeSmithSavings(inputs: SmithSavingsInputs): SmithSavingsResult {
  const m = (v: number) => Math.max(0, v);
  const marginal = Math.min(0.99, Math.max(0, inputs.marginalRate));

  const taxSavedYtd = m(inputs.interestPaidYtd) * marginal;
  const taxSavedAllTime = (m(inputs.interestPaidYtd) + m(inputs.interestClaimedPrior)) * marginal;

  const totalDebt = m(inputs.mortgageBalance) + m(inputs.deductibleOutstanding);
  const conversionPct = totalDebt > 0 ? (m(inputs.deductibleOutstanding) / totalDebt) * 100 : 0;

  const effectiveRate = m(inputs.helocRate) * (1 - marginal);
  const rateEdge = m(inputs.helocRate) - effectiveRate;

  // Project: amortize the mortgage; each principal dollar becomes deductible (redraw).
  const yearlyProjection: SmithYearProjection[] = [];
  let mort = m(inputs.mortgageBalance);
  let ded = m(inputs.deductibleOutstanding);
  const mr = m(inputs.mortgageRate) / 12;
  const hr = (m(inputs.helocRate) + m(inputs.rateBump ?? 0)) / 12;
  const pmt = m(inputs.mortgagePayment);
  const redraw = inputs.redraw ?? true;
  let year = 1;
  let yearInterest = 0;

  if (mort > 0 && pmt > mort * mr) {
    let month = 0;
    while (mort > 0 && month < 600) {
      const interest = mort * mr;
      const principal = Math.min(mort, pmt - interest);
      mort -= principal;
      if (redraw) ded += principal; // redrawn and invested
      yearInterest += ded * hr;
      month++;
      if (month % 12 === 0 || mort <= 0) {
        const taxSaved = yearInterest * marginal;
        yearlyProjection.push({ year, deductibleInterest: yearInterest, taxSaved });
        year++;
        yearInterest = 0;
      }
    }
  }

  const totalProjected = yearlyProjection.reduce((s, y) => s + y.taxSaved, 0);
  const yearsToConvert = yearlyProjection.length;

  return {
    taxSavedYtd,
    taxSavedAllTime,
    conversionPct,
    effectiveRate,
    rateEdge,
    yearlyProjection,
    totalProjected,
    yearsToConvert,
    disclaimer: SMITH_SAVINGS_DISCLAIMER,
  };
}
