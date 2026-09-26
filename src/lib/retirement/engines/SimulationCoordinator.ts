import type { RetirementScenario, SimulationResult, MonthlySnapshot, PersonRole, PersonScenario } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION, RETIREMENT_RULES_VERSION } from "../scenario/defaults";
import { estimateGovernmentBenefits, estimateCppSurvivorAnnual } from "./BenefitEngine";
import { calculateHouseholdTax, type TaxIncomeComponents } from "./TaxEngine";
import { solveGrossWithdrawalForNetNeed, chooseRegisteredWithdrawalOwner } from "./WithdrawalEngine";
import { createAccountState, applyMonthlyReturn, mandatoryRegisteredWithdrawal, withdraw, withdrawNonRegistered, estimateNonRegisteredMonthlyIncome, applyAccountDeathTreatment, type AccountState } from "./AccountEngine";
import { validateRetirementScenario } from "../validation/RetirementValidation";
import { createDebtState, accrueDebtMonth, type DebtState } from "./DebtEngine";
import { reconcileMonthlyCashFlow } from "./CashFlowEngine";
import { reconcileMonthlyFinancialLedger } from "./MonthlyFinancialLedger";

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

function withdrawFromBucket(accounts: AccountState[], bucket: ReturnType<typeof bucketOf>, amount: number, owner?: PersonRole) {
  let remaining = Math.max(0, amount);
  let taken = 0;
  for (const account of accounts.filter((a) => bucketOf(a) === bucket && (owner === undefined || a.owner === owner))) {
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
  const validationIssues = validateRetirementScenario(scenario);
  const validationErrors = validationIssues.filter((issue) => issue.severity === "ERROR");
  if (validationErrors.length > 0) {
    const scenarioHash = stableHash({ scenario, startYear, rulesVersion: RETIREMENT_RULES_VERSION, engineVersion: RETIREMENT_ENGINE_VERSION });
    return {
      simulationId: `invalid-${scenario.id}`,
      scenarioId: scenario.id,
      status: "INVALID",
      startDate: new Date(Date.UTC(startYear, 0, 1)).toISOString(),
      endDate: new Date(Date.UTC(startYear, 0, 1)).toISOString(),
      monthly: [],
      metrics: {
        feasible: false,
        lifetimeSpending: 0,
        lifetimeAfterTaxCash: 0,
        lifetimeTax: 0,
        totalBenefits: 0,
        endingPortfolio: 0,
        endingNetWorth: 0,
        minimumPortfolio: 0,
        maximumSpendingShortfall: 0,
      },
      warnings: validationErrors.map((issue) => `${issue.id}: ${issue.message}`),
      assumptions: [],
      engineVersion: RETIREMENT_ENGINE_VERSION,
      rulesVersion: RETIREMENT_RULES_VERSION,
      scenarioHash,
    };
  }
  const start = new Date(Date.UTC(startYear, 0, 1));
  const people = scenario.household.people;
  const planningEndYear = Math.min(...people.map((p) => p.birthYear + scenario.goals.planningAge));
  const months = Math.max(1, 12 * (planningEndYear - startYear) + 12);
  const debtStates: Array<{ state: DebtState; startDate?: string; endDate?: string }> = (scenario.debts ?? []).map((debt) => ({ state: createDebtState(debt), startDate: debt.startDate, endDate: debt.endDate }));
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
  let totalDebtInterest = 0;
  let totalDebtPayments = 0;
  let yearTaxableIncome = 0;
  let priorYearTaxableIncome = 0;
  let yearTax = 0;
  let currentTax = 0;
  let cumulativeTaxLiability = 0;
  const yearTaxInputs: Record<PersonRole, TaxIncomeComponents> = { MAIN_USER: {}, PARTNER: {} };
  let previousStage: "BOTH_ALIVE" | "SURVIVOR" | "ESTATE" = "BOTH_ALIVE";

  for (let i = 0; i < months; i++) {
    const beginningPortfolio = accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    const beginningDebt = debtStates.reduce((sum, debt) => sum + Math.max(0, debt.state.balance), 0);
    let contributionsThisMonth = 0;
    let investmentGrowthThisMonth = 0;
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

    const calendarYear = date.getUTCFullYear();
    for (const account of accounts) {
      if (account.minimumReferenceYear !== calendarYear && (account.type === "RRIF" || account.type === "LIF")) {
        account.minimumReferenceBalance = account.balance;
        account.minimumReferenceYear = calendarYear;
      }
      const beforeReturn = account.balance;
      account.balance = applyMonthlyReturn(
        account.balance,
        scenario.assumptions.investmentReturn,
        scenario.assumptions.investmentFeeRate,
      );
      investmentGrowthThisMonth += account.balance - beforeReturn;

      const ownerAge = ages[account.owner] ?? maxAge;
      if (
        !retired &&
        account.contributionAnnual > 0 &&
        (!account.contributionUntilAge || ownerAge < account.contributionUntilAge)
      ) {
        const contribution = account.contributionAnnual / 12;
        account.balance += contribution;
        contributionsThisMonth += contribution;
        if (account.type === "NON_REGISTERED") account.nonRegisteredAcb += contribution;
      }
    }

    let debtInterest = 0;
    let debtPayments = 0;
    let debtPrincipal = 0;
    if (stage !== "ESTATE") {
      for (const debt of debtStates) {
        if (debt.startDate && date.toISOString().slice(0, 10) < debt.startDate) continue;
        if (debt.endDate && date.toISOString().slice(0, 10) > debt.endDate) continue;
        const result = accrueDebtMonth(debt.state);
        debtInterest += result.interest;
        debtPayments += result.totalPayment;
        debtPrincipal += result.scheduledPrincipal + result.extraPrincipal;
      }
    }
    totalDebtInterest += debtInterest;
    totalDebtPayments += debtPayments;

    let benefits = 0;
    let taxableBenefits = 0;
    let otherIncome = 0;
    let nonRegisteredInvestmentIncome = 0;
    let nonRegisteredCapitalGains = 0;
    const monthlyTaxInputs: Record<PersonRole, TaxIncomeComponents> = {};
    for (const person of alivePeople) {
      monthlyTaxInputs[person.role] = { age: ages[person.role] ?? 0 };
      yearTaxInputs[person.role].age = ages[person.role] ?? 0;
    }

    // Generate taxable investment income from current non-registered values.
    // Income is treated as distributed cash available for spending in V1.
    for (const account of accounts) {
      if (account.type !== "NON_REGISTERED") continue;
      const investmentIncome = estimateNonRegisteredMonthlyIncome(account);
      nonRegisteredInvestmentIncome +=
        investmentIncome.eligibleCanadianDividends +
        investmentIncome.nonEligibleCanadianDividends +
        investmentIncome.interest +
        investmentIncome.foreignIncome;
      if (!monthlyTaxInputs[account.owner]) {
        monthlyTaxInputs[account.owner] = { age: ages[account.owner] ?? maxAge };
      }
      monthlyTaxInputs[account.owner].eligibleCanadianDividends =
        (monthlyTaxInputs[account.owner].eligibleCanadianDividends ?? 0) + investmentIncome.eligibleCanadianDividends;
      monthlyTaxInputs[account.owner].nonEligibleCanadianDividends =
        (monthlyTaxInputs[account.owner].nonEligibleCanadianDividends ?? 0) + investmentIncome.nonEligibleCanadianDividends;
      monthlyTaxInputs[account.owner].interest =
        (monthlyTaxInputs[account.owner].interest ?? 0) + investmentIncome.interest;
      monthlyTaxInputs[account.owner].foreignIncome =
        (monthlyTaxInputs[account.owner].foreignIncome ?? 0) + investmentIncome.foreignIncome;
      monthlyTaxInputs[account.owner].foreignTaxPaid =
        (monthlyTaxInputs[account.owner].foreignTaxPaid ?? 0) + investmentIncome.foreignTaxPaid;
    }
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
        const monthlyCpp = benefit.cpp / 12;
        const monthlyOas = benefit.oas / 12;
        const monthlyGis = benefit.gis / 12;
        benefits += monthlyCpp + monthlyOas + monthlyGis;
        taxableBenefits += monthlyCpp + monthlyOas;
        monthlyTaxInputs[person.role].cpp = (monthlyTaxInputs[person.role].cpp ?? 0) + monthlyCpp;
        monthlyTaxInputs[person.role].oas = (monthlyTaxInputs[person.role].oas ?? 0) + monthlyOas;
      }
      const monthlyOtherIncome = (person.otherIncome ?? 0) / 12;
      otherIncome += monthlyOtherIncome;
      monthlyTaxInputs[person.role].pension = (monthlyTaxInputs[person.role].pension ?? 0) + monthlyOtherIncome;
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

    let mandatoryTaken = 0;
    const mandatoryByOwner: Record<PersonRole, number> = { MAIN_USER: 0, PARTNER: 0 };
    for (const account of accounts) {
      const required = mandatoryRegisteredWithdrawal(
        account.type,
        ages[account.owner] ?? maxAge,
        account.balance,
        account.minimumReferenceBalance ?? account.balance,
      );
      if (required <= 0) continue;
      const taken = withdraw(account, required);
      mandatoryTaken += taken;
      mandatoryByOwner[account.owner] += taken;
    }
    const taxableMandatory = mandatoryTaken;
    let targetSpending = retired ? spending : 0;
    if (stage === "SURVIVOR" && targetSpending > 0) targetSpending *= Math.max(0, Math.min(1, scenario.goals.survivorSpendingRate ?? 0.75));
    if (stage === "ESTATE") targetSpending = 0;

    const baseCashNeed = Math.max(0, targetSpending + debtPayments - benefits - otherIncome - nonRegisteredInvestmentIncome);
    let remainingNeed = Math.max(0, baseCashNeed - mandatoryTaken);
    let withdrawals = mandatoryTaken;
    let taxableWithdrawals = taxableMandatory;

    const registeredWithdrawalsByOwner: Record<PersonRole, number> = { MAIN_USER: 0, PARTNER: 0 };

    // Include all income already earned in the current tax year plus this
    // month's benefits/other income/mandatory withdrawals when solving the
    // gross registered withdrawal. This avoids treating tax as a flat add-on.
    const taxBaseByOwner: Record<PersonRole, TaxIncomeComponents> = {
      MAIN_USER: { ...yearTaxInputs.MAIN_USER },
      PARTNER: { ...yearTaxInputs.PARTNER },
    };
    for (const person of alivePeople) {
      const role = person.role;
      for (const [key, value] of Object.entries(monthlyTaxInputs[role])) {
        if (key === "age" || typeof value !== "number") continue;
        taxBaseByOwner[role][key as keyof TaxIncomeComponents] =
          (taxBaseByOwner[role][key as keyof TaxIncomeComponents] as number ?? 0) + value;
      }
    }

    for (const bucket of withdrawalOrder(scenario.strategy.withdrawalPolicy)) {
      if (remainingNeed <= 0) break;
      let selectedRegisteredOwner: PersonRole | undefined;

      const available = sumBucket(accounts, bucket);
      if (available <= 0) continue;

      let candidate = Math.min(available, remainingNeed);
      if (bucket === "registered") {
        // Evaluate each owner's registered balance against the same household
        // tax position, rather than always draining the first account found.
        const allocation = chooseRegisteredWithdrawalOwner({
          netNeed: remainingNeed,
          owners: (["MAIN_USER", "PARTNER"] as const)
            .map((owner) => ({
              owner,
              balance: sumBucket(accounts.filter((account) => account.owner === owner), "registered"),
              age: ages[owner] ?? maxAge,
              taxInputs: taxBaseByOwner,
            }))
            .filter((owner) => owner.balance > 0),
          province: scenario.household.province,
          payerAge: ages.MAIN_USER ?? maxAge,
          spouseAge: ages.PARTNER,
          pensionSplitPercent: scenario.strategy.pensionSplitPercent ?? 0,
        });
        selectedRegisteredOwner = allocation?.owner;
        candidate = Math.min(available, allocation?.solved.grossWithdrawal ?? remainingNeed);
      }

      const beforeBalances = new Map(accounts.map((account) => [account.id, account.balance]));
      let taken = 0;
      if (bucket === "nonRegistered") {
        // Realize gains proportionally to the account's ACB instead of treating
        // every dollar withdrawn as tax-free principal.
        let remaining = candidate;
        for (const account of accounts.filter((a) => bucketOf(a) === bucket)) {
          if (remaining <= 0) break;
          const result = withdrawNonRegistered(account, remaining);
          taken += result.taken;
          nonRegisteredCapitalGains += result.realizedCapitalGain;
          remaining -= result.taken;
          if (result.realizedCapitalGain > 0) {
            monthlyTaxInputs[account.owner].capitalGains =
              (monthlyTaxInputs[account.owner].capitalGains ?? 0) + result.realizedCapitalGain;
          }
        }
      } else {
        taken = withdrawFromBucket(accounts, bucket, candidate, selectedRegisteredOwner);
      }
      if (taken <= 0) continue;
      withdrawals += taken;

      if (bucket === "registered") {
        taxableWithdrawals += taken;
        for (const account of accounts) {
          const before = beforeBalances.get(account.id) ?? account.balance;
          const actual = Math.max(0, before - account.balance);
          if (actual > 0) registeredWithdrawalsByOwner[account.owner] += actual;
        }

        // Convert the gross registered withdrawal into after-tax cash using
        // the same household tax model used for the annual tax ledger.
        const owner = selectedRegisteredOwner ?? accounts.find((account) => bucketOf(account) === "registered" && (beforeBalances.get(account.id) ?? 0) > account.balance)?.owner ?? "MAIN_USER";
        const ownerAge = ages[owner] ?? maxAge;
        const solved = solveGrossWithdrawalForNetNeed({
          netNeed: Math.min(remainingNeed, taken),
          payer: taxBaseByOwner.MAIN_USER,
          spouse: alivePeople.some((person) => person.role === "PARTNER") ? taxBaseByOwner.PARTNER : undefined,
          owner,
          province: scenario.household.province,
          payerAge: ages.MAIN_USER ?? maxAge,
          spouseAge: ages.PARTNER,
          pensionSplitPercent: scenario.strategy.pensionSplitPercent ?? 0,
          maxGross: taken,
        });
        remainingNeed -= Math.min(remainingNeed, Math.max(0, solved.netCash));
      } else {
        // Investment income is already counted as cash available for spending.
        // A non-registered withdrawal may also realize a taxable capital gain.
        remainingNeed -= taken;
      }
    }

    for (const person of alivePeople) {
      const role = person.role;
      const registered = registeredWithdrawalsByOwner[role] + (role === "MAIN_USER" ? mandatoryByOwner.MAIN_USER : mandatoryByOwner.PARTNER);
      monthlyTaxInputs[role].rrspRrif = (monthlyTaxInputs[role].rrspRrif ?? 0) + registered;
      if ((monthlyTaxInputs[role].age ?? 0) >= 65 && registered > 0) {
        monthlyTaxInputs[role].eligiblePensionIncome = (monthlyTaxInputs[role].eligiblePensionIncome ?? 0) + registered;
      }
    }

    const monthlyTaxableIncome = taxableBenefits + otherIncome + taxableWithdrawals + nonRegisteredCapitalGains * 0.5;
    yearTaxableIncome += monthlyTaxableIncome;

    const roles = alivePeople.map((person) => person.role);
    for (const role of roles) {
      for (const [key, value] of Object.entries(monthlyTaxInputs[role])) {
        if (key === "age" || key === "pensionSplitPercent" || typeof value !== "number") continue;
        yearTaxInputs[role][key as keyof TaxIncomeComponents] = (yearTaxInputs[role][key as keyof TaxIncomeComponents] as number ?? 0) + value;
      }
    }
    const payerInput = yearTaxInputs.MAIN_USER.age ? { ...yearTaxInputs.MAIN_USER } : { age: 65 };
    const spouseInput = roles.includes("PARTNER") ? { ...yearTaxInputs.PARTNER } : undefined;
    const householdTax = calculateHouseholdTax({
      payer: payerInput,
      spouse: spouseInput,
      province: scenario.household.province,
      payerAge: ages.MAIN_USER ?? 65,
      spouseAge: ages.PARTNER ?? 65,
      pensionSplitPercent: scenario.strategy.pensionSplitPercent ?? 0,
    });
    // The household tax engine calculates liability on the income accumulated
    // so far in the current tax year. Cash-flow reporting must therefore use
    // the month-over-month change in that liability, not annual liability / 12.
    // This prevents the same year's tax from being counted repeatedly.
    const householdTaxLiability = householdTax.householdTax;
    currentTax = Math.max(0, householdTaxLiability - cumulativeTaxLiability);
    cumulativeTaxLiability = householdTaxLiability;

    const yearEnd = date.getUTCMonth() === 11;
    if (yearEnd) {
      yearTax = householdTaxLiability;
      priorYearTaxableIncome = householdTax.householdNetIncome;
      yearTaxableIncome = 0;
      yearTaxInputs.MAIN_USER = {};
      yearTaxInputs.PARTNER = {};
      cumulativeTaxLiability = 0;
    }

    if (stage === "SURVIVOR" && previousStage === "BOTH_ALIVE") {
      const survivor = alivePeople[0];
      for (const account of accounts) {
        if (!survivor || account.owner === survivor.role) continue;
        const scenarioAccount = scenario.accounts.find((candidate) => candidate.id === account.id);
        const treatment = applyAccountDeathTreatment(
          account,
          true,
          account.nonRegisteredAcb,
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
    const debtBalance = debtStates.reduce((sum, debt) => sum + Math.max(0, debt.state.balance), 0);
    const netWorth = portfolio - debtBalance;

    lifetimeSpending += targetSpending;
    lifetimeTax += currentTax + deathTax;
    totalBenefits += benefits;
    maxShortfall = Math.max(maxShortfall, shortfall);

    const cashFlow = reconcileMonthlyCashFlow({
      beginningPortfolio,
      investmentGrowth: investmentGrowthThisMonth,
      contributions: contributionsThisMonth,
      grossIncome: benefits + otherIncome + nonRegisteredInvestmentIncome,
      withdrawals,
      taxes: currentTax + deathTax,
      spending: targetSpending,
      debtPayments,
      endingPortfolio: portfolio,
    });
    const financialLedger = reconcileMonthlyFinancialLedger({
      beginningPortfolio,
      investmentGrowth: investmentGrowthThisMonth,
      contributions: contributionsThisMonth,
      grossIncome: benefits + otherIncome + nonRegisteredInvestmentIncome,
      withdrawals,
      taxes: currentTax + deathTax,
      spending: targetSpending,
      debtPayments,
      debtPrincipal,
      debtInterest,
      endingPortfolio: portfolio,
      beginningDebt,
      endingDebt: debtBalance,
    });

    monthly.push({
      date: date.toISOString(),
      ages,
      householdStage: stage,
      portfolio,
      registered: sumBucket(accounts, "registered"),
      tfsa: sumBucket(accounts, "tfsa"),
      nonRegistered: sumBucket(accounts, "nonRegistered"),
      cash: sumBucket(accounts, "cash"),
      debt: debtBalance,
      netWorth,
      grossIncome: benefits + otherIncome + withdrawals,
      benefits,
      withdrawals,
      taxes: currentTax + deathTax,
      spending: targetSpending,
      debtPayments,
      debtInterest,
      debtPrincipal,
      shortfall,
      cashFlow: {
        beginningPortfolio,
        investmentGrowth: investmentGrowthThisMonth,
        contributions: contributionsThisMonth,
        grossIncome: benefits + otherIncome + nonRegisteredInvestmentIncome,
        grossWithdrawals: withdrawals,
        taxes: currentTax + deathTax,
        spending: targetSpending,
        debtPayments,
        endingPortfolio: portfolio,
        assetReconciliation: cashFlow.assetReconciliation,
        externalCashChange: financialLedger.externalCashChange,
        debtReconciliation: financialLedger.debtReconciliation,
        netWorthReconciliation: financialLedger.netWorthReconciliation,
      },
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
    "Non-registered withdrawals currently do not model security lots or superficial-loss rules; account-level ACB, investment income and realized capital gains are modeled.",
    "Debt is modeled monthly with interest, scheduled principal and optional extra payments; tax deductibility of interest is not assumed in V1.",
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
