/**
 * CPP/OAS timing optimizer — deterministic grid search over claiming ages.
 *
 * Evaluates the 66-combo grid (CPP 60–70 × OAS 65–70) JOINTLY — the two
 * interact through line 23600 (CPP income counts toward the OAS recovery-tax
 * threshold), so they must not be optimized independently.
 *
 * Objective (per the archived modeling research): maximize the EXPECTED
 * PRESENT VALUE of after-tax lifetime benefits —
 *   Σ_t net_t × S(t) / (1+r)^t
 * where S(t) is the survival probability (full qx vectors, never a single
 * life-expectancy number) and r is the REAL risk-free rate. All math is in
 * real 2026 dollars; benefits are CPI-indexed so real benefits are flat.
 *
 * Per-year mechanics (all statutory, all already in the engines):
 * - CPP/OAS/GIS from estimateGovernmentBenefits (dropouts, s.48(3), s.51(1)
 *   MPEA, s.7.1(3) greatest-of, residence flooring — all modeled)
 * - OAS recovery tax per ITA s.180.2 on the PRIOR year's income (the July–June
 *   withholding lag, modeled as an annual one-year lag)
 * - GIS on prior-year non-OAS income (OAS excluded from GIS income)
 * - Marginal income tax on benefits via calculateTaxFromIncome
 *
 * Guardrails: oasDeferralForfeitsGis (blocking), bridge-funding feasibility.
 * Break-even ages are reported as explain-only metrics, never the criterion.
 */

import type { PersonScenario, ProvinceCode } from "../domain/types";
import { estimateGovernmentBenefits } from "../engines/BenefitEngine";
import {
  calculateTaxFromIncome,
  oasRecoveryForIncome,
} from "../engines/TaxEngine";
import { oasDeferralForfeitsGis } from "./RetirementOptimizer";
import {
  defaultMortalityTable,
  survivalProbability,
  type MortalityTable,
  type Sex,
} from "./mortality";

export interface TimingOptimizerInputs {
  person: PersonScenario;
  /** Exact current age (can be fractional). */
  currentAge: number;
  sex: Sex;
  province?: ProvinceCode;
  /** Real risk-free discount rate, e.g. 0.01. Default 0.01 per CIA/SOA 2020. */
  realDiscountRate?: number;
  mortalityTable?: MortalityTable;
  /** Scales qx: >1 shorter-lived, <1 longer-lived (health). Default 1. */
  longevityMultiplier?: number;
  /** Annual other taxable income in real dollars (constant). */
  otherIncomeAnnual?: number;
  /** Last age modeled (default 110). */
  maxAge?: number;
  /** Bridge funds available to cover the delay gap; required amount is always reported. */
  bridgeFundsAvailable?: number;
}

export interface TimingCombo {
  cppStartAge: number;
  oasStartAge: number;
  /** Expected present value of after-tax lifetime benefits (real 2026 $). */
  expectedPV: number;
  /** Annual after-tax benefit cash flow at 70 (real $), for display. */
  annualNetAt70: number;
  /** Peak cumulative gap vs taking CPP at 60 / OAS at 65 (real $). */
  requiredBridgeFunds: number;
  feasible: boolean;
  violations: string[];
  /** Discounted break-even age vs the (65,65) combo; null if never. Explain-only. */
  breakEvenVs65: number | null;
}

export interface TimingOptimizationResult {
  combos: TimingCombo[];
  recommended: TimingCombo;
  baseline: TimingCombo; // the (65,65) combo, for reference
  warnings: string[];
  mortalityLabel: string;
  realDiscountRate: number;
  sensitivity: {
    /** Recommendation at 0% and 3% real discount. */
    atZeroDiscount: { cppStartAge: number; oasStartAge: number };
    atThreeDiscount: { cppStartAge: number; oasStartAge: number };
    discountFlips: boolean;
    /** Recommendation with qx × 0.8 (longer-lived) and × 1.25 (shorter-lived). */
    longerLived: { cppStartAge: number; oasStartAge: number };
    shorterLived: { cppStartAge: number; oasStartAge: number };
    longevityFlips: boolean;
  };
}

interface YearResult {
  age: number;
  net: number; // after-tax benefit cash flow (real $)
  grossInclOas: number; // for next year's clawback
  grossExclOas: number; // for next year's GIS
}

