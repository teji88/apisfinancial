import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import { GIS_TABLES_2026_Q3, type GisBand } from "../rules/gisTables2026Q3";
import type { Money, PersonScenario, PersonRole } from "../domain/types";
import { resolveCppBase, resolveCppPrb } from "../benefits/resolveCpp";

export interface BenefitEstimate {
  cpp: Money;
  oas: Money;
  gis: Money;
  allowance: Money;
}

export interface BenefitHouseholdContext {
  householdSize?: number;
  partnerAge?: number;
  partnerReceivesOas?: boolean;
  partnerOasResidenceYears?: number;
  survivor?: boolean;
  partnerIncomeForBenefits?: Money;
  previousYearIncome?: Money;
  /** Employment and self-employment income included in previousYearIncome. */
  previousYearEmploymentIncome?: Money;
  /** Partner employment/self-employment income included in partnerIncomeForBenefits. */
  partnerPreviousYearEmploymentIncome?: Money;
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
function applyGisEmploymentExemption(nonEmploymentIncome: number, employmentIncome: number): number {
  const earnings = Math.max(0, employmentIncome);
  const fullExemption = Math.min(earnings, 5_000);
  const partialExemption = Math.max(0, Math.min(earnings, 15_000) - 5_000) * 0.5;
  return Math.max(0, nonEmploymentIncome + earnings - fullExemption - partialExemption);
}

/** Looks up Service Canada's published benefit for the income band. */
function monthlyPublishedBenefit(table: readonly GisBand[], annualIncome: number, amountColumn: number): number {
  const income = Math.max(0, annualIncome);
  let low = 0;
  let high = table.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const band = table[mid];
    if (!band) return 0;
    if (income < band[0]) high = mid - 1;
    else if (income > band[1]) low = mid + 1;
    else return (band[amountColumn] ?? 0) / 100;
  }
  return 0;
}

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

  const cppBaseAnnual = resolveCppBase(person) * 12;
  // s.51(1): with earnings history the CPP base is in start-year dollars
  // (MPEA of the pension start year), so price inflation runs from the
  // start year. The manual fallback is a today's-dollars age-65 estimate,
  // so it inflates from 2026 as before.
  const hasCppHistory = !!person.cppEarningsHistory && person.cppEarningsHistory.length > 0;
  const cppBaseYear = hasCppHistory && typeof person.birthYear === "number"
    ? person.birthYear + Math.min(cppStartAge, CANADA_2026_PARAMETERS.cpp.startMaxAge)
    : 2026;
  const cppIndexFactor = Math.pow(
    1 + inflationRate / 100,
    Math.max(0, calendarYear - cppBaseYear),
  );
  // PRBs: earned by working while collecting CPP. Each PRB starts the January
  // after its contribution year. Only include PRBs for years already worked.
  const prbInfo = resolveCppPrb(person);
  const earnedPrbYears = prbInfo.years.filter((y) => y < calendarYear);
  const prbAnnual = earnedPrbYears.length > 0
    ? (prbInfo.monthly * 12 * earnedPrbYears.length) / prbInfo.years.length
    : 0;
  const cppAnnual = age >= cppStartAge
    ? (cppBaseAnnual * Math.max(0, cppAdjustment) + prbAnnual) * cppIndexFactor
    : 0;

  const oasStartAge = typeof person.oasStartAge === "number"
    ? Math.min(CANADA_2026_PARAMETERS.oas.startMaxAge, Math.max(CANADA_2026_PARAMETERS.oas.startMinAge, person.oasStartAge))
    : 65;

  // OAS Act s.3(4): partial pensions use only COMPLETED years of residence —
  // a fraction of a year counts as nothing (whole years, floored).
  const wholeResidenceYears = Math.floor(Math.max(0, person.oasResidenceYears));
  const oasDeferralMonths = Math.round(Math.max(0, oasStartAge - 65) * 12);
  const oasDeferralFactor = 1 + Math.min(
    oasDeferralMonths * CANADA_2026_PARAMETERS.oas.deferralMonthlyAdjustment,
    CANADA_2026_PARAMETERS.oas.maxDeferralAdjustment,
  );

  // OAS Act s.7.1(3) "greatest of" for deferred pensions (the default unless
  // the person elects otherwise):
  //   (a) deferral-increased full pension (only if qualified for a full pension),
  //   (b) deferral-increased FROZEN partial pension (residence at qualification),
  //   (c) partial pension recalculated at approval — residence earned during
  //       the deferral counts, but the deferral boost does NOT (never both).
  // Crossover: each deferral year adds 7.2% to (b) but at most 1/40th to (c);
  // below ~14/40ths, (c) can win in early deferral years. (b) may exceed 100%
  // of the base full pension (e.g. 30/40 × 1.36 = 1.02) — no cap at the full
  // amount. Assumes continued Canadian residence during deferral for (c).
  const deferralYears = Math.max(0, oasStartAge - 65);
  const frozenFraction = Math.min(1, wholeResidenceYears / 40);
  const freshYears = Math.min(40, wholeResidenceYears + Math.floor(deferralYears));
  const freshFraction = freshYears / 40;
  const oasFactor = Math.max(frozenFraction * oasDeferralFactor, freshFraction);

  const baseOasMonthly = age >= 75
    ? CANADA_2026_PARAMETERS.oas.maxMonthly75Plus
    : CANADA_2026_PARAMETERS.oas.maxMonthly65To74;

  // OAS Act s.3: a partial pension needs at least 10 years of residence when
  // applying from inside Canada (20 from outside — not modelled; the app
  // assumes a Canadian resident applicant). Assessed at approval, so residence
  // earned during deferral can lift someone over the minimum. Below 10
  // completed years there is no pension at all, not a sub-10/40 fraction.
  const oasEligible = freshYears >= 10;
  const oasAnnual = age >= oasStartAge && oasEligible
    ? baseOasMonthly * 12 * oasFactor * indexFactor
    : 0;

  // GIS/Allowance use the prior year's income for the July-to-June entitlement period.
  // OAS itself is excluded from GIS income. Employment/self-employment earnings
  // receive the statutory $5,000 full + next $10,000 at 50% exemption.
  // Couple calculations use the published marital-status thresholds and the
  // appropriate maximum benefit category.
  const priorYearIncome = Math.max(0, context.previousYearIncome ?? incomeForBenefits);
  const priorYearEmploymentIncome = Math.max(0, context.previousYearEmploymentIncome ?? 0);
  const partnerIncome = Math.max(0, context.partnerIncomeForBenefits ?? 0);
  const partnerEmploymentIncome = Math.max(0, context.partnerPreviousYearEmploymentIncome ?? 0);
  const adjustedPriorYearIncome = applyGisEmploymentExemption(
    Math.max(0, priorYearIncome - priorYearEmploymentIncome),
    priorYearEmploymentIncome,
  );
  const adjustedPartnerIncome = applyGisEmploymentExemption(
    Math.max(0, partnerIncome - partnerEmploymentIncome),
    partnerEmploymentIncome,
  );
  const combinedIncome = adjustedPriorYearIncome + adjustedPartnerIncome;
  const partnerAge = context.partnerAge ?? 0;
  const partnerReceivesOas = Boolean(context.partnerReceivesOas);

  const wholePartnerResidenceYears = Math.floor(Math.max(0, context.partnerOasResidenceYears ?? 0));
  const hasPartner = (context.householdSize ?? 1) > 1;
  const partnerCanReceiveAllowance = partnerAge >= 60 && partnerAge < 65 &&
    wholePartnerResidenceYears >= 10;
  const ownResidenceEligible = oasEligible;
  const gisEligible = age >= 65 && age >= oasStartAge && oasAnnual > 0 && ownResidenceEligible;
  const incomeAt2025Dollars = hasPartner ? combinedIncome / indexFactor : adjustedPriorYearIncome / indexFactor;
  const table = !hasPartner ? GIS_TABLES_2026_Q3.single
    : partnerCanReceiveAllowance ? GIS_TABLES_2026_Q3.allowanceCouple
    : partnerReceivesOas ? GIS_TABLES_2026_Q3.spouseOas
    : GIS_TABLES_2026_Q3.spouseNoOas;
  const gisAnnual = gisEligible
    ? monthlyPublishedBenefit(table, incomeAt2025Dollars, 2) * 12 * indexFactor
    : 0;
  const survivorAllowanceEligible = Boolean(context.survivor) && age >= 60 && age < 65 && ownResidenceEligible;
  const coupleAllowanceEligible = hasPartner && age >= 60 && age < 65 && partnerReceivesOas && ownResidenceEligible &&
    wholePartnerResidenceYears >= 10;
  const allowanceAnnual = survivorAllowanceEligible
    ? monthlyPublishedBenefit(GIS_TABLES_2026_Q3.survivorAllowance, adjustedPriorYearIncome / indexFactor, 2) * 12 * indexFactor
    : coupleAllowanceEligible
      ? monthlyPublishedBenefit(GIS_TABLES_2026_Q3.allowanceCouple, incomeAt2025Dollars, 5) * 12 * indexFactor
      : 0;

  return {
    cpp: cppAnnual,
    oas: oasAnnual,
    gis: gisAnnual,
    allowance: allowanceAnnual,
  };
}

export function estimateCppSurvivorAnnual(
  deceasedCppAnnual: Money,
  survivorAge: number,
  survivorExistingCppAnnual = 0,
  survivorPercent = 60,
): Money {
  if (deceasedCppAnnual <= 0) return 0;
  const baseRate = survivorAge >= 65 ? 0.60 : 0.375;
  const requested = deceasedCppAnnual * Math.max(0, survivorPercent) / 100;
  const base = Math.min(requested, deceasedCppAnnual * baseRate);
  if (survivorExistingCppAnnual <= 0) return base;
  // CPP combined benefits are subject to a maximum rather than simple addition.
  // Use the published maximum retirement/survivor combination as a conservative cap.
  const combinedCap = CANADA_2026_PARAMETERS.cpp.maxAt65Monthly * 12 * 1.02;
  return Math.max(0, Math.min(base, combinedCap - survivorExistingCppAnnual));
}
