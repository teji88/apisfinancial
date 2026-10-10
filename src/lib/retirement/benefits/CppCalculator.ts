/**
 * CPP retirement benefit calculator.
 *
 * Replicates the Service Canada CPP calculation from contributory earnings history,
 * following the computation order in the Canada Pension Plan Act:
 *   dropouts (s.48) → 25% / 8.33% / 33.33% components (s.46(1)) → sum →
 *   early/late age factor (s.46(3.1), applied by the caller) → indexation once in pay.
 *
 * Dropout math is done MONTHLY, because ss.48-49 operate on months:
 *  1. Contributory period: age 18 to min(70, CPP start age).
 *  2. Child-rearing dropout (s.48(2)): only months that are (a) flagged as
 *     primary-caregiver months, (b) below the no-dropout average, and (c) only
 *     applied when dropping them increases the benefit. Never pushes the
 *     divisor below 120 months.
 *  3. Over-65 dropout (s.48(3)): MANDATORY when the pension starts after 65.
 *     Deducts N = min(post-65 months in the period, remaining − 120) months,
 *     choosing the N lowest indexed-earning months ANYWHERE in the period
 *     (they need not be post-65 months; no per-month earnings test).
 *  4. General dropout (s.48(4)): 17% of remaining months, any fraction counting
 *     as a whole month (ceiling), capped so the divisor never falls below
 *     120 months. Lowest-earning months are dropped.
 *  5. Base benefit = average earnings ratio × 25% × 5-year average YMPE (MPEA),
 *     divided by max(included months, 120).
 *  5. Enhancement (ss.48.1/48.2): first additional (2019+, 8.33% with phase-in)
 *     and CPP2 (2024+, 33.33% on the YMPE–YAMPE band) are averaged over a FIXED
 *     480 months (40 years) with NO dropout — or the best 40 years when the
 *     additional contributory period is longer. Note: the child-rearing
 *     *drop-in* for enhanced benefits is not yet implemented; actual earnings
 *     are used for those months (documented approximation).
 *  6. Post-retirement benefits: working while collecting CPP earns 1/40 of the
 *     max CPP per contribution year (approximation of the published PRB).
 *
 * Disability dropout (s.49(c)) and post-65 dropout (s.48(3)) are not implemented.
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
  /** Age to start CPP (60-70). Used for contributory period end and MPEA year. */
  cppStartAge?: number;
  /**
   * Year whose MPEA (5-year average YMPE) indexes the earnings.
   * Defaults to the pension start year per s.51(1) ("the year in which a
   * benefit becomes payable"), NOT the age-65 year.
   */
  calculationYear?: number;
}

export interface CppCalculationResult {
  /**
   * Monthly CPP benefit BEFORE the early/late age factor (s.46(3.1)),
   * in start-year dollars (MPEA of the pension start year per s.51(1)).
   * For cppStartAge 65 this is the age-65 amount; otherwise apply the
   * 0.6%/0.7% monthly factor to get the payable amount.
   */
  cppBaseMonthly: number;
  /** Annual CPP benefit before the early/late age factor. */
  cppBaseAnnual: number;
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
  /** Number of years dropped (general + child-rearing), months/12 rounded. */
  dropoutYears: number;
  /** General dropout years (months/12). */
  generalDropoutYears: number;
  /** Child-rearing dropout years (months/12). */
  childRearingDropoutYears: number;
  /** Exact dropout month counts (the Act operates on months). */
  dropoutMonths: number;
  generalDropoutMonths: number;
  childRearingDropoutMonths: number;
  /** Over-65 dropout months (s.48(3)); 0 unless the pension starts after 65. */
  over65DropoutMonths: number;
  /** Final divisor in months (never below 120 per s.48). */
  divisorMonths: number;
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
    /** Months of this year dropped (0-12); partial drops are possible. */
    droppedMonths: number;
    dropReason?: "general" | "child-rearing" | "over-65";
  }>;
}

