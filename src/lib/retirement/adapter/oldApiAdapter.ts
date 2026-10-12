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
  AccountScenario,
  AnnualTaxCapture,
  DbPension,
  PersonRole,
  RetirementScenario,
  SimulationResult,
} from "../domain/types";
import { calculateHouseholdTax } from "../engines/TaxEngine";
import { clawbackIncomeOf } from "../engines/MeltdownEngine";

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
  /** Year-specific return overrides: calendar year -> annual return %. For sequence-of-returns stress tests. */
  annualReturnOverrides?: Record<number, number>;
  /** Quick mode: simplified withdrawal for fast estimates. */
  quick?: boolean;
  desiredIncome: number;
  annualSavings: number;
  savingsSplit: SavingsSplit;
  clawbackTolerance?: number;
  /** Percent of eligible pension income to split with spouse (0-50). */
  pensionSplitPercent?: number;
  withdrawalPolicy?: WithdrawalPolicy;
  /** Defined-benefit pensions (flows into SimulationCoordinator). */
  dbPensions?: DbPension[];
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
  /** Per-year tax ledgers for the projection-derived withdrawal marginal rate. */
  annualTaxInputs?: AnnualTaxCapture[];
  /** Total GIS received (today's $) — disclosed in the derived-rate label. */
  totalGis?: number;
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
    blurb: "Draws registered money each year up to the clawback/bracket ceiling — withdrawing beyond spending need in low-income years and parking the after-tax surplus in non-registered — then taxable, then TFSA.",
  },
  {
    key: "REGISTERED_FIRST",
    label: "Registered first",
    blurb: "Empties RRSP/RRIF and LIRA/LIF as fast as spending needs dictate, ignoring the OAS clawback line. Leaves TFSA to compound longest.",
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
  // Use separate working/retirement growth rates when provided; the engine
  // switches at retirement. Falls back to a single rate for both phases.
  const retirementGrowth = input.retirementGrowth ?? input.growth ?? 5;
  const workingGrowth = input.workingGrowth ?? retirementGrowth;
  scenario.assumptions.investmentReturn = retirementGrowth;
  if (workingGrowth !== retirementGrowth) {
    scenario.assumptions.workingInvestmentReturn = workingGrowth;
  }
  if (input.annualReturnOverrides) {
    scenario.assumptions.annualReturnOverrides = input.annualReturnOverrides;
  }
  if (input.quick) {
    scenario.quick = true;
  }

  // Defined-benefit pensions flow straight into the simulation.
  if (input.dbPensions && input.dbPensions.length > 0) {
    scenario.dbPensions = input.dbPensions;
  }

  // Province
  scenario.household.province = input.province;

  // People - convert old PersonSpec to new format
  const toPerson = (spec: PersonSpec, role: "MAIN_USER" | "PARTNER") => {
    // Prefer an explicit birth year when the caller knows it; otherwise estimate
    // from the integer age with a mid-year convention (birthMonth 6). With only
    // an integer age the true birthdate is uncertain by up to a year either way;
    // mid-year minimizes the average error. (UI still collects age only.)
    const birthYear = spec.birthYear ?? currentYear - spec.age;
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
  if (input.clawbackTolerance !== undefined && input.clawbackTolerance > 0) {
    scenario.strategy.clawbackTolerance = input.clawbackTolerance;
  }
  if (input.pensionSplitPercent !== undefined && input.pensionSplitPercent > 0) {
    scenario.strategy.pensionSplitPercent = Math.min(50, Math.max(0, input.pensionSplitPercent));
  }

  // Build real accounts from the per-person balances so the engine sees
  // RRSP/LIRA/TFSA/non-registered separately (not one lump sum).
  // Household annual savings are split across the main user's accounts
  // per savingsSplit, contributed until their retirement age.
  scenario.accounts = buildHouseholdAccounts(input);

  return scenario;
}

/**
 * Normalize a savings split to fractions (accepts 0-100 percentages or 0-1 fractions).
 */
function normalizeSplit(split: SavingsSplit): { rrsp: number; tfsa: number; nonreg: number } {
  const total = (split.rrsp ?? 0) + (split.tfsa ?? 0) + (split.nonreg ?? 0);
  if (total <= 0) return { rrsp: 0, tfsa: 0, nonreg: 0 };
  const divisor = total > 1 ? 100 : 1;
  return {
    rrsp: Math.max(0, (split.rrsp ?? 0) / divisor),
    tfsa: Math.max(0, (split.tfsa ?? 0) / divisor),
    nonreg: Math.max(0, (split.nonreg ?? 0) / divisor),
  };
}

function buildHouseholdAccounts(input: PlannerInputs): AccountScenario[] {
  const accounts: AccountScenario[] = [];
  const split = normalizeSplit(input.savingsSplit ?? { rrsp: 0, tfsa: 0, nonreg: 0 });
  const annualSavings = Math.max(0, input.annualSavings ?? 0);

  const addPersonAccounts = (spec: PersonSpec, role: PersonRole, isMain: boolean) => {
    const balances = spec.balances;
    const untilAge = spec.retirementAge;
    // Only the main user gets the household savings contributions (v1 simplification).
    const contribFor = (fraction: number): AccountScenario["contribution"] | undefined => {
      if (!isMain || annualSavings <= 0 || fraction <= 0) return undefined;
      return { annualAmount: annualSavings * fraction, untilAge };
    };
    const withContribution = (
      base: Omit<AccountScenario, "contribution">,
      fraction: number,
    ): AccountScenario => {
      const c = contribFor(fraction);
      return c ? { ...base, contribution: c } : base;
    };
    if (balances.tfsa > 0 || (contribFor(split.tfsa)?.annualAmount ?? 0) > 0) {
      accounts.push(
        withContribution(
          {
            id: `${role}-tfsa`,
            owner: role,
            type: "TFSA",
            valuation: { mode: "SNAPSHOT", linkedValue: Math.max(0, balances.tfsa) },
          },
          split.tfsa,
        ),
      );
    }
    if (balances.rrsp > 0 || (contribFor(split.rrsp)?.annualAmount ?? 0) > 0) {
      accounts.push(
        withContribution(
          {
            id: `${role}-rrsp`,
            owner: role,
            type: "RRSP",
            valuation: { mode: "SNAPSHOT", linkedValue: Math.max(0, balances.rrsp) },
          },
          split.rrsp,
        ),
      );
    }
    if (balances.lira > 0) {
      // Locked-in: no contributions possible.
      accounts.push({
        id: `${role}-lira`,
        owner: role,
        type: "LIRA",
        valuation: { mode: "SNAPSHOT", linkedValue: Math.max(0, balances.lira) },
      });
    }
    if (balances.nonreg > 0 || (contribFor(split.nonreg)?.annualAmount ?? 0) > 0) {
      const value = Math.max(0, balances.nonreg);
      // Derive ACB from the gain ratio when available (gainRatio = unrealized gain / market value).
      const gainRatio = Math.min(1, Math.max(0, spec.nonregGainRatio ?? 0));
      accounts.push(
        withContribution(
          {
            id: `${role}-nonreg`,
            owner: role,
            type: "NON_REGISTERED",
            valuation: { mode: "SNAPSHOT", linkedValue: value },
            nonRegisteredAcb: value * (1 - gainRatio),
          },
          split.nonreg,
        ),
      );
    }
  };

  addPersonAccounts(input.self, "MAIN_USER", true);
  if (input.spouse) {
    addPersonAccounts(input.spouse, "PARTNER", false);
  }
  return accounts;
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
    cpp: number; oas: number; gis: number; oasClawback: number; otherIncome: number;
    taxes: number; spending: number; shortfall: number;
    meltdown: number; meltdownCeiling: number;
    endingPortfolio: number; endingTfsa: number; endingRegistered: number; endingLira: number; endingNonReg: number;
    people: Map<string, {
      label: string; age: number;
      rrifDraw: number; lifDraw: number; nonregDraw: number; tfsaDraw: number;
      cpp: number; oas: number;
    }>;
  }>();

  for (const m of result.monthly) {
    const year = new Date(m.date).getFullYear();
    let y = yearlyMap.get(year);
    if (!y) {
      y = {
        rrifDraw: 0, lifDraw: 0, nonregDraw: 0, tfsaDraw: 0,
        cpp: 0, oas: 0, gis: 0, oasClawback: 0, otherIncome: 0,
        taxes: 0, spending: 0, shortfall: 0,
        meltdown: 0, meltdownCeiling: 0,
        endingPortfolio: 0, endingTfsa: 0, endingRegistered: 0, endingLira: 0, endingNonReg: 0,
        people: new Map(),
      };
      yearlyMap.set(year, y);
    }
    y.meltdown += m.meltdownWithdrawals ?? 0;
    y.meltdownCeiling = Math.max(y.meltdownCeiling, m.meltdownCeiling ?? 0);
    const ws = m.withdrawalSources;
    if (ws) {
      y.rrifDraw += ws.registered;
      y.lifDraw += ws.lira ?? 0;
      y.nonregDraw += ws.nonRegistered;
      y.tfsaDraw += ws.tfsa;
    }
    y.cpp += m.benefitSources?.cpp ?? 0;
    y.oas += (m.benefitSources?.oas ?? 0) + (m.benefitSources?.gis ?? 0);
    y.gis += m.benefitSources?.gis ?? 0;
    y.oasClawback += m.oasRecovery ?? 0;
    y.taxes += m.taxes;
    y.spending += m.spending;
    y.shortfall = Math.max(y.shortfall, m.shortfall);
    // grossIncome bundles withdrawals (which now include the meltdown gross);
    // back the meltdown out so otherIncome stays pension/rental-type income.
    y.otherIncome += m.grossIncome - m.benefits - (m.meltdownWithdrawals ?? 0);
    // Aggregate per-person data
    const bp = m.benefitsByPerson;
    const wp = m.withdrawalsByPerson;
    if (bp || wp) {
      for (const role of ["MAIN_USER", "PARTNER"] as const) {
        const age = m.ages?.[role];
        if (age == null) continue;
        const label = role === "MAIN_USER" ? (input.self.label || "You") : (input.spouse?.label || "Spouse");
        let p = y.people.get(role);
        if (!p) {
          p = { label, age, rrifDraw: 0, lifDraw: 0, nonregDraw: 0, tfsaDraw: 0, cpp: 0, oas: 0 };
          y.people.set(role, p);
        }
        p.age = age; // Last month wins for age
        if (bp?.[role]) {
          p.cpp += bp[role].cpp;
          p.oas += bp[role].oas + bp[role].gis;
        }
        if (wp?.[role]) {
          p.rrifDraw += wp[role].registered;
          p.lifDraw += wp[role].lira;
          p.nonregDraw += wp[role].nonRegistered;
          p.tfsaDraw += wp[role].tfsa;
        }
      }
    }
    // Track ending balances (last month wins)
    y.endingPortfolio = m.portfolio;
    y.endingTfsa = m.tfsa;
    y.endingRegistered = m.registered;
    y.endingLira = m.lira ?? 0;
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
      effectiveCeiling: y.meltdownCeiling / d,
      meltdownFlag: y.meltdown > 0,
      people: Array.from(y.people.values()).map((p) => ({
        label: p.label,
        age: p.age,
        rrifDraw: p.rrifDraw / d,
        lifDraw: p.lifDraw / d,
        nonregDraw: p.nonregDraw / d,
        tfsaDraw: p.tfsaDraw / d,
        cpp: p.cpp / d,
        oas: p.oas / d,
        oasClawback: 0,
        otherIncome: 0,
        taxableIncome: 0,
        taxes: 0,
        balances: { tfsa: 0, rrsp: 0, lira: 0, nonreg: 0, total: 0 },
      })),
      balances: {
        tfsa: y.endingTfsa / d,
        rrsp: y.endingRegistered / d,
        lira: y.endingLira / d,
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
  // Count retirement years only: taxes paid while working are not part of
  // the retirement plan's cost.
  const retirementAge = input.retirementAge ?? 65;
  const retirementRows = rows.filter((r) => r.age >= retirementAge);
  const deflatedTotalTaxes = retirementRows.reduce((t, r) => t + r.taxes, 0);
  const deflatedTotalClawback = retirementRows.reduce((t, r) => t + r.oasClawback, 0);
  const lastYear = sortedYears.length ? sortedYears[sortedYears.length - 1]! : currentYear;
  const endDeflator = deflatorFor(lastYear);
  const lastRow = rows.length ? rows[rows.length - 1]! : null;

  // A shortfall under $500/yr (today's dollars) is numerical noise from tax
  // gross-up estimation, not a real planning failure. Don't flip the whole
  // plan to "cannot retire" over a rounding error.
  const maxDeflatedShortfall = rows.reduce((m, r) => Math.max(m, r.shortfall), 0);
  const MATERIAL_SHORTFALL_TODAYS = 500;
  return {
    rows,
    depletionAge,
    success: maxDeflatedShortfall <= MATERIAL_SHORTFALL_TODAYS && !metrics.depletionDate,
    endingBalance: metrics.endingPortfolio / endDeflator,
    totalTaxes: deflatedTotalTaxes,
    totalClawback: deflatedTotalClawback,
    estateTax: (metrics.estateTax ?? 0) / endDeflator,
    estateRegistered: (lastRow?.balances.rrsp ?? 0) + (lastRow?.balances.lira ?? 0),
    annualTaxInputs: result.annualTaxInputs,
    totalGis: sortedYears.reduce(
      (s, year) => s + (yearlyMap.get(year)?.gis ?? 0) / deflatorFor(year),
      0,
    ),
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
 * Fast projection for quick estimates: simplified withdrawal (no tax optimization).
 * Use for immediate UI feedback; follow with full projectRetirement for accuracy.
 */
export function projectQuick(input: PlannerInputs): Projection {
  return projectRetirement({ ...input, quick: true });
}

/**
 * Find the earliest retirement age using the new optimizer.
 */
export function earliestRetirementAge(
  input: PlannerInputs,
  onProgress?: (current: number, total: number) => void,
): number | null {
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
    onProgress,
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
  return result.cppBaseMonthly;
}

/**
 * Post-retirement benefit info for someone working while collecting CPP.
 * Returns monthly PRB amount and the years that earned PRBs.
 */
export function cppPrbInfo(
  birthYear: number,
  earningsHistory: Array<{ year: number; earnings: number }>,
  futureAnnualEarnings: number = 0,
  childRearingYears: number[] = [],
  retirementAge?: number,
  cppStartAge: number = 65,
): { monthly: number; annual: number; years: number[] } {
  if (earningsHistory.length === 0 || retirementAge === undefined || retirementAge <= cppStartAge) {
    return { monthly: 0, annual: 0, years: [] };
  }
  const result = calculateCppBenefit({
    birthYear,
    birthMonth: 6,
    earningsHistory,
    futureAnnualEarnings,
    retirementAge,
    childRearingYears,
    cppStartAge,
  });
  return { monthly: result.prbMonthly, annual: result.prbAnnual, years: result.prbYears };
}

/**
 * OAS fraction based on years of Canadian residence (40 years = full).
 * OAS Act s.3(4): only completed whole years count — a fraction is nothing.
 */
export function oasFractionFromResidence(years: number): number {
  return Math.min(1, Math.max(0, Math.floor(Math.max(0, years)) / 40));
}

/**
 * Calculate OAS annual amount at the chosen start age.
 * Deferral bonus mirrors BenefitEngine: 0.6% per month after 65, capped at +36% (age 70).
 * Applies OAS Act s.7.1(3)'s "greatest of": frozen fraction × deferral boost
 * vs. fresh fraction at approval (residence earned while deferring counts,
 * without the boost). Needs 10 completed years at approval (s.3).
 */
export function oasAt(
  startAge: number,
  residenceYears: number,
): number {
  // Oct-Dec 2026 OAS max: $762.50/mo ($9,150/yr) for 65-74
  const baseAnnual = 762.50 * 12;
  const frozenFraction = oasFractionFromResidence(residenceYears);
  const deferralYears = Math.max(0, startAge - 65);
  const deferralMonths = Math.min(60, Math.floor(deferralYears * 12));
  const deferralFactor = 1 + deferralMonths * 0.006;
  const freshYears = Math.min(
    40,
    Math.floor(Math.max(0, residenceYears)) + Math.floor(deferralYears),
  );
  if (freshYears < 10) return 0;
  return baseAnnual * Math.max(frozenFraction * deferralFactor, freshYears / 40);
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

export type DerivedWithdrawalRate = {
  /** Withdrawal-weighted household marginal rate on the next registered dollar, 0–1. */
  rate: number;
  /** Transparent derivation, e.g. "~22% based on your projected withdrawals — split-adjusted across both spouses; includes OAS clawback in ages 72–78". */
  label: string;
  /** Number of projected years with registered withdrawals. */
  years: number;
  /** Ages where the projection shows OAS clawback, or null. */
  clawbackAges: number[] | null;
};

/**
 * Derive the withdrawal marginal rate from the projection itself, instead of
 * guessing it from household after-tax spending.
 *
 * For each projected year with registered withdrawals: bump household
 * registered withdrawals by $1,000 allocated to the lower-income person
 * (respecting the plan's pensionSplitPercent for eligible income), recompute
 * total household tax + OAS recovery via the engine's own tax model, and
 * divide the increase by $1,000. The annual rates are weighted by that year's
 * registered withdrawals.
 *
 * This captures brackets, age credits, OAS clawback (via the projection's
 * claw-aware tax figures, not computeTax alone), pension splitting, and the
 * effect of existing balances automatically. Single filer = same
 * household-level method with one person.
 *
 * Limitations: GIS phase-out is not captured (GIS is a benefit, not part of
 * the tax recompute); spousal-RRSP withdrawals are assumed outside the
 * 3-year attribution window (correct for long-horizon planning).
 *
 * Returns null when the projection has no registered withdrawals (or no
 * captured tax ledgers) — the caller must fall back to manual input
 * (planner-first gate: never silently guess).
 */
export function deriveWithdrawalMarginalRate(projection: Projection): DerivedWithdrawalRate | null {
  const captures = projection.annualTaxInputs;
  if (!captures || captures.length === 0) return null;

  const byYear = new Map<number, AnnualTaxCapture>();
  for (const c of captures) byYear.set(c.year, c);

  let weightedSum = 0;
  let weightTotal = 0;
  let years = 0;
  for (const row of projection.rows) {
    const regWithdraw = row.rrifDraw + row.lifDraw;
    if (regWithdraw < 100) continue;
    const cap = byYear.get(row.year);
    if (!cap) continue;

    const payerBase = cap.taxInputs.MAIN_USER ?? {};
    const spouseBase = cap.taxInputs.PARTNER ?? {};
    const hasSpouse = (spouseBase.age ?? 0) > 0 || clawbackIncomeOf(spouseBase) > 0 || (cap.ages.PARTNER ?? 0) > 0;
    const taxArgs = {
      province: cap.province as Parameters<typeof calculateHouseholdTax>[0]["province"],
      payerAge: cap.ages.MAIN_USER ?? 65,
      spouseAge: cap.ages.PARTNER ?? 65,
      pensionSplitPercent: cap.pensionSplitPercent ?? 0,
      taxYear: cap.year,
      inflationRate: cap.inflationRate,
    };
    const baseTax = calculateHouseholdTax({
      ...taxArgs,
      payer: payerBase,
      spouse: hasSpouse ? spouseBase : undefined,
    }).householdTax;

    // Allocate the $1,000 bump to the lower-income person (tax-efficient).
    const payerIncome = clawbackIncomeOf(payerBase);
    const spouseIncome = hasSpouse ? clawbackIncomeOf(spouseBase) : Infinity;
    const bumpRole = spouseIncome < payerIncome ? "PARTNER" : "MAIN_USER";
    const bumpAge = cap.ages[bumpRole] ?? 65;
    const bumpedPayer = bumpRole === "MAIN_USER"
      ? {
          ...payerBase,
          rrspRrif: (payerBase.rrspRrif ?? 0) + 1000,
          ...(bumpAge >= 65
            ? { eligiblePensionIncome: (payerBase.eligiblePensionIncome ?? 0) + 1000 }
            : {}),
        }
      : payerBase;
    const bumpedSpouse = bumpRole === "PARTNER"
      ? {
          ...spouseBase,
          rrspRrif: (spouseBase.rrspRrif ?? 0) + 1000,
          ...(bumpAge >= 65
            ? { eligiblePensionIncome: (spouseBase.eligiblePensionIncome ?? 0) + 1000 }
            : {}),
        }
      : spouseBase;
    const bumpedTax = calculateHouseholdTax({
      ...taxArgs,
      payer: bumpedPayer,
      spouse: hasSpouse ? bumpedSpouse : undefined,
    }).householdTax;

    const annualRate = Math.max(0, (bumpedTax - baseTax) / 1000);
    weightedSum += annualRate * regWithdraw;
    weightTotal += regWithdraw;
    years++;
  }

  if (years === 0 || weightTotal <= 0) return null;
  const rate = weightedSum / weightTotal;

  const clawbackAges = projection.rows
    .filter((r) => r.oasClawback > 1)
    .map((r) => r.age);
  const hasSpouse = projection.rows.some((r) => r.people.length > 1);

  const parts = [`~${Math.round(rate * 100)}% based on your projected withdrawals`];
  if (hasSpouse) parts.push("split-adjusted across both spouses");
  if (clawbackAges.length > 0) {
    const lo = Math.min(...clawbackAges);
    const hi = Math.max(...clawbackAges);
    parts.push(`includes OAS clawback in ages ${lo}–${hi}`);
  }
  if ((projection.totalGis ?? 0) > 100) {
    parts.push("excludes GIS phase-out");
  }
  return {
    rate,
    label: parts.join("; "),
    years,
    clawbackAges: clawbackAges.length > 0 ? clawbackAges : null,
  };
}

export type StressSeverity = "mild" | "moderate" | "severe";

export interface StressScenario {
  id: "crash" | "lowReturn" | "highInflation" | "longLife";
  label: string;
  description: string;
  severities: Record<StressSeverity, { label: string; value: number }>;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: "crash",
    label: "Market crash early",
    description: "Portfolio drops in year 2 of retirement",
    severities: {
      mild: { label: "-15%", value: 0.15 },
      moderate: { label: "-30%", value: 0.30 },
      severe: { label: "-50%", value: 0.50 },
    },
  },
  {
    id: "lowReturn",
    label: "Low returns",
    description: "Annual return reduced for the whole plan",
    severities: {
      mild: { label: "-1%/yr", value: 1 },
      moderate: { label: "-2%/yr", value: 2 },
      severe: { label: "-3%/yr", value: 3 },
    },
  },
  {
    id: "highInflation",
    label: "High inflation",
    description: "Inflation higher for the whole plan",
    severities: {
      mild: { label: "+1%/yr", value: 1 },
      moderate: { label: "+2%/yr", value: 2 },
      severe: { label: "+3%/yr", value: 3 },
    },
  },
  {
    id: "longLife",
    label: "Live longer",
    description: "Life expectancy extended",
    severities: {
      mild: { label: "+3 yrs", value: 3 },
      moderate: { label: "+5 yrs", value: 5 },
      severe: { label: "+10 yrs", value: 10 },
    },
  },
];

export interface StressTestResult {
  scenarioId: string;
  severity: StressSeverity;
  severityLabel: string;
  passed: boolean;
  depletionAge: number | null;
  endingBalance: number;
}

/**
 * Run a single stress test scenario against the base inputs.
 * Returns pass/fail (fully funded?) plus details.
 */
export function runStressTest(
  input: PlannerInputs,
  scenarioId: StressScenario["id"],
  severity: StressSeverity,
): StressTestResult {
  const scenario = STRESS_SCENARIOS.find((s) => s.id === scenarioId)!;
  const severityValue = scenario.severities[severity].value;

  // Clone inputs and apply the stress
  const stressed = JSON.parse(JSON.stringify(input)) as PlannerInputs;

  switch (scenarioId) {
    case "crash": {
      // True sequence-of-returns: bad returns in the first 3 years of retirement.
      // The crash hits when the portfolio is largest and withdrawals have just started.
      const retirementYear = new Date().getFullYear() + Math.max(0, (input.self.retirementAge ?? 65) - (input.self.age ?? 40));
      const overrides: Record<number, number> = {};
      // Year 1: full crash. Years 2-3: half the crash (partial recovery, still painful).
      overrides[retirementYear] = -severityValue * 100;
      overrides[retirementYear + 1] = (-severityValue * 100) / 2;
      overrides[retirementYear + 2] = (-severityValue * 100) / 2;
      stressed.annualReturnOverrides = overrides;
      break;
    }
    case "lowReturn":
      stressed.workingGrowth = (stressed.workingGrowth ?? 6) - severityValue;
      stressed.retirementGrowth = (stressed.retirementGrowth ?? 6) - severityValue;
      break;
    case "highInflation":
      stressed.inflation = (stressed.inflation ?? 2) + severityValue;
      break;
    case "longLife":
      stressed.lifeExpectancy = (stressed.lifeExpectancy ?? 90) + severityValue;
      break;
  }

  const result = projectRetirement(stressed);
  return {
    scenarioId,
    severity,
    severityLabel: scenario.severities[severity].label,
    passed: result.success,
    depletionAge: result.depletionAge,
    endingBalance: result.endingBalance,
  };
}
