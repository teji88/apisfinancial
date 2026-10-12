/**
 * Expand simplified CPP inputs into a detailed year-by-year earnings history.
 *
 * Used when the user switches from the simplified estimate to the detailed
 * editor: their three simplified numbers are converted into per-year rows
 * instead of being discarded, then the simplified fields are blanked/frozen.
 *
 * Placement rules:
 * - Past earnings: `avgIncome` spread over the most recent `yearsWorked`
 *   years ending in `currentYear` (clamped to the contributory period:
 *   max(birthYear + 18, 1966) .. currentYear).
 * - Future earnings: `futureIncome` for each year from `currentYear + 1`
 *   through min(birthYear + retirementAge, birthYear + 65). Post-65 working
 *   years earn PRBs (a separate calculation), not base CPP.
 * - Zero/negative values produce no rows (the editor treats missing as 0).
 */
export interface SimplifiedCppInputs {
  avgIncome: number;
  yearsWorked: number;
  futureIncome: number;
}

export interface YearlyEarning {
  year: number;
  earnings: number;
}

export function expandSimplifiedToDetailed(
  inputs: SimplifiedCppInputs,
  birthYear: number,
  retirementAge: number,
  currentYear: number = new Date().getFullYear(),
): YearlyEarning[] {
  const rows: YearlyEarning[] = [];
  const earliestYear = Math.max(birthYear + 18, 1966);

  const avgIncome = Math.max(0, inputs.avgIncome ?? 0);
  const yearsWorked = Math.max(0, Math.floor(inputs.yearsWorked ?? 0));
  if (avgIncome > 0 && yearsWorked > 0) {
    const pastStart = Math.max(earliestYear, currentYear - yearsWorked + 1);
    for (let y = pastStart; y <= currentYear; y++) {
      rows.push({ year: y, earnings: avgIncome });
    }
  }

  const futureIncome = Math.max(0, inputs.futureIncome ?? 0);
  const lastFutureYear = Math.min(birthYear + Math.max(0, retirementAge), birthYear + 65);
  if (futureIncome > 0) {
    for (let y = currentYear + 1; y <= lastFutureYear; y++) {
      rows.push({ year: y, earnings: futureIncome });
    }
  }

  rows.sort((a, b) => a.year - b.year);
  return rows;
}
