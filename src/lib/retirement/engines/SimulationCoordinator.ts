import type { RetirementScenario, SimulationResult, MonthlySnapshot, AccountScenario } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION, RETIREMENT_RULES_VERSION } from "../scenario/defaults";
import { estimateGovernmentBenefits } from "./BenefitEngine";
import { calculateBasicTax } from "./TaxEngine";

function ageAtMonth(birthYear: number, birthMonth: number, date: Date) {
  return date.getUTCFullYear() - birthYear - (date.getUTCMonth() + 1 < birthMonth ? 1 : 0);
}

function annualize(balance: number, monthlyRate: number) {
  return balance * (1 + monthlyRate);
}

function accountBucket(type: AccountScenario["type"]) {
  if (type === "TFSA") return "tfsa";
  if (["RRSP", "RRIF", "LIRA", "LIF"].includes(type)) return "registered";
  if (type === "CASH") return "cash";
  return "nonRegistered";
}

function withdrawalOrder(policy: RetirementScenario["strategy"]["withdrawalPolicy"]): string[] {
  if (policy === "TFSA_FIRST") return ["tfsa", "cash", "nonRegistered", "registered"];
  if (policy === "NON_REGISTERED_FIRST") return ["nonRegistered", "cash", "registered", "tfsa"];
  return ["cash", "nonRegistered", "registered", "tfsa"];
}

export function runBasicSimulation(
  scenario: RetirementScenario,
  startingPortfolio: number,
  startYear = new Date().getUTCFullYear(),
  portfolioByType: Record<string, number> = {},
): SimulationResult {
  const start = new Date(Date.UTC(startYear, 0, 1));
  const months = 12 * Math.max(1, scenario.goals.planningAge - scenario.goals.retirementAge);
  const monthly: MonthlySnapshot[] = [];
  const accounts: Record<string, number> = {
    registered: portfolioByType.RRSP ?? 0,
    tfsa: portfolioByType.TFSA ?? 0,
    nonRegistered: (portfolioByType.NON_REGISTERED ?? 0) + (portfolioByType.INVESTMENT ?? 0),
    cash: portfolioByType.CASH ?? 0,
  };
  if (Object.values(accounts).every((v) => v === 0)) accounts.nonRegistered = startingPortfolio;

  let lifetimeSpending = 0, lifetimeTax = 0, totalBenefits = 0;
  let spending = scenario.goals.annualSpending / 12;
  const monthlyReturn = Math.pow(1 + scenario.assumptions.investmentReturn / 100, 1 / 12) - 1;
  const monthlyInflation = Math.pow(1 + scenario.assumptions.inflationRate / 100, 1 / 12) - 1;
  let previousTaxableIncome = 0;

  for (let i = 0; i < months; i++) {
    const date = new Date(start.getTime());
    date.setUTCMonth(start.getUTCMonth() + i);
    const ages: Record<string, number> = {};
    for (const person of scenario.household.people) ages[person.role] = ageAtMonth(person.birthYear, person.birthMonth, date);

    const retired = Object.values(ages).some((age) => age >= scenario.goals.retirementAge);
    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      accounts[key] = annualize(accounts[key], monthlyReturn) - scenario.strategy.cashReserve / Math.max(1, months);
    }

    let benefits = 0;
    for (const person of scenario.household.people) {
      const age = ages[person.role] ?? 0;
      if (age >= scenario.goals.retirementAge) {
        const b = estimateGovernmentBenefits(person, age, previousTaxableIncome);
        benefits += (b.cpp + b.oas + b.gis) / 12;
      }
    }

    const target = retired ? spending : 0;
    const cashNeedBeforeTax = Math.max(0, target - benefits);
    const provisionalTax = calculateBasicTax(previousTaxableIncome + cashNeedBeforeTax * 12, scenario.household.province, Math.max(...Object.values(ages), 65)).totalTax / 12;
    const cashNeed = Math.max(0, cashNeedBeforeTax + provisionalTax);
    let remainingNeed = cashNeed;
    let withdrawals = 0;
    let taxableWithdrawals = 0;

    for (const bucket of withdrawalOrder(scenario.strategy.withdrawalPolicy)) {
      const take = Math.min(accounts[bucket as keyof typeof accounts], remainingNeed);
      accounts[bucket as keyof typeof accounts] -= take;
      remainingNeed -= take;
      withdrawals += take;
      if (bucket === "registered" || bucket === "nonRegistered") taxableWithdrawals += take;
      if (remainingNeed <= 0) break;
    }

    const taxableIncome = Math.max(0, previousTaxableIncome + taxableWithdrawals * 12);
    const tax = calculateBasicTax(taxableIncome, scenario.household.province, Math.max(...Object.values(ages), 65));
    const monthlyTax = retired ? tax.totalTax / 12 : 0;
    const shortfall = Math.max(0, cashNeed - withdrawals);
    const portfolio = Object.values(accounts).reduce((a, b) => a + Math.max(0, b), 0);
    lifetimeSpending += target;
    lifetimeTax += monthlyTax;
    totalBenefits += benefits;

    monthly.push({
      date: date.toISOString(),
      ages,
      householdStage: "BOTH_ALIVE",
      portfolio,
      registered: accounts.registered,
      tfsa: accounts.tfsa,
      nonRegistered: accounts.nonRegistered,
      cash: accounts.cash,
      debt: 0,
      netWorth: portfolio,
      grossIncome: benefits + withdrawals,
      benefits,
      withdrawals,
      taxes: monthlyTax,
      spending: target,
      shortfall,
    });
    previousTaxableIncome = taxableIncome / 12;
    spending *= 1 + monthlyInflation;
  }

  const shortfall = monthly.reduce((m, x) => Math.max(m, x.shortfall), 0);
  const endingPortfolio = monthly.at(-1)?.portfolio ?? startingPortfolio;
  return {
    simulationId: crypto.randomUUID(),
    scenarioId: scenario.id,
    status: "COMPLETE",
    startDate: monthly[0]?.date ?? start.toISOString(),
    endDate: monthly.at(-1)?.date ?? start.toISOString(),
    monthly,
    metrics: {
      feasible: shortfall === 0,
      depletionDate: monthly.find(x => x.portfolio <= 0)?.date,
      lifetimeSpending,
      lifetimeAfterTaxCash: lifetimeSpending,
      lifetimeTax,
      totalBenefits,
      endingPortfolio,
      endingNetWorth: endingPortfolio,
      minimumPortfolio: Math.min(...monthly.map(x => x.portfolio)),
      maximumSpendingShortfall: shortfall,
    },
    warnings: [
      "Simulation V1 uses monthly deterministic returns and simplified Canadian tax/benefit rules.",
      "GIS, survivor benefits, RRIF/LIF minimums, pension splitting, capital-gain ACB and debt are not yet modelled.",
      "OAS recovery is included as an incremental tax estimate; detailed prior-year recovery timing remains to be added.",
    ],
    assumptions: [
      { path: "investmentReturn", value: scenario.assumptions.investmentReturn, source: "USER" },
      { path: "inflationRate", value: scenario.assumptions.inflationRate, source: "USER" },
      { path: "province", value: scenario.household.province, source: "USER" },
      { path: "rules", value: RETIREMENT_RULES_VERSION, source: "GOVERNMENT_RULE" },
    ],
    engineVersion: RETIREMENT_ENGINE_VERSION,
    rulesVersion: RETIREMENT_RULES_VERSION,
    scenarioHash: scenario.id,
  };
}
