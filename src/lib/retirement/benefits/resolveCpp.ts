/**
 * Resolve the pre-age-adjustment CPP base for a person (in start-year
 * dollars per s.51(1)). If earnings history is provided, calculates CPP
 * from the history. Otherwise falls back to the manual cppAt65 estimate.
 * The caller applies the s.46(3.1) early/late age factor.
 */

import type { PersonScenario } from "../domain/types";
import { calculateCppBenefit } from "./CppCalculator";

export function resolveCppBase(person: PersonScenario): number {
  // If earnings history is provided, calculate from history
  if (person.cppEarningsHistory && person.cppEarningsHistory.length > 0) {
    const result = calculateCppBenefit({
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      earningsHistory: person.cppEarningsHistory,
      futureAnnualEarnings: person.cppFutureEarnings ?? 0,
      ...(typeof person.retirementAge === "number" ? { retirementAge: person.retirementAge } : {}),
      childRearingYears: person.cppChildRearingYears ?? [],
      cppStartAge: typeof person.cppStartAge === "number" ? person.cppStartAge : 65,
    });
    return result.cppBaseMonthly;
  }

  // Fall back to manual estimate
  return Math.max(0, person.cppAt65 ?? 0);
}

/**
 * Resolve post-retirement benefits (PRBs) for someone working while collecting CPP.
 * Returns monthly PRB amount, or 0 if not applicable.
 */
export function resolveCppPrb(person: PersonScenario): { monthly: number; years: number[] } {
  if (!person.cppEarningsHistory || person.cppEarningsHistory.length === 0) {
    return { monthly: 0, years: [] };
  }
  const retirementAge = typeof person.retirementAge === "number" ? person.retirementAge : undefined;
  const cppStartAge = typeof person.cppStartAge === "number" ? person.cppStartAge : 65;
  if (retirementAge === undefined || retirementAge <= cppStartAge) {
    return { monthly: 0, years: [] };
  }
  const result = calculateCppBenefit({
    birthYear: person.birthYear,
    birthMonth: person.birthMonth,
    earningsHistory: person.cppEarningsHistory,
    futureAnnualEarnings: person.cppFutureEarnings ?? 0,
    retirementAge,
    childRearingYears: person.cppChildRearingYears ?? [],
    cppStartAge,
  });
  return { monthly: result.prbMonthly, years: result.prbYears };
}
