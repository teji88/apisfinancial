/**
 * CPP retirement benefit calculator.
 *
 * Replicates the Service Canada CPP calculation from contributory earnings history:
 * 1. Contributory period: age 18 to min(70, CPP start age)
 * 2. For each year: pensionable earnings = min(actual earnings, YMPE)
 * 3. Earnings ratio = pensionable earnings / YMPE for that year
 * 4. General dropout: exclude lowest 17% of years
 * 5. Child-rearing dropout: exclude eligible low-earning years
 * 6. Average remaining ratios × 25% × average YMPE = annual base benefit at 65
 * 7. First additional (2019+): 8.33% × ratio × YMPE × phase-in factor per year
 * 8. Second additional / CPP2 (2024+): 33.33% × band ratio × (YAMPE - YMPE) per year
 * 9. Divide by 12 for monthly
 */

import { getYmpe, getAverageYmpe } from "./ympeTable";
import {
  getYampe,
  getFirstAdditionalPhaseIn,
  FIRST_ADDITIONAL_RATE,
  SECOND_ADDITIONAL_RATE,
} from "./yampeTable";

export interface YearlyEarnings {
  year: number;
  /** Pensionable earnings for the year (before YMPE cap). */
  earnings: number;
}

export interface CppCalculationInput {
  birthYear: number;
  birthMonth: number; // 1-12
  /** Historical + projected earnings by year. */
  earningsHistory: YearlyEarnings[];
  /** Expected annual earnings for future years not in history (before YMPE cap). */
  futureAnnualEarnings?: number;
  /** Age at retirement — earnings are zero for years after this. If omitted,
   *  future earnings continue until CPP start (legacy behavior). */
  retirementAge?: number;
  /** Years eligible for child-rearing dropout (primary caregiver, child under 7). */
  childRearingYears?: number[];
  /** Age to start CPP (60-70). Used for contributory period end. */
  cppStartAge?: number;
  /** Year to calculate the benefit for (defaults to year turning 65). */
  calculationYear?: number;
}

export interface CppCalculationResult {
  /** Monthly CPP benefit at age 65. */
  cppAt65Monthly: number;
  /** Annual CPP benefit at age 65. */
  cppAt65Annual: number;
  /** Annual base CPP (25%) at 65. */
  baseAnnual: number;
  /** Annual first additional enhancement (8.33%, phased 2019-2023). */
  firstAdditionalAnnual: number;
  /** Annual second additional / CPP2 (33.33% on YMPE-YAMPE band, 2024+). */
  secondAdditionalAnnual: number;
  /** Monthly post-retirement benefits (0 if not working while collecting). */
  prbMonthly: number;
  /** Annual post-retirement benefits. */
  prbAnnual: number;
  /** Years that earned PRBs (cppStartAge to retirementAge). */
  prbYears: number[];
  /** Number of years in contributory period. */
  contributoryYears: number;
  /** Number of years dropped (general + child-rearing). */
  dropoutYears: number;
  /** General dropout years. */
  generalDropoutYears: number;
  /** Child-rearing dropout years. */
  childRearingDropoutYears: number;
  /** Average earnings ratio (0-1) after dropouts. */
  averageEarningsRatio: number;
  /** Average YMPE used in calculation. */
  averageYmpe: number;
  /** Year-by-year breakdown for transparency. */
  yearlyBreakdown: Array<{
    year: number;
    earnings: number;
    ympe: number;
    pensionableEarnings: number;
    ratio: number;
    dropped: boolean;
    dropReason?: "general" | "child-rearing";
  }>;
}

const GENERAL_DROPOUT_RATE = 0.17;
const BASE_REPLACEMENT_RATE = 0.25;
const CPP_START_YEAR = 1966;

