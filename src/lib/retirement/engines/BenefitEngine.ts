import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { Money, PersonScenario } from "../domain/types";

export interface BenefitEstimate {
  cpp: Money;
  oas: Money;
  gis: Money;
}

export function estimateGovernmentBenefits(person: PersonScenario, age: number, incomeForBenefits = 0): BenefitEstimate {
  const year = 2026;
  const cppAge = typeof person.cppStartAge === "number" ? person.cppStartAge : 65;
  const cppFactor = cppAge < 65
    ? 1 + (65 - cppAge) * 12 * CANADA_2026_PARAMETERS.cpp.before65MonthlyAdjustment
    : 1 + Math.min(cppAge - 65, 5) * 12 * CANADA_2026_PARAMETERS.cpp.after65MonthlyAdjustment;
  const cpp = age >= cppAge ? (person.cppAt65 ?? 0) * Math.max(0, cppFactor) : 0;

  const oasAge = typeof person.oasStartAge === "number" ? person.oasStartAge : 65;
  const residenceFactor = Math.min(1, Math.max(0, person.oasResidenceYears / 40));
  const oasFactor = 1 + Math.min(Math.max(oasAge - 65, 0), 5) * 12 * CANADA_2026_PARAMETERS.oas.deferralMonthlyAdjustment;
  const baseMonthly = age >= 75
    ? CANADA_2026_PARAMETERS.oas.maxMonthly75Plus
    : CANADA_2026_PARAMETERS.oas.maxMonthly65To74;
  const oas = age >= oasAge ? baseMonthly * residenceFactor * oasFactor * 12 : 0;

  const gis = age >= 65 && age >= oasAge && incomeForBenefits < CANADA_2026_PARAMETERS.gis.singleIncomeCutoff
    ? Math.max(0, CANADA_2026_PARAMETERS.gis.singleMaxMonthly * 12 - Math.max(0, incomeForBenefits) * 0.5)
    : 0;

  return { cpp, oas, gis };
}