const GENERAL_DROPOUT_RATE = 0.17;
/** s.42/s.48: the divisor (in months) can never fall below this. */
const MIN_DIVISOR_MONTHS = 120;
/** ss.48.1/48.2: enhancement divisor in months (40 years), fixed. */
const ENHANCEMENT_DIVISOR_MONTHS = 480;
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

  // s.51(1): G (the MPEA) is for "the year in which a benefit becomes payable",
  // i.e. the pension START year — not the age-65 year. Using 65 would
  // overstate age-60 benefits and understate age-70 benefits by ~MPEA(70)/MPEA(65).
  // Capped at 70 like the contributory period (no added benefit past 70).
  const calculationYear = input.calculationYear ?? (birthYear + Math.min(cppStartAge, 70));

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

  // ---- Monthly expansion: ss.48-49 operate on months, so dropout math is
  // done per-month for Act accuracy (s.48(4): any fraction of a month counts
  // as a whole month; divisor floor of 120 months). ----
  interface MonthDatum {
    year: number;
    /** Earnings ratio for the month (same as the year's ratio). */
    ratio: number;
    /** Flagged as a primary-caregiver (child under 7) year. */
    childRearing: boolean;
  }
  const months: MonthDatum[] = [];
  const childRearingSet = new Set(childRearingYears);
  for (const y of years) {
    for (let m = 0; m < 12; m++) {
      months.push({ year: y.year, ratio: y.ratio, childRearing: childRearingSet.has(y.year) });
    }
  }
  const totalMonths = months.length;
  /** Safe month accessor (indices always derive from this array). */
  const monthAt = (i: number): MonthDatum => months[i] as MonthDatum;

  const averageYmpe = getAverageYmpe(calculationYear);

  /** Base annual benefit for a set of included month indices. */
  const baseAnnualFor = (includedIdx: number[]): number => {
    if (includedIdx.length === 0 || totalMonths === 0) return 0;
    // s.48: divisor is the included months or 120, whichever is greater.
    const divisor = Math.max(includedIdx.length, MIN_DIVISOR_MONTHS);
    const totalRatio = includedIdx.reduce((sum, i) => sum + monthAt(i).ratio, 0);
    return (totalRatio / divisor) * BASE_REPLACEMENT_RATE * averageYmpe;
  };

  /** General 17% dropout applied to a candidate set of month indices. */
  const applyGeneralDropout = (candidateIdx: number[]): Set<number> => {
    const sorted = [...candidateIdx].sort(
      (a, b) => monthAt(a).ratio - monthAt(b).ratio || a - b,
    );
    // s.48(4): drop the lesser of 17% (ceiling — any fraction is a whole month)
    // or the months by which the remainder exceeds 120. Never below 120.
    const dropCount = Math.min(
      Math.ceil(candidateIdx.length * GENERAL_DROPOUT_RATE),
      Math.max(0, candidateIdx.length - MIN_DIVISOR_MONTHS),
    );
    return new Set(sorted.slice(0, dropCount));
  };

  const allIdx = months.map((_, i) => i);

  // ---- Child-rearing candidates (s.48(2)): only months that are flagged AND
  // below the no-dropout average. The divisor is never pushed below 120 months.
  // Whether they are actually deducted is decided below (only if beneficial). ----
  let childRearingDropIdx = new Set<number>();
  if (totalMonths > 0) {
    const avgRatioNoDropout =
      months.reduce((sum, m) => sum + m.ratio, 0) / totalMonths;
    const candidates = allIdx
      .filter((i) => monthAt(i).childRearing && monthAt(i).ratio < avgRatioNoDropout)
      .sort((a, b) => monthAt(a).ratio - monthAt(b).ratio || a - b);
    const maxDrop = Math.max(0, totalMonths - MIN_DIVISOR_MONTHS);
    childRearingDropIdx = new Set(candidates.slice(0, maxDrop));
  }

  /**
   * Full s.48 dropout pipeline for one child-rearing decision:
   *   (2) child-rearing → (3) over-65 → (4) general 17%.
   * The ordering is enforced by the subsections' cross-references:
   * (3) operates "remaining after" (2), (4) operates "remaining after" (2) or (3).
   */
  const runDropouts = (crIdx: Set<number>) => {
    const afterCr = allIdx.filter((i) => !crIdx.has(i));

    // ---- Over-65 dropout (s.48(3)): MANDATORY ("shall be deducted") when the
    // pension commences after 65. Deducts N months where
    //   N = min(post-65 months in the contributory period, remaining − 120),
    // selecting the N lowest indexed-earning months ANYWHERE in the period
    // (they need not be the post-65 months themselves; there is no per-month
    // earnings test, unlike (2)). Indexed monthly earnings rank the same as
    // the earnings ratio (the MPEA factor is constant across months).
    // The post-65 count is exact: the birth month cancels out, giving
    // 12 months per year of delay (60 for a delay to 70).
    let over65Drop = new Set<number>();
    const effStartAge = Math.min(cppStartAge, 70);
    if (effStartAge > 65) {
      const post65Count = Math.floor(12 * (effStartAge - 65));
      const n = Math.min(post65Count, Math.max(0, afterCr.length - MIN_DIVISOR_MONTHS));
      if (n > 0) {
        const sorted = [...afterCr].sort(
          (a, b) => monthAt(a).ratio - monthAt(b).ratio || a - b,
        );
        over65Drop = new Set(sorted.slice(0, n));
      }
    }

    const afterOver65 = afterCr.filter((i) => !over65Drop.has(i));
    const generalDrop = applyGeneralDropout(afterOver65);
    const included = afterOver65.filter((i) => !generalDrop.has(i));
    return { included, over65Drop, generalDrop };
  };

  const withoutCR = runDropouts(new Set<number>());
  const withCR = runDropouts(childRearingDropIdx);

  // s.48(2): the child-rearing provision applies only when it increases the benefit.
  const useChildRearing =
    childRearingDropIdx.size > 0 &&
    baseAnnualFor(withCR.included) > baseAnnualFor(withoutCR.included) + 1e-9;

  const final = useChildRearing ? withCR : withoutCR;
  const droppedIdx = new Set<number>();
  if (useChildRearing) childRearingDropIdx.forEach((i) => droppedIdx.add(i));
  final.over65Drop.forEach((i) => droppedIdx.add(i));
  final.generalDrop.forEach((i) => droppedIdx.add(i));
  const includedIdx = final.included;
  const childRearingMonths = useChildRearing ? childRearingDropIdx.size : 0;
  const over65DropoutMonths = final.over65Drop.size;
  const generalDropoutMonths = final.generalDrop.size;

  // Base benefit: average ratio × 25% × MPEA (5-year average YMPE).
  const totalIncludedRatio = includedIdx.reduce((sum, i) => sum + monthAt(i).ratio, 0);
  const divisorMonths = Math.max(includedIdx.length, MIN_DIVISOR_MONTHS);
  const averageEarningsRatio =
    divisorMonths > 0 ? totalIncludedRatio / divisorMonths : 0;
  const baseAnnualBenefit =
    averageEarningsRatio * BASE_REPLACEMENT_RATE * averageYmpe;

  // ---- CPP enhancement: FIXED 480-month divisor, NO dropout (ss.48.1/48.2).
  // Computed per-year over the full contributory period, then averaged over
  // 40 years (best 40 years when the additional period is longer).
  // NOTE: the child-rearing drop-in for enhanced benefits is not implemented;
  // actual earnings are used for those months (documented approximation). ----
  const sumBest40Years = (annualAmounts: number[]): number => {
    if (annualAmounts.length <= 40) {
      return annualAmounts.reduce((sum, a) => sum + a, 0);
    }
    return [...annualAmounts]
      .sort((a, b) => b - a)
      .slice(0, 40)
      .reduce((sum, a) => sum + a, 0);
  };

  // First additional (2019+): 8.33% × earnings ratio × YMPE × phase-in factor.
  // Phase-in: 15% (2019), 30% (2020), 50% (2021), 75% (2022), 100% (2023+).
  const firstAdditionalAmounts: number[] = [];
  for (const y of years) {
    const phaseIn = getFirstAdditionalPhaseIn(y.year);
    if (phaseIn > 0) {
      firstAdditionalAmounts.push(y.ratio * FIRST_ADDITIONAL_RATE * y.ympe * phaseIn);
    }
  }
  const firstAdditionalAnnual =
    sumBest40Years(firstAdditionalAmounts) / (ENHANCEMENT_DIVISOR_MONTHS / 12);

  // Second additional / CPP2 (2024+): 33.33% on earnings in the YMPE–YAMPE band.
  // Uses uncapped earnings (y.earnings), not pensionable earnings.
  const secondAdditionalAmounts: number[] = [];
  for (const y of years) {
    if (y.year >= 2024) {
      const yampe = getYampe(y.year);
      const bandWidth = yampe - y.ympe;
      if (bandWidth > 0 && y.earnings > y.ympe) {
        const earningsInBand = Math.min(y.earnings - y.ympe, bandWidth);
        secondAdditionalAmounts.push(SECOND_ADDITIONAL_RATE * earningsInBand);
      }
    }
  }
  const secondAdditionalAnnual =
    sumBest40Years(secondAdditionalAmounts) / (ENHANCEMENT_DIVISOR_MONTHS / 12);

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

  // Build breakdown: map dropped months back to years.
  const droppedMonthsByYear = new Map<number, number>();
  const crDroppedYears = new Set<number>();
  const over65DroppedYears = new Set<number>();
  droppedIdx.forEach((i) => {
    const yr = monthAt(i).year;
    droppedMonthsByYear.set(yr, (droppedMonthsByYear.get(yr) ?? 0) + 1);
    if (useChildRearing && childRearingDropIdx.has(i)) crDroppedYears.add(yr);
    else if (final.over65Drop.has(i)) over65DroppedYears.add(yr);
  });
  const yearlyBreakdown: CppCalculationResult["yearlyBreakdown"] = years.map((y) => {
    const dm = droppedMonthsByYear.get(y.year) ?? 0;
    const entry: CppCalculationResult["yearlyBreakdown"][number] = {
      year: y.year,
      earnings: y.earnings,
      ympe: y.ympe,
      pensionableEarnings: y.pensionableEarnings,
      ratio: y.ratio,
      dropped: dm === 12,
      droppedMonths: dm,
    };
    if (dm > 0) {
      entry.dropReason = over65DroppedYears.has(y.year)
        ? "over-65"
        : crDroppedYears.has(y.year)
          ? "child-rearing"
          : "general";
    }
    return entry;
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    cppBaseMonthly: Math.max(0, monthlyBenefit),
    cppBaseAnnual: Math.max(0, annualBenefit),
    baseAnnual: Math.max(0, baseAnnualBenefit),
    firstAdditionalAnnual: Math.max(0, firstAdditionalAnnual),
    secondAdditionalAnnual: Math.max(0, secondAdditionalAnnual),
    prbMonthly: Math.max(0, prbAnnual / 12),
    prbAnnual: Math.max(0, prbAnnual),
    prbYears,
    contributoryYears,
    dropoutYears: round2(droppedIdx.size / 12),
    generalDropoutYears: round2(generalDropoutMonths / 12),
    childRearingDropoutYears: round2(childRearingMonths / 12),
    dropoutMonths: droppedIdx.size,
    generalDropoutMonths,
    childRearingDropoutMonths: childRearingMonths,
    over65DropoutMonths,
    divisorMonths,
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
  return result.cppBaseMonthly;
}
