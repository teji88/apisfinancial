/**
 * Adapter: Old retirement planner API backed by the new modular engine.
 *
 * This provides the API surface that the old UI (pre-PR#4) expects,
 * but implemented using the new engine in src/lib/retirement/.
 *
 * Old API → New Engine mapping:
 * - PlannerInputs → RetirementScenario (via plannerInputsToScenario)
 * - projectRetirement → runRetirementSimulation + convert to Projection
 * - earliestRetirementAge → optimizeRetirementPlan with MIN_RETIREMENT_AGE
 * - cppPercentFromEarnings → calculateCppBenefit
 * - oasFractionFromResidence → years/40
 * - oasAt → OAS calculation
 * - compareWithdrawalStrategies → optimizeRetirementPlan with different policies
 */

import type { ProvinceCode } from "@/lib/tax";
import { runRetirementSimulation } from "../engines/SimulationCoordinator";
import { optimizeRetirementPlan } from "../optimization/RetirementOptimizer";
import { calculateCppBenefit } from "../benefits/CppCalculator";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import type {
  RetirementScenario,
  SimulationResult,
} from "../domain/types";

// Re-export old types
export type WithdrawalPolicy =
  | "TAX_TARGETED"
  | "REGISTERED_FIRST"
  | "NON_REGISTERED_FIRST"
  | "TFSA_FIRST";

export type StrategyObjective = "MIN_TAX" | "MAX_ESTATE" | "MAX_SUSTAINABLE_SPENDING";

export type SavingsSplit = {
  rrsp: number;
  tfsa: number;
  nonreg: number;
};

export type PersonSpec = {
  label: string;
  age: number;
  retirementAge: number;
  cppStartAge: number;
  /** Annual CPP at 65 in today's dollars. */
  cppAt65: number;
  oasStartAge: number;
  /** Share of full OAS, 0–1, from years of residence. */
  oasFraction: number;
  /** Other taxable retirement income (pension, rental…), today's dollars. */
  otherIncome: number;
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number };
  nonregGainRatio: number;
  // For CPP calculator integration (new)
  birthYear?: number;
  cppEarningsHistory?: Array<{ year: number; earnings: number }>;
  cppFutureEarnings?: number;
  cppChildRearingYears?: number[];
};

export type StrategyComparison = {
  policy: WithdrawalPolicy;
  label: string;
  blurb: string;
  totalTaxes: number;
  totalClawback: number;
  endingBalance: number;
  estateTax: number;
  estateAfterTax: number;
  depletionAge: number | null;
  success: boolean;
  totalShortfall: number;
};

export type PlannerInputs = {
  retirementAge: number;
  lifeExpectancy: number;
  province: ProvinceCode;
  inflation: number;
  workingGrowth?: number;
  retirementGrowth?: number;
  growth?: number;
  desiredIncome: number;
  annualSavings: number;
  savingsSplit: SavingsSplit;
  clawbackTolerance?: number;
  withdrawalPolicy?: WithdrawalPolicy;
  self: PersonSpec;
  spouse: PersonSpec | null;
};

export type PersonYear = {
  label: string;
  age: number;
  rrifDraw: number;
  lifDraw: number;
  nonregDraw: number;
  tfsaDraw: number;
  cpp: number;
  oas: number;
  oasClawback: number;
  otherIncome: number;
  taxableIncome: number;
  taxes: number;
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number; total: number };
};

export type YearRow = {
  age: number;
  year: number;
  rrifDraw: number;
  lifDraw: number;
  nonregDraw: number;
  tfsaDraw: number;
  cpp: number;
  oas: number;
  oasClawback: number;
  otherIncome: number;
  taxes: number;
  spending: number;
  shortfall: number;
  pensionSplit: number;
  effectiveCeiling: number;
  meltdownFlag: boolean;
  people: PersonYear[];
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number; total: number };
};

export type Projection = {
  rows: YearRow[];
  depletionAge: number | null;
  success: boolean;
  endingBalance: number;
  totalTaxes: number;
  totalClawback: number;
  estateTax: number;
  estateRegistered: number;
};

// Constants
export const CPP_MAX_MONTHLY_65 = 1507.65;

