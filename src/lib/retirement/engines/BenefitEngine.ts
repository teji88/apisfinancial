import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { Money, PersonScenario, PersonRole } from "../domain/types";

export interface BenefitEstimate {
  cpp: Money;
  oas: Money;
  gis: Money;
}

export interface BenefitHouseholdContext {
  householdSize?: number;
  partnerAge?: number;
  partnerReceivesOas?: boolean;
  partnerIncomeForBenefits?: Money;
  previousYearIncome?: Money;
  inflationRate?: number;
  calendarYear?: number;
}

/**
 * Government benefit estimator used by the monthly retirement simulation.
 *
 * Amounts are expressed as annual nominal dollars because the coordinator
 * converts them to monthly cash flow. The rules dataset is anchored to the
 * July-September 2026 published rates and future years are indexed using the
 * scenario's inflation assumption. This keeps economic assumptions separate
 * from legal benefit rules while avoiding accidental double-indexing.
 */
export function estimateGovernmentBenefits(
  person: PersonScenario,
  age: number,
  incomeForBenefits = 0,
  context: BenefitHouseholdContext = {},
): BenefitEstimate {
  const calendarYear = context.calendarYear ?? 2026;
  const inflationRate = Math.max(0, context.inflationRate ?? 0);
  const yearsFrom2026 = Math.max(0, calendarYear - 2026);
  const indexFactor = Math.pow(1 + inflationRate / 100, yearsFrom2026);

  const cppStartAge = typeof person.cppStartAge === "number"
    ? Math.min(CANADA_2026_PARAMETERS.cpp.startMaxAge, Math.max(CANADA_2026_PARAMETERS.cpp.startMinAge, person.cppStartAge))
    : 65;

  const cppMonthsFrom65 = Math.round((cppStartAge - 65) * 12);
  const cppAdjustment = cppMonthsFrom65 < 0
    ? 1 + cppMonthsFrom65 * Math.abs(CANADA_2026_PARAMETERS.cpp.before65MonthlyAdjustment)
    : 1 + cppMonthsFrom65 * CANADA_2026_PARAMETERS.cpp.after65MonthlyAdjustment;

  const cppAt65Annual = Math.max(0, person.cppAt65 ?? 0) * 12;
  const cppAnnual = age >= cppStartAge
    ? cppAt65Annual * Math.max(0, cppAdjustment) * indexFactor
    : 0;

  const oasStartAge = typeof person.oasStartAge === "number"
    ? Math.min(CANADA_2026_PARAMETERS.oas.startMaxAge, Math.max(CANADA_2026_PARAMETERS.oas.startMinAge, person.oasStartAge))
    : 65;

  const residenceFactor = Math.min(1, Math.max(0, person.oasResidenceYears / 40));
  const oasDeferralMonths = Math.round(Math.max(0, oasStartAge - 65) * 12);
  const oasDeferralFactor = 1 + Math.min(
    oasDeferralMonths * CANADA_2026_PARAMETERS.oas.deferralMonthlyAdjustment,
    CANADA_2026_PARAMETERS.oas.maxDeferralAdjustment,
  );

  const baseOasMonthly = age >= 75
    ? CANADA_2026_PARAMETERS.oas.maxMonthly75Plus
    : CANADA_2026_PARAMETERS.oas.maxMonthly65To74;

  const oasAnnual = age >= oasStartAge
    ? baseOasMonthly * 12 * residenceFactor * oasDeferralFactor * indexFactor
    : 0;

  // GIS uses the prior year's income for the July-to-June entitlement period.
  // OAS itself is excluded from GIS income. The general single-person
  // reduction is approximately $1 of GIS for every $2 of other income.
  // Couple calculations use the published marital-status thresholds and the
  // appropriate maximum benefit category.
  const priorYearIncome = Math.max(0, context.previousYearIncome ?? incomeForBenefits);
  const partnerIncome = Math.max(0, context.partnerIncomeForBenefits ?? 0);
  const combinedIncome = priorYearIncome + partnerIncome;
  const partnerAge = context.partnerAge ?? 0;
  const partnerReceivesOas = Boolean(context.partnerReceivesOas);

  let gisMonthlyMaximum = 0;
  let gisIncomeThreshold = 0;

  if ((context.householdSize ?? 1) <= 1) {
    gisMonthlyMaximum = CANADA_2026_PARAMETERS.gis.singleMaxMonthly;
    gisIncomeThreshold = CANADA_2026_PARAMETERS.gis.singleIncomeCutoff;
  } else if (partnerReceivesOas) {
    gisMonthlyMaximum = CANADA_2026_PARAMETERS.gis.spouseOasMaxMonthly;
    gisIncomeThreshold = CANADA_2026_PARAMETERS.gis.spouseOasIncomeCutoff;
  } else if (partnerAge >= 60 && partnerAge < 65) {
    // The current published category for a spouse receiving the Allowance is
    // the same maximum/threshold as a spouse receiving OAS.
    gisMonthlyMaximum = CANADA_2026_PARAMETERS.gis.spouseOasMaxMonthly;
    gisIncomeThreshold = CANADA_2026_PARAMETERS.gis.spouseOasIncomeCutoff;
  } else {
    gisMonthlyMaximum = CANADA_2026_PARAMETERS.gis.singleMaxMonthly;
    gisIncomeThreshold = CANADA_2026_PARAMETERS.gis.spouseNotOasIncomeCutoff;
  }

  const gisEligible = age >= 65 && age >= oasStartAge && oasAnnual > 0;
  const gisReductionIncome = (context.householdSize ?? 1) <= 1
    ? priorYearIncome
    : combinedIncome;

  const gisAnnual = gisEligible && gisReductionIncome < gisIncomeThreshold
    ? Math.max(
        0,
        gisMonthlyMaximum * 12 - Math.max(0, gisReductionIncome) * 0.5,
      ) * indexFactor
    : 0;

  return {
    cpp: cppAnnual,
    oas: oasAnnual,
    gis: gisAnnual,
  };
}
