import type { RetirementScenario, SimulationResult, MonthlySnapshot, PersonRole, PersonScenario } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION, RETIREMENT_RULES_VERSION } from "../scenario/defaults";
import { estimateGovernmentBenefits, estimateCppSurvivorAnnual } from "./BenefitEngine";
import { calculateBasicTax } from "./TaxEngine";
import { createAccountState, applyMonthlyReturn, mandatoryRegisteredWithdrawal, withdraw, applyAccountDeathTreatment, type AccountState } from "./AccountEngine";
import { validateRetirementScenario } from "../validation/RetirementValidation";

function ageAtMonth(birthYear: number, birthMonth: number, date: Date) {
  return date.getUTCFullYear() - birthYear - (date.getUTCMonth() + 1 < birthMonth ? 1 : 0);
}


type PersonWithDeath = PersonScenario & { deathAge?: number; survivorCppPercent?: number };
function householdStageForMonth(people: PersonScenario[], ages: Partial<Record<PersonRole, number>>): "BOTH_ALIVE" | "SURVIVOR" | "ESTATE" {
  const alive = people.filter((person) => {
    const deathAge = (person as PersonWithDeath).deathAge;
    return typeof deathAge !== "number" || (ages[person.role] ?? 0) < deathAge;
  });
  return alive.length >= 2 ? "BOTH_ALIVE" : alive.length === 1 ? "SURVIVOR" : "ESTATE";
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

function annualizedTax(
  taxableYearToDate: number,
  currentMonthTaxableIncome: number,
  monthsElapsed: number,
  province: RetirementScenario["household"]["province"],
  age: number,
) {
  const annualizedIncome = monthsElapsed > 0
    ? ((taxableYearToDate + currentMonthTaxableIncome) / monthsElapsed) * 12
    : currentMonthTaxableIncome * 12;

  return calculateBasicTax(annualizedIncome, province, age).totalTax / 12;
}

export function runRetirementSimulation(
  scenario: RetirementScenario,
  startingPortfolio: number,
  startYear = new Date().getUTCFullYear(),
  portfolioByType: Record<string, number> = {},
): SimulationResult {
  const start = new Date(Date.UTC(startYear, 0, 1));
  const people = scenario.household.people;
  const planningEndYear = Math.min(...people.map((p) => p.birthYear + scenario.goals.planningAge));\n  const months = Math.max(1, 12 * (planningEndYear - startYear) + 12);
  const accounts = scenario.accounts.length
    ? scenario.accounts.map(createAccountState)
    : Object.entries(portfolioByType).map(([type, value]) => createAccountState({
        id: `portfolio-${type}`,
        owner: "MAIN_USER",
        type: (type === "RRSP" || type === "RRIF" || type === "TFSA" || type === "NON_REGISTERED" || type === "CASH" ? type : "NON_REGISTERED") as never,
        valuation: { mode: "SNAPSHOT", linkedValue: value },
      }));

  if (!scenario.accounts.length && accounts.every((a) => a.balance === 0)) {
    accounts.push(createAccountState({
      id: "portfolio-total",
      owner: "MAIN_USER",
      type: "NON_REGISTERED",
      valuation: { mode: "SNAPSHOT", linkedValue: startingPortfolio },
    }));
  }

  const monthly: MonthlySnapshot[] = [];
  const monthlyInflation = Math.pow(1 + scenario.assumptions.inflationRate / 100, 1 / 12) - 1;
  let spending = scenario.goals.annualSpending / 12;
  let lifetimeSpending = 0;
  let lifetimeTax = 0;
  let totalBenefits = 0;
  let maxShortfall = 0;
  let yearTaxableIncome = 0;
  let priorYearTaxableIncome = 0;
  let yearTax = 0;
  let currentTax = 0;
  let previousStage: "BOTH_ALIVE" | "SURVIVOR" | "ESTATE" = "BOTH_ALIVE";

  for (let i = 0; i < months; i++) {
    const date = new Date(start.getTime());
    date.setUTCMonth(start.getUTCMonth() + i);
    const ages = Object.fromEntries(
      people.map((person) => [person.role, ageAtMonth(person.birthYear, person.birthMonth, date)]),
    ) as Partial<Record<PersonRole, number>>;
    const maxAge = Math.max(...Object.values(ages).map(Number), 0);
    const stage = householdStageForMonth(people, ages);
    const alivePeople = people.filter((person) => { const deathAge = (person as PersonWithDeath).deathAge; return typeof deathAge !== "number" || (ages[person.role] ?? 0) < deathAge; });
    const retired = alivePeople.some((person) => (ages[person.role] ?? 0) >= person.retirementAge);
    const allRetired = alivePeople.length > 0 && alivePeople.every((person) => (ages[person.role] ?? 0) >= person.retirementAge);

    for (const account of accounts) {
      account.balance = applyMonthlyReturn(
        account.balance,
        scenario.assumptions.investmentReturn,
        scenario.assumptions.investmentFeeRate,
      );

      const ownerAge = ages[account.owner] ?? maxAge;
      if (
        !retired &&
        account.contributionAnnual > 0 &&
        (!account.contributionUntilAge || ownerAge < account.contributionUntilAge)
      ) {
        account.balance += account.contributionAnnual / 12;
      }
    }

    let benefits = 0;
    let taxableBenefits = 0;
    let otherIncome = 0;
    let survivorBenefits = 0;
    let deathTax = 0;
    let estateGross = 0;

    for (const person of alivePeople) {
      const age = ages[person.role] ?? 0;
      const partner = people.find((candidate) => candidate.role !== person.role);
      const partnerAge = partner ? ages[partner.role] ?? 0 : undefined;
      const partnerReceivesOas = partner
        ? typeof partner.oasStartAge === "number" && partnerAge !== undefined && partnerAge >= partner.oasStartAge
        : false;

      if (age >= 60) {
        const benefit = estimateGovernmentBenefits(person, age, priorYearTaxableIncome, {
          householdSize: people.length,
          partnerAge,
          partnerReceivesOas,
          // Couple GIS thresholds are based on combined income. The current
          // simulation keeps a household-level prior-year income ledger.
          partnerIncomeForBenefits: 0,
          previousYearIncome: priorYearTaxableIncome,
          inflationRate: scenario.assumptions.inflationRate,
          calendarYear: date.getUTCFullYear(),
        });
        benefits += (benefit.cpp + benefit.oas + benefit.gis) / 12;
        taxableBenefits += (benefit.cpp + benefit.oas) / 12;
      }
      otherIncome += (person.otherIncome ?? 0) / 12;
    }

    if (stage === "SURVIVOR") {
      const survivor = alivePeople[0];
      const deceased = people.find((person) => person.role !== survivor?.role);
      if (survivor && deceased) {
        const deceasedP = deceased as PersonWithDeath;
        const survivorAge = ages[survivor.role] ?? 0;
        const deceasedCpp = estimateGovernmentBenefits(deceased, Math.max(0, (deceasedP.deathAge ?? 0) - 0.01), 0, { inflationRate: scenario.assumptions.inflationRate, calendarYear: date.getUTCFullYear() }).cpp;
        const existingCpp = estimateGovernmentBenefits(survivor, survivorAge, priorYearTaxableIncome, { inflationRate: scenario.assumptions.inflationRate, calendarYear: date.getUTCFullYear() }).cpp;
        const survivorCpp = estimateCppSurvivorAnnual(deceasedCpp, survivorAge, existingCpp, deceasedP.survivorCppPercent ?? 60);
        survivorBenefits = survivorCpp / 12;
        benefits += survivorBenefits;
        taxableBenefits += survivorBenefits;
      }
    }

    let mandatoryWithdrawals = 0;
    for (const account of accounts) {
      mandatoryWithdrawals += mandatoryRegisteredWithdrawal(
        account.type,
        ages[account.owner] ?? maxAge,
        account.balance,
      );
    }

    const mandatoryTaken = withdrawFromBucket(accounts, "registered", mandatoryWithdrawals);
    const taxableMandatory = mandatoryTaken;
    let targetSpending = retired ? spending : 0;
    if (stage === "SURVIVOR" && targetSpending > 0) targetSpending *= Math.max(0, Math.min(1, scenario.goals.survivorSpendingRate ?? 0.75));
    if (stage === "ESTATE") targetSpending = 0;

    const baseTaxableThisMonth = taxableBenefits + otherIncome + taxableMandatory;
    const baseTax = annualizedTax(
      yearTaxableIncome,
      baseTaxableThisMonth,
      date.getUTCMonth() + 1,
      scenario.household.province,
      maxAge,
    );

    const baseCashNeed = Math.max(0, targetSpending - benefits - otherIncome);
    let remainingNeed = Math.max(0, baseCashNeed + baseTax);
    let withdrawals = mandatoryTaken;
    let taxableWithdrawals = taxableMandatory;

    remainingNeed = Math.max(0, remainingNeed - mandatoryTaken);

    for (const bucket of withdrawalOrder(scenario.strategy.withdrawalPolicy)) {
      if (remainingNeed <= 0) break;

      let candidate = Math.min(sumBucket(accounts, bucket), remainingNeed);
      if (candidate <= 0) continue;

      if (bucket === "registered") {
        for (let iteration = 0; iteration < 8; iteration++) {
          const testTaxable = yearTaxableIncome + taxableBenefits + otherIncome + taxableWithdrawals + candidate;
          const taxAfter = calculateBasicTax(
            (testTaxable / Math.max(1, date.getUTCMonth() + 1)) * 12,
            scenario.household.province,
            maxAge,
          ).totalTax / 12;
          const incrementalTax = Math.max(0, taxAfter - currentTax);
          const requiredGross = Math.min(
            sumBucket(accounts, bucket),
            Math.max(candidate, baseCashNeed + baseTax + incrementalTax),
          );
          if (Math.abs(requiredGross - candidate) < 0.01) break;
          candidate = requiredGross;
        }
      }

      const taken = withdrawFromBucket(accounts, bucket, candidate);
      remainingNeed -= taken;
      withdrawals += taken;
      if (bucket === "registered") taxableWithdrawals += taken;
    }

    const monthlyTaxableIncome = taxableBenefits + otherIncome + taxableWithdrawals;
    yearTaxableIncome += monthlyTaxableIncome;

    currentTax = annualizedTax(
      yearTaxableIncome - monthlyTaxableIncome,
      monthlyTaxableIncome,
      date.getUTCMonth() + 1,
      scenario.household.province,
      maxAge,
    );

    const yearEnd = date.getUTCMonth() === 11;
    if (yearEnd) {
      yearTax = calculateBasicTax(
        yearTaxableIncome,
        scenario.household.province,
        maxAge,
      ).totalTax;
      currentTax = yearTax / 12;
      priorYearTaxableIncome = yearTaxableIncome;
      yearTaxableIncome = 0;
    }

    if (stage === "SURVIVOR" && previousStage === "BOTH_ALIVE") {
      const survivor = alivePeople[0];
      for (const account of accounts) {
        if (!survivor || account.owner === survivor.role) continue;
        const scenarioAccount = scenario.accounts.find((candidate) => candidate.id === account.id);
        const treatment = applyAccountDeathTreatment(
          account,
          true,
          scenarioAccount?.nonRegisteredAcb ?? 0,
          scenarioAccount?.deathTransfer ?? "SPOUSE",
        );
        if (treatment.transferredToSurvivor > 0) {
          const target = accounts.find((candidate) => candidate.owner === survivor.role && candidate.type === account.type)
            ?? accounts.find((candidate) => candidate.owner === survivor.role && candidate.type === "CASH");
          if (target) target.balance += treatment.transferredToSurvivor;
          else {
            account.owner = survivor.role;
            account.balance = treatment.transferredToSurvivor;
          }
        }
        account.balance = 0;
      }
    }

    if (stage === "ESTATE" && previousStage !== "ESTATE") {
      for (const account of accounts) {
        const scenarioAccount = scenario.accounts.find((candidate) => candidate.id === account.id);
        const hasSpouse = alivePeople.length === 1;
        const transfer = scenarioAccount?.deathTransfer ?? (hasSpouse ? "SPOUSE" : "ESTATE");
        const treatment = applyAccountDeathTreatment(account, hasSpouse, scenarioAccount?.nonRegisteredAcb ?? 0, transfer);
        const deathTaxableIncome = treatment.taxableAtDeath + treatment.taxableCapitalGainAtDeath;
        deathTax += calculateBasicTax(deathTaxableIncome, scenario.household.province, maxAge).totalTax;
        estateGross += treatment.estateValue + treatment.transferredToSurvivor;
        account.balance = treatment.estateValue;
      }
    }

    previousStage = stage;

    const shortfall = Math.max(0, remainingNeed);
    const portfolio = accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    const netWorth = portfolio;

    lifetimeSpending += targetSpending;
    lifetimeTax += currentTax + deathTax;
    totalBenefits += benefits;
    maxShortfall = Math.max(maxShortfall, shortfall);

    monthly.push({
      date: date.toISOString(),
      ages,
      householdStage: stage,
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
      taxes: currentTax + deathTax,
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
    "2026 federal and provincial tax brackets are loaded from the versioned rules dataset. Detailed credits, Quebec taxation and advanced tax rules remain incomplete.",
    "Non-registered withdrawals currently do not model security lots, adjusted cost base, dividends or capital-gain inclusion.",
    "Death ages now transition the household through BOTH_ALIVE → SURVIVOR → ESTATE; CPP survivor and account death treatment are modelled at a planning level, while final-return tax, beneficiary paperwork, ACB and detailed provincial estate rules remain simplified.",
    "GIS uses the prior-year household income ledger and published 2026 marital-status thresholds; detailed GIS table interpolation and earnings exemptions remain to be added.",
    "OAS recovery is modelled as an income-based estimate and is not yet tied to the actual OAS amount paid in each recovery period.",
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
      survivorShortfall: monthly.filter((x) => x.householdStage === "SURVIVOR").reduce((m, x) => Math.max(m, x.shortfall), 0),
      estateValue: monthly.at(-1)?.householdStage === "ESTATE" ? Math.max(0, estateGross - deathTax) : undefined,
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

export const runBasicSimulation = runRetirementSimulation;
