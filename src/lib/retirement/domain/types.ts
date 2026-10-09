export type Money = number;
export type PersonRole = "MAIN_USER" | "PARTNER";
export type HouseholdStage = "BOTH_ALIVE" | "SURVIVOR" | "ESTATE";
export type AccountType = "RRSP" | "RRIF" | "TFSA" | "LIRA" | "LIF" | "NON_REGISTERED" | "CASH" | "PENSION" | "ANNUITY";
export type PortfolioLinkMode = "SNAPSHOT" | "LIVE_CURRENT" | "MANUAL";
export type ProvinceCode = "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";
export type Confidence = "USER_PROVIDED" | "USER_ESTIMATED" | "SYSTEM_DEFAULT" | "RULE_DERIVED";

export type DebtType = "MORTGAGE" | "HELOC" | "LINE_OF_CREDIT" | "PERSONAL_LOAN" | "OTHER";
export type DebtPaymentFrequency = "MONTHLY" | "BIWEEKLY" | "WEEKLY";

export interface DebtScenario {
  id: string;
  name?: string;
  type: DebtType;
  owner?: PersonRole;
  startingBalance: Money;
  annualInterestRate: number;
  paymentAmount?: Money;
  paymentFrequency?: DebtPaymentFrequency;
  amortizationMonths?: number;
  startDate?: string;
  endDate?: string;
  extraPayment?: Money;
  /** Portion of interest the user has verified is traceable to eligible income-earning use (0-100). */
  deductibleInterestPercent?: number;
}

/**
 * Defined-benefit pension. Modeled as a first-class income stream (not flat
 * "other income"): start-age adjustments, post-commencement indexation,
 * bridge benefit, and survivor continuation.
 *
 * Monetary amounts are in today's dollars; the engine converts to nominal.
 */
export interface DbPension {
  id: string;
  owner: PersonRole;
  name?: string;
  /** Monthly pension at the normal retirement age, today's dollars. */
  monthlyAmountAtNRA: Money;
  normalRetirementAge: number;
  /** Chosen commencement age. */
  startAge: number;
  /** Reduction per year commenced before NRA (e.g. 0.03). Default 0. */
  earlyReductionPerYear?: number;
  /** Increase per year commenced after NRA. Default 0. */
  lateIncreasePerYear?: number;
  /**
   * Explicit start-age table (monthly amounts, today's dollars), keyed by
   * commencement age. Overrides the early/late formula when provided.
   */
  startAgeTable?: Record<number, Money>;
  /** Indexation applied after commencement. */
  indexing: "none" | "full" | "partial";
  /** For "partial": fraction of CPI applied (0-1). */
  indexingFraction?: number;
  /** Bridge benefit: monthly amount (today's dollars), not indexed. */
  bridgeMonthly?: Money;
  /** Bridge paid while age < bridgeEndAge (typically 65). */
  bridgeEndAge?: number;
  /**
   * Survivor benefit as % of the member's pension at death (0-100).
   * Bridge is excluded; indexation continues per the plan rule.
   * Pre-commencement death is not modeled (returns 0).
   */
  survivorPercent?: number;
}

export interface PersonScenario {
  role: PersonRole;
  birthYear: number;
  birthMonth: number;
  retirementAge: number;
  cppAt65?: Money;
  /** Annual employment income while working, used for tax and GIS modelling. */
  employmentIncome?: Money;
  /** Annual net self-employment income while working, used for tax and GIS modelling. */
  selfEmploymentIncome?: Money;
  cppStartAge: number | "OPTIMIZE";
  oasStartAge: number | "OPTIMIZE";
  oasResidenceYears: number;
  otherIncome?: Money;
  deathAge?: number;
  survivorCppPercent?: number;
  /**
   * CPP contributory earnings history by year, for calculating CPP from
   * actual earnings instead of using a manual cppAt65 estimate.
   * When provided, cppAt65 is auto-calculated (manual value is ignored).
   */
  cppEarningsHistory?: Array<{ year: number; earnings: number }>;
  /** Expected annual earnings for future years (used with cppEarningsHistory). */
  cppFutureEarnings?: Money;
  /** Years eligible for CPP child-rearing dropout. */
  cppChildRearingYears?: number[];
}

export interface AccountScenario {
  id: string;
  owner: PersonRole;
  type: AccountType;
  valuation: { mode: PortfolioLinkMode; value?: Money; snapshotDate?: string; linkedValue?: Money };
  contribution?: { annualAmount: Money; untilAge?: number };
  protected?: boolean;
  nonRegisteredAcb?: Money;
  nonRegisteredEligibleDividendYield?: number;
  nonRegisteredNonEligibleDividendYield?: number;
  nonRegisteredInterestYield?: number;
  nonRegisteredForeignIncomeYield?: number;
  nonRegisteredForeignTaxRate?: number;
  deathTransfer?: "SPOUSE" | "ESTATE" | "BENEFICIARY";
}

export interface RetirementGoals {
  retirementAge: number;
  annualSpending: Money;
  spendingBasis: "TODAYS_DOLLARS" | "FUTURE_DOLLARS";
  essentialSpending?: Money;
  planningAge: number;
  survivorSpendingRate?: number;
  minimumEstate?: Money;
}