export const WITHDRAWAL_POLICIES: {
  key: WithdrawalPolicy;
  label: string;
  blurb: string;
}[] = [
  {
    key: "TAX_TARGETED",
    label: "Tax-targeted meltdown",
    blurb: "Draws registered money each year up to the clawback/bracket ceiling, then taxable, then TFSA.",
  },
  {
    key: "REGISTERED_FIRST",
    label: "Registered first",
    blurb: "Empties RRSP/RRIF and LIRA/LIF as fast as needed, leaving the TFSA to compound.",
  },
  {
    key: "NON_REGISTERED_FIRST",
    label: "Taxable first",
    blurb: "Spends non-registered savings first, sheltering registered and TFSA money longer.",
  },
  {
    key: "TFSA_FIRST",
    label: "TFSA first",
    blurb: "Uses tax-free savings first for the lowest possible taxable income early on.",
  },
];

/**
 * Convert old PlannerInputs to new RetirementScenario.
 */
export function plannerInputsToScenario(
  input: PlannerInputs,
  portfolioTotal: number,
  portfolioByType?: Record<string, number>,
): RetirementScenario {
  const scenario = createDefaultRetirementScenario(new Date());
  const currentYear = new Date().getFullYear();

  // Goals
  scenario.goals.retirementAge = input.retirementAge;
  scenario.goals.planningAge = input.lifeExpectancy;
  scenario.goals.annualSpending = input.desiredIncome;
  scenario.goals.spendingBasis = "TODAYS_DOLLARS";

  // Assumptions
  scenario.assumptions.inflationRate = input.inflation;
  const growth = input.retirementGrowth ?? input.workingGrowth ?? input.growth ?? 5;
  scenario.assumptions.investmentReturn = growth;

  // Province
  scenario.household.province = input.province;

  // People - convert old PersonSpec to new format
  const toPerson = (spec: PersonSpec, role: "MAIN_USER" | "PARTNER") => {
    // Birth year from age
    const birthYear = currentYear - spec.age;
    // Monthly CPP at 65 from annual
    const cppMonthly = spec.cppAt65 / 12;
    const person: RetirementScenario["household"]["people"][number] = {
      role,
      birthYear,
      birthMonth: 6,
      retirementAge: spec.retirementAge,
      cppAt65: cppMonthly,
      cppStartAge: spec.cppStartAge,
      oasStartAge: spec.oasStartAge,
      oasResidenceYears: Math.round(spec.oasFraction * 40),
      otherIncome: spec.otherIncome,
    };
    if (spec.cppEarningsHistory) person.cppEarningsHistory = spec.cppEarningsHistory;
    if (spec.cppFutureEarnings !== undefined) person.cppFutureEarnings = spec.cppFutureEarnings;
    if (spec.cppChildRearingYears) person.cppChildRearingYears = spec.cppChildRearingYears;
    return person;
  };

  scenario.household.people = [toPerson(input.self, "MAIN_USER")];
  if (input.spouse) {
    scenario.household.people.push(toPerson(input.spouse, "PARTNER"));
  }

  // Strategy
  if (input.withdrawalPolicy) {
    scenario.strategy.withdrawalPolicy = input.withdrawalPolicy;
  }

  scenario.accounts = [];

  return scenario;
}

/**
 * Convert new SimulationResult (monthly) to old Projection (yearly rows).
 */