export function calculateCppBenefit(input: CppCalculationInput): CppCalculationResult {
  const {
    birthYear,
    birthMonth,
    earningsHistory,
    futureAnnualEarnings = 0,
    retirementAge,
    childRearingYears = [],
    cppStartAge = 65,
  } = input;

  // Contributory period: from age 18 to min(70, CPP start age).
  // Extended to cover PRB years (working while collecting CPP).
  const startYear = Math.max(birthYear + 18, CPP_START_YEAR);
  const cppEndYear = Math.min(birthYear + Math.min(cppStartAge, 70), new Date().getFullYear() + 50);
  const prbEndYear = retirementAge !== undefined && retirementAge > cppStartAge
    ? birthYear + Math.min(retirementAge, 70)
    : cppEndYear;
  const endYear = Math.max(cppEndYear, prbEndYear);
  // Last year with earnings: the year the person turns retirementAge.
  // Years after retirement have zero earnings (they still count in the
  // contributory period, subject to dropout rules).
  const lastEarningYear = retirementAge !== undefined ? birthYear + retirementAge : endYear;

  const calculationYear = input.calculationYear ?? (birthYear + 65);

  // Build earnings map from history
  const earningsMap = new Map<number, number>();
  for (const { year, earnings } of earningsHistory) {
    earningsMap.set(year, Math.max(0, earnings));
  }

  // Build year-by-year data
  interface YearData {
    year: number;
    earnings: number;
    ympe: number;
    pensionableEarnings: number;
    ratio: number;
  }
  const years: YearData[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const ympe = getYmpe(year);
    // Use historical earnings if available, otherwise future estimate.
    // Years after retirement age have zero earnings.
    let earnings: number;
    if (earningsMap.has(year)) {
      earnings = earningsMap.get(year)!;
    } else if (year > lastEarningYear) {
      earnings = 0;
    } else if (year > new Date().getFullYear()) {
      earnings = futureAnnualEarnings;
    } else {
      // Past year with no data: assume zero (user should fill in)
      earnings = 0;
    }

    const pensionableEarnings = Math.min(earnings, ympe);
    const ratio = ympe > 0 ? pensionableEarnings / ympe : 0;

    years.push({ year, earnings, ympe, pensionableEarnings, ratio });
  }

  const contributoryYears = years.length;

  // Child-rearing dropout: eligible years with low earnings
  // (Service Canada: years where you were primary caregiver for child under 7
  // and had low earnings are excluded)
  const childRearingSet = new Set(childRearingYears);
  const childRearingDropout: YearData[] = [];
  const remainingAfterChildRearing: YearData[] = [];

  for (const y of years) {
    // Only drop child-rearing years if earnings were below the average
    // (if you earned well that year, keeping it helps you)
    if (childRearingSet.has(y.year)) {
      childRearingDropout.push(y);
    } else {
      remainingAfterChildRearing.push(y);
    }
  }

  // General dropout: 17% of remaining years with lowest ratios
  const generalDropoutCount = Math.floor(remainingAfterChildRearing.length * GENERAL_DROPOUT_RATE);
  const sortedByRatio = [...remainingAfterChildRearing].sort((a, b) => a.ratio - b.ratio);
  const generalDropoutSet = new Set(sortedByRatio.slice(0, generalDropoutCount).map((y) => y.year));

  // Calculate average of remaining
  const included = remainingAfterChildRearing.filter((y) => !generalDropoutSet.has(y.year));
  const totalRatio = included.reduce((sum, y) => sum + y.ratio, 0);
  const averageEarningsRatio = included.length > 0 ? totalRatio / included.length : 0;

  // Benefit = average ratio × 25% × average YMPE
  const averageYmpe = getAverageYmpe(calculationYear);
  const baseAnnualBenefit = averageEarningsRatio * BASE_REPLACEMENT_RATE * averageYmpe;

  // CPP enhancement: two components calculated per-year over the same
  // contributory period and dropouts as the base benefit.
  //
  // First additional (2019+): 8.33% × earnings ratio × YMPE × phase-in factor.
  // Phase-in: 15% (2019), 30% (2020), 50% (2021), 75% (2022), 100% (2023+).
  let firstAdditionalTotal = 0;
  for (const y of included) {
    const phaseIn = getFirstAdditionalPhaseIn(y.year);
    if (phaseIn > 0) {
      firstAdditionalTotal += y.ratio * FIRST_ADDITIONAL_RATE * y.ympe * phaseIn;
    }
  }
  const firstAdditionalAnnual = included.length > 0 ? firstAdditionalTotal / included.length : 0;

  // Second additional / CPP2 (2024+): 33.33% on earnings in the YMPE–YAMPE band.
  // Uses uncapped earnings (y.earnings), not pensionable earnings.
  let secondAdditionalTotal = 0;
  for (const y of included) {
    if (y.year >= 2024) {
      const yampe = getYampe(y.year);
      const bandWidth = yampe - y.ympe;
      if (bandWidth > 0 && y.earnings > y.ympe) {
        const earningsInBand = Math.min(y.earnings - y.ympe, bandWidth);
        const bandRatio = earningsInBand / bandWidth;
        secondAdditionalTotal += bandRatio * SECOND_ADDITIONAL_RATE * bandWidth;
      }
    }
  }
  const secondAdditionalAnnual = included.length > 0 ? secondAdditionalTotal / included.length : 0;

  const enhancementAnnualBenefit = firstAdditionalAnnual + secondAdditionalAnnual;

  const annualBenefit = baseAnnualBenefit + enhancementAnnualBenefit;
  const monthlyBenefit = annualBenefit / 12;

  // Post-retirement benefits (PRBs): if working while collecting CPP
  // (retirementAge > cppStartAge), each year earns 1/40 of max CPP × earnings ratio.
  // PRBs start the January after the contribution year and stack.
  const prbYears: number[] = [];
  let prbAnnual = 0;
  if (retirementAge !== undefined && retirementAge > cppStartAge) {
    const maxCppAnnual = averageYmpe * (BASE_REPLACEMENT_RATE + FIRST_ADDITIONAL_RATE);
    for (let year = birthYear + cppStartAge; year < birthYear + Math.min(retirementAge, 70); year++) {
      const yearData = years.find((y) => y.year === year);
      if (!yearData || yearData.ratio <= 0) continue;
      prbYears.push(year);
      prbAnnual += (maxCppAnnual / 40) * yearData.ratio;
    }
  }

  // Build breakdown
  const yearlyBreakdown: CppCalculationResult["yearlyBreakdown"] = years.map((y) => {
    const isChildRearing = childRearingSet.has(y.year);
    const isGeneralDropout = generalDropoutSet.has(y.year);
    const entry: CppCalculationResult["yearlyBreakdown"][number] = {
      year: y.year,
      earnings: y.earnings,
      ympe: y.ympe,
      pensionableEarnings: y.pensionableEarnings,
      ratio: y.ratio,
      dropped: isChildRearing || isGeneralDropout,
    };
    if (isChildRearing) entry.dropReason = "child-rearing";
    else if (isGeneralDropout) entry.dropReason = "general";
    return entry;
  });

  return {
    cppAt65Monthly: Math.max(0, monthlyBenefit),
    cppAt65Annual: Math.max(0, annualBenefit),
    baseAnnual: Math.max(0, baseAnnualBenefit),
    firstAdditionalAnnual: Math.max(0, firstAdditionalAnnual),
    secondAdditionalAnnual: Math.max(0, secondAdditionalAnnual),
    prbMonthly: Math.max(0, prbAnnual / 12),
    prbAnnual: Math.max(0, prbAnnual),
    prbYears,
    contributoryYears,
    dropoutYears: childRearingDropout.length + generalDropoutCount,
    generalDropoutYears: generalDropoutCount,
    childRearingDropoutYears: childRearingDropout.length,
    averageEarningsRatio,
    averageYmpe,
    yearlyBreakdown,
  };
}

/**
 * Convenience: calculate CPP at 65 from a simple earnings history.
 * Earnings history should cover from age 18 to present.
 * Future earnings are projected at the given annual amount.
 */
export function estimateCppAt65(
  birthYear: number,
  birthMonth: number,
  earningsHistory: YearlyEarnings[],
  futureAnnualEarnings: number = 0,
  childRearingYears: number[] = [],
): number {
  const result = calculateCppBenefit({
    birthYear,
    birthMonth,
    earningsHistory,
    futureAnnualEarnings,
    childRearingYears,
    cppStartAge: 65,
  });
  return result.cppAt65Monthly;
}