export interface ScenarioAssumptions {
  inflationRate: number;
  investmentReturn: number;
  /** Optional: different return during working years (before retirement). Falls back to investmentReturn. */
  workingInvestmentReturn?: number;
  investmentFeeRate: number;
  incomeYield?: number;
  capitalGrowthRate?: number;
  /** Year-specific return overrides: calendar year -> annual return %. Used for sequence-of-returns stress tests. */
  annualReturnOverrides?: Record<number, number>;
  futureRulesMode: "CURRENT_LAW" | "CURRENT_LAW_PLUS_INDEXING" | "CONSERVATIVE" | "CUSTOM";
}

export interface StrategyPreferences {
  withdrawalPolicy: "OPTIMIZE" | "USER_DEFINED" | "TAX_TARGETED" | "REGISTERED_FIRST" | "TFSA_FIRST" | "NON_REGISTERED_FIRST";
  objective: "MAX_SUSTAINABLE_SPENDING" | "MAX_LIFETIME_AFTER_TAX_CASH" | "MAX_ESTATE" | "MIN_DEPLETION_RISK" | "MIN_TAX" | "MIN_RETIREMENT_AGE" | "CUSTOM";
  taxableIncomeTarget?: Money;
  pensionSplitPercent?: number;
  /** Allowed overshoot above the OAS clawback threshold when melting down registered accounts (today's dollars). */
  clawbackTolerance?: Money;
  cashReserve?: Money;
  estateTarget?: Money;
}

export interface RetirementScenario {
  id: string;
  name: string;
  household: { province: ProvinceCode; people: PersonScenario[]; stage: HouseholdStage };
  goals: RetirementGoals;
  accounts: AccountScenario[];
  debts?: DebtScenario[];
  dbPensions?: DbPension[];
  assumptions: ScenarioAssumptions;
  strategy: StrategyPreferences;
  /** Quick mode: simplified withdrawal (no tax optimization), for fast estimates. */
  quick?: boolean;
  metadata: { createdAt: string; engineVersion: string; rulesVersion: string; scenarioHash?: string };
}

export interface MonthlyCashFlowSnapshot {
  beginningPortfolio: Money;
  beginningHouseholdCash: Money;
  investmentGrowth: Money;
  contributions: Money;
  grossIncome: Money;
  grossWithdrawals: Money;
  taxes: Money;
  spending: Money;
  debtPayments: Money;
  endingPortfolio: Money;
  endingHouseholdCash: Money;
  assetReconciliation: Money;
  cashReconciliation: Money;
  externalCashChange?: Money;
  debtReconciliation?: Money;
  netWorthReconciliation?: Money;
}

export interface MonthlySnapshot {
  date: string;
  ages: Partial<Record<PersonRole, number>>;
  householdStage: HouseholdStage;
  portfolio: Money;
  registered: Money;
  lira: Money;
  tfsa: Money;
  nonRegistered: Money;
  cash: Money;
  householdCash: Money;
  debt: Money;
  netWorth: Money;
  grossIncome: Money;
  benefits: Money;
  benefitSources?: {
    cpp: Money;
    oas: Money;
    oasClawback?: Money;
    gis: Money;
    allowance: Money;
  };
  benefitsByPerson?: Record<PersonRole, { cpp: Money; oas: Money; gis: Money }>;
  withdrawals: Money;
  withdrawalSources?: {
    registered: Money;
    lira: Money;
    tfsa: Money;
    nonRegistered: Money;
    cash: Money;
  };
  withdrawalsByPerson?: Record<PersonRole, { registered: Money; lira: Money; tfsa: Money; nonRegistered: Money }>;
  taxes: Money;
  /** OAS recovery tax portion of taxes (for reporting). */
  oasRecovery?: Money;
  spending: Money;
  debtPayments?: Money;
  debtInterest?: Money;
  debtPrincipal?: Money;
  shortfall: Money;
  cashFlow?: MonthlyCashFlowSnapshot;
}

export interface SimulationMetrics {
  feasible: boolean;
  depletionDate?: string;
  lifetimeSpending: Money;
  lifetimeAfterTaxCash: Money;
  lifetimeTax: Money;
  totalBenefits: Money;
  endingPortfolio: Money;
  endingNetWorth: Money;
  minimumPortfolio: Money;
  maximumSpendingShortfall: Money;
  totalDebtInterest?: Money;
  totalDebtPayments?: Money;
  endingDebt?: Money;
  survivorShortfall?: Money;
  estateValue?: Money;
  estateTax?: Money;
  deathCapitalGains?: Money;
  survivorTransferredAssets?: Money;
}

export interface SimulationResult {
  simulationId: string;
  scenarioId: string;
  status: "COMPLETE" | "INCOMPLETE" | "FAILED" | "INVALID";
  startDate: string;
  endDate: string;
  monthly: MonthlySnapshot[];
  metrics: SimulationMetrics;
  warnings: string[];
  assumptions: { path: string; value: unknown; source: "USER" | "SYSTEM_DEFAULT" | "GOVERNMENT_RULE" | "DERIVED" | "PROJECTED" }[];
  engineVersion: string;
  rulesVersion: string;
  scenarioHash: string;
}

export interface OptimizationCandidate {
  scenario: RetirementScenario;
  metrics: SimulationMetrics;
  objectiveValue: number;
  violations: string[];
}

export interface OptimizationResult {
  candidates: OptimizationCandidate[];
  feasiblePlans: RetirementScenario[];
  paretoFrontier: RetirementScenario[];
  paretoCandidates: OptimizationCandidate[];
  selectedPlan?: RetirementScenario;
  selectedCandidate?: OptimizationCandidate;
  objective: StrategyPreferences["objective"];
  constraints: { name: string; satisfied: boolean; value?: number; limit?: number }[];
}
