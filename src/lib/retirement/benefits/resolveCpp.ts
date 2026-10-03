/**
 * Resolve the effective CPP-at-65 value for a person.
 * If earnings history is provided, calculates CPP from the history.
 * Otherwise falls back to the manual cppAt65 estimate.
 */

import type { PersonScenario } from "../domain/types";
import { calculateCppBenefit } from "./CppCalculator";

export function resolveCppAt65(person: PersonScenario): number {
  // If earnings history is provided, calculate from history
  if (person.cppEarningsHistory && person.cppEarningsHistory.length > 0) {
    const result = calculateCppBenefit({
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      earningsHistory: person.cppEarningsHistory,
      futureAnnualEarnings: person.cppFutureEarnings ?? 0,
      childRearingYears: person.cppChildRearingYears ?? [],
      cppStartAge: typeof person.cppStartAge === "number" ? person.cppStartAge : 65,
    });
    return result.cppAt65Monthly;
  }

  // Fall back to manual estimate
  return Math.max(0, person.cppAt65 ?? 0);
}