/** Project one combo year-by-year in real dollars. */
function projectCombo(
  inputs: TimingOptimizerInputs,
  cppStartAge: number,
  oasStartAge: number,
  table: MortalityTable,
  realRate: number,
  longevityMultiplier: number,
  maxAge: number,
): { pv: number; years: YearResult[]; annualNetAt70: number } {
  const { person, currentAge, sex } = inputs;
  const province = inputs.province ?? "AB";
  const otherAnnual = inputs.otherIncomeAnnual ?? 0;
  const r = realRate;

  const years: YearResult[] = [];
  let pv = 0;
  let annualNetAt70 = 0;
  // Prior-year incomes for the clawback (incl. OAS) and GIS (excl. OAS).
  // Initialized to current non-benefit income; one warm-up year of
  // approximation for people already 65+. Documented limitation.
  const employedNow = currentAge < (person.retirementAge ?? 65);
  const currentEmployment = employedNow
    ? (person.employmentIncome ?? 0) + (person.selfEmploymentIncome ?? 0)
    : 0;
  let prevGrossInclOas = otherAnnual + currentEmployment;
  let prevGrossExclOas = prevGrossInclOas;

  const startInt = Math.ceil(currentAge);
  for (let age = startInt; age <= maxAge; age++) {
    const t = age - currentAge;
    const ben = estimateGovernmentBenefits(
      { ...person, cppStartAge, oasStartAge },
      age,
      prevGrossExclOas,
      { calendarYear: 2026, inflationRate: 0, householdSize: 1 },
    );
    const employed = age < (person.retirementAge ?? 65);
    const employment = employed
      ? (person.employmentIncome ?? 0) + (person.selfEmploymentIncome ?? 0)
      : 0;

    // OAS recovery tax on the PRIOR year's income (July–June lag, annual model).
    const clawback = oasRecoveryForIncome(prevGrossInclOas, ben.oas, 1);

    // Marginal tax attributable to the benefits (progressivity handled by differencing).
    const baseComponents = { employment, rrspRrif: otherAnnual, age };
    const withBenefits = {
      ...baseComponents,
      cpp: ben.cpp,
      oas: ben.oas,
    };
    const taxWithout = calculateTaxFromIncome(baseComponents, province, age, 2026, 0).totalTax;
    const taxWith = calculateTaxFromIncome(withBenefits, province, age, 2026, 0).totalTax;
    const marginalTax = Math.max(0, taxWith - taxWithout);

    const net = ben.cpp + ben.oas + ben.gis - clawback - marginalTax;
    const grossInclOas = employment + otherAnnual + ben.cpp + ben.oas;
    const grossExclOas = employment + otherAnnual + ben.cpp;

    const survival = survivalProbability(table, currentAge, age + 1, sex, longevityMultiplier);
    pv += (net * survival) / Math.pow(1 + r, t);
    years.push({ age, net, grossInclOas, grossExclOas });
    if (age === 70) annualNetAt70 = net;

    prevGrossInclOas = grossInclOas;
    prevGrossExclOas = grossExclOas;
  }
  return { pv, years, annualNetAt70 };
}

/** Peak cumulative gap vs the earliest-claim baseline (bridge funding need). */
function requiredBridgeFunds(baseline: YearResult[], combo: YearResult[]): number {
  let peak = 0;
  let cumGap = 0;
  const n = Math.min(baseline.length, combo.length);
  for (let i = 0; i < n; i++) {
    cumGap += baseline[i]!.net - combo[i]!.net;
    peak = Math.max(peak, cumGap);
  }
  return Math.max(0, peak);
}

/** Discounted break-even age of combo vs baseline; null if never. Explain-only. */
function breakEvenAge(
  baseline: YearResult[],
  combo: YearResult[],
  table: MortalityTable,
  currentAge: number,
  sex: Sex,
  realRate: number,
  longevityMultiplier: number,
): number | null {
  let cumBase = 0;
  let cumCombo = 0;
  let wasBehind = false;
  const n = Math.min(baseline.length, combo.length);
  for (let i = 0; i < n; i++) {
    const age = baseline[i]!.age;
    const t = age - currentAge;
    const s = survivalProbability(table, currentAge, age + 1, sex, longevityMultiplier);
    const d = s / Math.pow(1 + realRate, t);
    cumBase += baseline[i]!.net * d;
    cumCombo += combo[i]!.net * d;
    // Only meaningful after the combo has actually fallen behind; otherwise
    // the trivial 0 >= 0 years would report a bogus early break-even.
    if (cumCombo < cumBase - 1e-6) wasBehind = true;
    if (wasBehind && cumCombo >= cumBase) return age;
  }
  return null;
}