function simulationToProjection(
  result: SimulationResult,
  input: PlannerInputs,
): Projection {
  // Aggregate monthly to yearly
  const yearlyMap = new Map<number, {
    rrifDraw: number; lifDraw: number; nonregDraw: number; tfsaDraw: number;
    cpp: number; oas: number; oasClawback: number; otherIncome: number;
    taxes: number; spending: number; shortfall: number;
    endingPortfolio: number; endingTfsa: number; endingRegistered: number; endingNonReg: number;
  }>();

  for (const m of result.monthly) {
    const year = new Date(m.date).getFullYear();
    let y = yearlyMap.get(year);
    if (!y) {
      y = {
        rrifDraw: 0, lifDraw: 0, nonregDraw: 0, tfsaDraw: 0,
        cpp: 0, oas: 0, oasClawback: 0, otherIncome: 0,
        taxes: 0, spending: 0, shortfall: 0,
        endingPortfolio: 0, endingTfsa: 0, endingRegistered: 0, endingNonReg: 0,
      };
      yearlyMap.set(year, y);
    }
    const ws = m.withdrawalSources;
    if (ws) {
      y.rrifDraw += ws.registered;
      y.nonregDraw += ws.nonRegistered;
      y.tfsaDraw += ws.tfsa;
    }
    y.cpp += m.benefitSources?.cpp ?? 0;
    y.oas += (m.benefitSources?.oas ?? 0) + (m.benefitSources?.gis ?? 0);
    y.oasClawback += m.oasRecovery ?? 0;
    y.taxes += m.taxes;
    y.spending += m.spending;
    y.shortfall = Math.max(y.shortfall, m.shortfall);
    y.otherIncome += m.grossIncome - m.benefits;
    // Track ending balances (last month wins)
    y.endingPortfolio = m.portfolio;
    y.endingTfsa = m.tfsa;
    y.endingRegistered = m.registered;
    y.endingNonReg = m.nonRegistered;
  }

  const sortedYears = Array.from(yearlyMap.keys()).sort((a, b) => a - b);
  const currentYear2 = new Date().getFullYear();
  const birthYear2 = currentYear2 - input.self.age;
  // The engine simulates in nominal dollars (correct for tax brackets, YMPE,
  // OAS thresholds which all inflate). Deflate to today's dollars for display
  // so the spending line stays flat and all values show real purchasing power.
  const inflationRate = (input.inflation ?? 2) / 100;
  const deflatorFor = (year: number) => Math.pow(1 + inflationRate, year - currentYear2);
  const rows: YearRow[] = sortedYears.map((year) => {
    const y = yearlyMap.get(year)!;
    const age = year - birthYear2;
    const d = deflatorFor(year);
    return {
      age,
      year,
      rrifDraw: y.rrifDraw / d,
      lifDraw: y.lifDraw / d,
      nonregDraw: y.nonregDraw / d,
      tfsaDraw: y.tfsaDraw / d,
      cpp: y.cpp / d,
      oas: y.oas / d,
      oasClawback: y.oasClawback / d,
      otherIncome: y.otherIncome / d,
      taxes: y.taxes / d,
      spending: y.spending / d,
      shortfall: y.shortfall / d,
      pensionSplit: 0,
      effectiveCeiling: 0,
      meltdownFlag: false,
      people: [],
      balances: {
        tfsa: y.endingTfsa / d,
        rrsp: y.endingRegistered / d,
        lira: 0,
        nonreg: y.endingNonReg / d,
        total: y.endingPortfolio / d,
      },
    };
  });

  const metrics = result.metrics;
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - input.self.age;
  let depletionAge: number | null = null;
  if (metrics.depletionDate) {
    depletionAge = new Date(metrics.depletionDate).getFullYear() - birthYear;
  }

  // Summary figures are also in today's dollars. Lifetime tax is the sum of
  // the already-deflated yearly taxes (not the deflated nominal total).
  const deflatedTotalTaxes = rows.reduce((t, r) => t + r.taxes, 0);
  const deflatedTotalClawback = rows.reduce((t, r) => t + r.oasClawback, 0);
  const lastYear = sortedYears.length ? sortedYears[sortedYears.length - 1]! : currentYear;
  const endDeflator = deflatorFor(lastYear);
  const lastRow = rows.length ? rows[rows.length - 1]! : null;

  return {
    rows,
    depletionAge,
    success: metrics.maximumSpendingShortfall <= 0 && !metrics.depletionDate,
    endingBalance: metrics.endingPortfolio / endDeflator,
    totalTaxes: deflatedTotalTaxes,
    totalClawback: deflatedTotalClawback,
    estateTax: (metrics.estateTax ?? 0) / endDeflator,
    estateRegistered: lastRow?.balances.rrsp ?? 0,
  };
}

/**
 * Run a retirement projection using the new engine.
 */
export function projectRetirement(input: PlannerInputs): Projection {
  const portfolioTotal = input.self.balances.tfsa + input.self.balances.rrsp +
    input.self.balances.lira + input.self.balances.nonreg +
    (input.spouse ? input.spouse.balances.tfsa + input.spouse.balances.rrsp +
      input.spouse.balances.lira + input.spouse.balances.nonreg : 0);
  const scenario = plannerInputsToScenario(input, portfolioTotal);
  const result = runRetirementSimulation(
    scenario,
    portfolioTotal,
    new Date().getFullYear(),
  );
  return simulationToProjection(result, input);
}

/**
 * Find the earliest retirement age using the new optimizer.
 */
export function earliestRetirementAge(input: PlannerInputs): number | null {
  const portfolioTotal = input.self.balances.tfsa + input.self.balances.rrsp +
    input.self.balances.lira + input.self.balances.nonreg +
    (input.spouse ? input.spouse.balances.tfsa + input.spouse.balances.rrsp +
      input.spouse.balances.lira + input.spouse.balances.nonreg : 0);
  const scenario = plannerInputsToScenario(input, portfolioTotal);
  const result = optimizeRetirementPlan({
    scenario,
    startingPortfolio: portfolioTotal,
    startYear: new Date().getFullYear(),
    objective: "MIN_RETIREMENT_AGE",
  });
  if (result.selectedCandidate) {
    return result.selectedCandidate.scenario.goals.retirementAge;
  }
  return null;
}

