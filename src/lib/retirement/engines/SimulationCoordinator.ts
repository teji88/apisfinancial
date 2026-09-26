import type { RetirementScenario, SimulationResult, MonthlySnapshot, PersonRole } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION, RETIREMENT_RULES_VERSION } from "../scenario/defaults";
import { estimateGovernmentBenefits } from "./BenefitEngine";
import { calculateBasicTax } from "./TaxEngine";
import { createAccountState, applyMonthlyReturn, mandatoryRegisteredWithdrawal, withdraw, type AccountState } from "./AccountEngine";

function ageAtMonth(birthYear: number, birthMonth: number, date: Date) {
  return date.getUTCFullYear() - birthYear - (date.getUTCMonth() + 1 < birthMonth ? 1 : 0);
}

function withdrawalOrder(policy: RetirementScenario["strategy"]["withdrawalPolicy"]): Array<"cash" | "nonRegistered" | "registered" | "tfsa"> {
  if (policy === "TFSA_FIRST") return ["tfsa", "cash", "nonRegistered", "registered"];
  if (policy === "NON_REGISTERED_FIRST") return ["nonRegistered", "cash", "registered", "tfsa"];
  if (policy === "REGISTERED_FIRST") return ["registered", "cash", "nonRegistered", "tfsa"];
  return ["cash", "nonRegistered", "registered", "tfsa"];
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function bucketOf(state: AccountState) {
  if (state.type === "TFSA") return "tfsa";
  if (["RRSP", "RRIF", "LIRA", "LIF"].includes(state.type)) return "registered";
  if (state.type === "CASH") return "cash";
  return "nonRegistered";
}

function sumBucket(accounts: AccountState[], bucket: ReturnType<typeof bucketOf>) {
  return accounts.filter((a) => bucketOf(a) === bucket).reduce((sum, a) => sum + a.balance, 0);
}

function withdrawFromBucket(accounts: AccountState[], bucket: ReturnType<typeof bucketOf>, amount: number) {
  let remaining = Math.max(0, amount);
  let taken = 0;
  for (const account of accounts.filter((a) => bucketOf(a) === bucket)) {
    if (remaining <= 0) break;
    const part = withdraw(account, remaining);
    taken += part;
    remaining -= part;
  }
  return taken;
}

export function runRetirementSimulation(
  scenario: RetirementScenario,
  startingPortfolio: number,
  startYear = new Date().getUTCFullYear(),
  portfolioByType: Record<string, number> = {},
): SimulationResult {
  const start = new Date(Date.UTC(startYear, 0, 1));
  const people = scenario.household.people;
  const maxBirthYear = Math.max(...people.map((p) => p.birthYear));
  const months = 12 * Math.max(1, scenario.goals.planningAge - Math.min(...people.map((p) => p.birthYear)));
  const accounts = scenario.accounts.length
    ? scenario.accounts.map(createAccountState)
    : Object.entries(portfolioByType).map(([type, value]) => createAccountState({
        id: `portfolio-${type}`,
        owner: "MAIN_USER",
        type: (type === "RRSP" || type === "TFSA" || type === "NON_REGISTERED" || type === "CASH" ? type : "NON_REGISTERED") as never,
        valuation: { mode: "SNAPSHOT", linkedValue: value },
      }));
  if (!scenario.accounts.length && accounts.every((a) => a.balance === 0)) {
    accounts.push(createAccountState({ id: "portfolio-total", owner: "MAIN_USER", type: "NON_REGISTERED", valuation: { mode: "SNAPSHOT", linkedValue: startingPortfolio } }));
  }

  const monthly: MonthlySnapshot[] = [];
  const monthlyReturn = Math.pow(1 + scenario.assumptions.investmentReturn / 100, 1 / 12) - 1;
  const monthlyInflation = Math.pow(1 + scenario.assumptions.inflationRate / 100, 1 / 12) - 1;
  let spending = scenario.goals.annualSpending / 12;
  let lifetimeSpending = 0;
  let lifetimeTax = 0;
  let totalBenefits = 0;
  let maxShortfall = 0;
  let previousYearTaxableIncome = 0;
  let previousYearBenefitIncome = 0;
  let annualTaxableIncome = 0;
  let annualTax = 0;
  let annualBenefits = 0;

  for (let i = 0; i < months; i++) {
    const date = new Date(start.getTime());
    date.setUTCMonth(start.getUTCMonth() + i);
    const ages = Object.fromEntries(people.map((person) => [person.role, ageAtMonth(person.birthYear, person.birthMonth, date)])) as Partial<Record<PersonRole, number>>;
    const maxAge = Math.max(...Object.values(ages).map(Number), 0);
    const retired = people.some((person) => (ages[person.role] ?? 0) >= person.retirementAge);
    const allRetired = people.every((person) => (ages[person.role] ?? 0) >= person.retirementAge);

    for (const account of accounts) {
      account.balance = applyMonthlyReturn(account.balance, scenario.assumptions.investmentReturn, scenario.assumptions.investmentFeeRate);
      const ownerAge = ages[account.owner] ?? maxAge;
      if (!retired && account.contributionAnnual > 0 && (!account.contributionUntilAge || ownerAge < account.contributionUntilAge)) {
        account.balance += account.contributionAnnual / 12;
      }
    }

    let benefits = 0;
    let otherIncome = 0;
    for (const person of people) {
      const age = ages[person.role] ?? 0;
      if (age >= 60) {
        const benefit = estimateGovernmentBenefits(person, age, previousYearBenefitIncome);
        benefits += (benefit.cpp + benefit.oas + benefit.gis) / 12;
      }
      otherIncome += (person.otherIncome ?? 0) / 12;
    }

    let mandatoryWithdrawals = 0;
    for (const account of accounts) {
      mandatoryWithdrawals += mandatoryRegisteredWithdrawal(account.type, ages[account.owner] ?? maxAge, account.balance);
    }
    const mandatoryTaken = withdrawFromBucket(accounts, "registered", mandatoryWithdrawals);

    const targetSpending = retired ? spending : 0;
    const baseCashNeed = Math.max(0, targetSpending - benefits - otherIncome);
    const annualIncomeBeforeWithdrawal = (benefits + otherIncome) * 12 + annualTaxableIncome;
    const provisional = calculateBasicTax(Math.max(0, annualIncomeBeforeWithdrawal + baseCashNeed * 12), scenario.household.province, maxAge).totalTax / 12;
    let remainingNeed = Math.max(0, baseCashNeed + provisional);
    let withdrawals = mandatoryTaken;
    let taxableWithdrawals = mandatoryTaken;

    // Mandatory registered withdrawals can satisfy spending needs, but excess
    // cash is retained in the household rather than immediately withdrawn again.
    remainingNeed = Math.max(0, remainingNeed - mandatoryTaken);

    for (const bucket of withdrawalOrder(scenario.strategy.withdrawalPolicy)) {
      if (remainingNeed <= 0) break;
      const taken = withdrawFromBucket(accounts, bucket, remainingNeed);
      remainingNeed -= taken;
      withdrawals += taken;
      if (bucket === "registered") taxableWithdrawals += taken;
    }

    const nonRegisteredTaken = 0;
    const monthlyTaxableIncome = taxableWithdrawals;
    annualTaxableIncome += monthlyTaxableIncome;
    annualBenefits += benefits;

    const yearEnd = date.getUTCMonth() === 11;
    if (yearEnd) {
      const annualTax = calculateBasicTax(Math.max(0, annualTaxableIncome), scenario.household.province, maxAge);
      annualTax = annualTax.totalTax;
      previousYearTaxableIncome = annualTaxableIncome;
      previousYearBenefitIncome = annualBenefits * 1;
      annualTaxableIncome = 0;
      annualBenefits = 0;
    }

    const tax = calculateBasicTax(Math.max(0, monthlyTaxableIncome * 12), scenario.household.province, maxAge);
    const monthlyTax = retired ? tax.totalTax / 12 : 0;
    const shortfall = Math.max(0, remainingNeed);
    const portfolio = accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    const netWorth = portfolio;

    lifetimeSpending += targetSpending;
    lifetimeTax += monthlyTax;
    totalBenefits += benefits;
    maxShortfall = Math.max(maxShortfall, shortfall);

    monthly.push({
      date: date.toISOString(),
      ages,
      householdStage: "BOTH_ALIVE",
      portfolio,
      registered: sumBucket(accounts, "registered"),
      tfsa: sumBucket(accounts, "tfsa"),
      nonRegistered: sumBucket(accounts, "nonRegistered"),
      cash: sumBucket(accounts, "cash"),
      debt: 0,
      netWorth,
      grossIncome: benefits + otherIncome + withdrawals,
      benefits,
      withdrawals,
      taxes: monthlyTax,
      spending: targetSpending,
      shortfall,
    });

    if (allRetired) spending *= 1 + monthlyInflation;
  }

  const endingPortfolio = monthly.at(-1)?.portfolio ?? startingPortfolio;
  const minimumPortfolio = monthly.length ? Math.min(...monthly.map((x) => x.portfolio)) : startingPortfolio;
  const scenarioHash = stableHash({
    scenario,
    startingPortfolio,
    portfolioByType,
    startYear,
    engine: RETIREMENT_ENGINE_VERSION,
    rules: RETIREMENT_RULES_VERSION,
  });

  const warnings = [
    "Simulation is deterministic and monthly; investment returns are smoothed rather than sequence-of-returns simulated.",
    "Canadian tax and benefit rules are versioned, but provincial tax coverage and detailed benefit eligibility remain incomplete.",
    "Non-registered withdrawals currently do not model security lots, adjusted cost base, dividends or capital-gain inclusion.",
    "Survivor/death events, debt amortization and pension splitting are not yet fully modelled.",
  ];

  return {
    simulationId: crypto.randomUUID(),
    scenarioId: scenario.id,
    status: "COMPLETE",
    startDate: monthly[0]?.date ?? start.toISOString(),
    endDate: monthly.at(-1)?.date ?? start.toISOString(),
    monthly,
    metrics: {
      feasible: maxShortfall === 0,
      depletionDate: monthly.find((x) => x.portfolio <= 0)?.date,
      lifetimeSpending,
      lifetimeAfterTaxCash: Math.max(0, lifetimeSpending - lifetimeTax),
      lifetimeTax,
      totalBenefits,
      endingPortfolio,
      endingNetWorth: endingPortfolio,
      minimumPortfolio,
      maximumSpendingShortfall: maxShortfall,
    },
    warnings,
    assumptions: [
      { path: "investmentReturn", value: scenario.assumptions.investmentReturn, source: "USER" },
      { path: "inflationRate", value: scenario.assumptions.inflationRate, source: "USER" },
      { path: "investmentFeeRate", value: scenario.assumptions.investmentFeeRate, source: "USER" },
      { path: "province", value: scenario.household.province, source: "USER" },
      { path: "rules", value: RETIREMENT_RULES_VERSION, source: "GOVERNMENT_RULE" },
    ],
    engineVersion: RETIREMENT_ENGINE_VERSION,
    rulesVersion: RETIREMENT_RULES_VERSION,
    scenarioHash,
  };
}

// Backward-compatible alias while the UI migrates away from the foundation name.
export const runBasicSimulation = runRetirementSimulation;