function evaluateGrid(
  inputs: TimingOptimizerInputs,
  table: MortalityTable,
  realRate: number,
  longevityMultiplier: number,
): TimingCombo[] {
  const { person, currentAge } = inputs;
  const maxAge = inputs.maxAge ?? 110;
  const minCpp = Math.max(60, Math.ceil(currentAge));
  const minOas = Math.max(65, Math.ceil(currentAge));

  // Earliest-claim baseline for bridge-funding measurement.
  const baselineProj = projectCombo(inputs, minCpp, minOas, table, realRate, longevityMultiplier, maxAge);
  const ref65 = minCpp <= 65 && minOas <= 65
    ? projectCombo(inputs, 65, 65, table, realRate, longevityMultiplier, maxAge)
    : baselineProj;

  const combos: TimingCombo[] = [];
  for (let c = minCpp; c <= 70; c++) {
    for (let o = minOas; o <= 70; o++) {
      const proj = c === minCpp && o === minOas
        ? baselineProj
        : projectCombo(inputs, c, o, table, realRate, longevityMultiplier, maxAge);
      const violations: string[] = [];
      const gisViolation = oasDeferralForfeitsGis(
        { ...person, cppStartAge: c, oasStartAge: o }, 1,
      );
      if (gisViolation !== null) violations.push(gisViolation);
      const bridge = requiredBridgeFunds(baselineProj.years, proj.years);
      if (
        inputs.bridgeFundsAvailable !== undefined &&
        bridge > inputs.bridgeFundsAvailable
      ) {
        violations.push("insufficientBridgeFunds");
      }
      combos.push({
        cppStartAge: c,
        oasStartAge: o,
        expectedPV: proj.pv,
        annualNetAt70: proj.annualNetAt70,
        requiredBridgeFunds: bridge,
        feasible: violations.length === 0,
        violations,
        breakEvenVs65: (c === 65 && o === 65)
          ? null
          : breakEvenAge(ref65.years, proj.years, table, currentAge, inputs.sex, realRate, longevityMultiplier),
      });
    }
  }
  combos.sort((a, b) => b.expectedPV - a.expectedPV);
  return combos;
}

function topFeasible(combos: TimingCombo[]): TimingCombo {
  const feasible = combos.filter((c) => c.feasible);
  const pool = feasible.length > 0 ? feasible : combos;
  return pool[0]!;
}

export function optimizeCppOasTiming(
  inputs: TimingOptimizerInputs,
): TimingOptimizationResult {
  const table = inputs.mortalityTable ?? defaultMortalityTable();
  const realRate = inputs.realDiscountRate ?? 0.01;
  const longevityMultiplier = inputs.longevityMultiplier ?? 1;

  const combos = evaluateGrid(inputs, table, realRate, longevityMultiplier);
  const recommended = topFeasible(combos);
  const baseline = combos.find((c) => c.cppStartAge === 65 && c.oasStartAge === 65)
    ?? combos[combos.length - 1]!;

  // Sensitivity: discount rate 0% and 3%; longevity ±.
  const atZero = topFeasible(evaluateGrid(inputs, table, 0, longevityMultiplier));
  const atThree = topFeasible(evaluateGrid(inputs, table, 0.03, longevityMultiplier));
  const longerLived = topFeasible(evaluateGrid(inputs, table, realRate, longevityMultiplier * 0.8));
  const shorterLived = topFeasible(evaluateGrid(inputs, table, realRate, longevityMultiplier * 1.25));

  const same = (a: TimingCombo, b: TimingCombo) =>
    a.cppStartAge === b.cppStartAge && a.oasStartAge === b.oasStartAge;
  const discountFlips = !same(recommended, atZero) || !same(recommended, atThree);
  const longevityFlips = !same(recommended, longerLived) || !same(recommended, shorterLived);

  const warnings: string[] = [];
  if (discountFlips) {
    warnings.push(
      "The recommendation changes within the 0–3% real discount band — treat it as sensitive to the discount assumption.",
    );
  }
  if (longevityFlips) {
    warnings.push(
      "The recommendation flips with plausible longevity variation — longevity is the highest-leverage input; consider health-based adjustment.",
    );
  }
  if (recommended.requiredBridgeFunds > 0) {
    warnings.push(
      `Delaying to the recommended ages requires about $${Math.round(recommended.requiredBridgeFunds).toLocaleString()} in bridge funds to cover the gap vs claiming at ${Math.max(60, Math.ceil(inputs.currentAge))}/65.`,
    );
  }

  return {
    combos,
    recommended,
    baseline,
    warnings,
    mortalityLabel: table.label,
    realDiscountRate: realRate,
    sensitivity: {
      atZeroDiscount: { cppStartAge: atZero.cppStartAge, oasStartAge: atZero.oasStartAge },
      atThreeDiscount: { cppStartAge: atThree.cppStartAge, oasStartAge: atThree.oasStartAge },
      discountFlips,
      longerLived: { cppStartAge: longerLived.cppStartAge, oasStartAge: longerLived.oasStartAge },
      shorterLived: { cppStartAge: shorterLived.cppStartAge, oasStartAge: shorterLived.oasStartAge },
      longevityFlips,
    },
  };
}