/**
 * Calculate CPP as a percentage of max, from simplified earnings history.
 * Old API: takes past average, years worked, future income/years.
 * For detailed year-by-year calculation, use calculateCppBenefit directly.
 */
export function cppPercentFromEarnings(h: {
  pastAverageIncome: number;
  yearsWorked: number;
  futureIncome: number;
  futureYears: number;
}): number {
  const YMPE = 74600; // 2026 YMPE
  const CPP_QUALIFYING_YEARS = 39;
  const ratio = (income: number) => Math.min(1, Math.max(0, income) / YMPE);
  const past = Math.max(0, h.yearsWorked) * ratio(h.pastAverageIncome);
  const future = Math.max(0, h.futureYears) * ratio(h.futureIncome);
  const credited = Math.min(CPP_QUALIFYING_YEARS, past + future);
  return Math.round((credited / CPP_QUALIFYING_YEARS) * 1000) / 10;
}

/**
 * Detailed CPP calculation from year-by-year earnings history.
 * Uses the new CppCalculator with full dropout rules.
 */
export function cppFromDetailedHistory(
  birthYear: number,
  earningsHistory: Array<{ year: number; earnings: number }>,
  futureAnnualEarnings: number = 0,
  childRearingYears: number[] = [],
  retirementAge?: number,
): number {
  if (earningsHistory.length === 0) return 0;
  const result = calculateCppBenefit({
    birthYear,
    birthMonth: 6,
    earningsHistory,
    futureAnnualEarnings,
    ...(retirementAge !== undefined ? { retirementAge } : {}),
    childRearingYears,
    cppStartAge: 65,
  });
  return result.cppAt65Monthly;
}

/**
 * OAS fraction based on years of Canadian residence (40 years = full).
 */
export function oasFractionFromResidence(years: number): number {
  return Math.min(1, Math.max(0, years / 40));
}

/**
 * Calculate OAS annual amount.
 */
export function oasAt(
  age: number,
  residenceYears: number,
  deferTo70: boolean = false,
): number {
  // 2026 OAS max: $751.97/mo ($9,023.64/yr) for 65-74
  const baseAnnual = 751.97 * 12;
  const fraction = oasFractionFromResidence(residenceYears);
  let amount = baseAnnual * fraction;
  if (deferTo70 && age >= 70) {
    amount *= 1.36; // 0.6% per month for 60 months
  }
  return amount;
}

/**
 * Compare withdrawal strategies using the new optimizer.
 */
export function compareWithdrawalStrategies(
  input: PlannerInputs,
  objective: StrategyObjective = "MIN_TAX",
): { results: StrategyComparison[]; best: WithdrawalPolicy } {
  const portfolioTotal = input.self.balances.tfsa + input.self.balances.rrsp +
    input.self.balances.lira + input.self.balances.nonreg +
    (input.spouse ? input.spouse.balances.tfsa + input.spouse.balances.rrsp +
      input.spouse.balances.lira + input.spouse.balances.nonreg : 0);

  const results = WITHDRAWAL_POLICIES.map((meta) => {
    const p = projectRetirement({ ...input, withdrawalPolicy: meta.key });
    return {
      policy: meta.key,
      label: meta.label,
      blurb: meta.blurb,
      totalTaxes: p.totalTaxes,
      totalClawback: p.totalClawback,
      endingBalance: p.endingBalance,
      estateTax: p.estateTax,
      estateAfterTax: Math.max(0, p.endingBalance - p.estateTax),
      depletionAge: p.depletionAge,
      success: p.success,
      totalShortfall: p.rows.reduce((s, r) => s + r.shortfall, 0),
    };
  });

  const score = (r: StrategyComparison) => {
    switch (objective) {
      case "MAX_ESTATE":
        return r.estateAfterTax;
      case "MAX_SUSTAINABLE_SPENDING":
        return -r.totalShortfall;
      case "MIN_TAX":
      default:
        return -(r.totalTaxes + r.totalClawback);
    }
  };

  const best = [...results].sort((a, b) => score(b) - score(a))[0];
  return { results, best: best?.policy ?? "TAX_TARGETED" };
}
