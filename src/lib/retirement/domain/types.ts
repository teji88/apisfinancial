export type Money = number;
export type PersonRole = "MAIN_USER" | "PARTNER";
export type HouseholdStage = "BOTH_ALIVE" | "SURVIVOR" | "ESTATE";
export type AccountType = "RRSP" | "RRIF" | "TFSA" | "LIRA" | "LIF" | "NON_REGISTERED" | "CASH" | "PENSION" | "ANNUITY";
export type PortfolioLinkMode = "SNAPSHOT" | "LIVE_CURRENT" | "MANUAL";
export type ProvinceCode = "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";
export type Confidence = "USER_PROVIDED" | "USER_ESTIMATED" | "SYSTEM_DEFAULT" | "RULE_DERIVED";

export interface PersonScenario {
  role: PersonRole;
  birthYear: number;
  birthMonth: number;
  retirementAge: number;
  cppAt65?: Money;
  cppStartAge: number | "OPTIMIZE";
  oasStartAge: number | "OPTIMIZE";
  oasResidenceYears: number;
  otherIncome?: Money;
  /** Optional planning assumption; no identifying information. */
  deathAge?: number;
  /** Survivor CPP assumption as a percentage of the deceased person's CPP benefit. */
  survivorCppPercent?: number;
}

export interface AccountScenario {
  id: string;
  owner: PersonRole;
  type: AccountType;
  valuation: { mode: PortfolioLinkMode; value?: Money; snapshotDate?: string; linkedValue?: Money };
  contribution?: { annualAmount: Money; untilAge?: number };
  protected?: boolean;\n  nonRegisteredAcb?: Money;\n  deathTransfer?: "SPOUSE" | "ESTATE" | "BENEFICIARY";
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
  investmentFeeRate: number;
  incomeYield?: number;
  capitalGrowthRate?: number;
  futureRulesMode: "CURRENT_LAW" | "CURRENT_LAW_PLUS_INDEXING" | "CONSERVATIVE" | "CUSTOM";
}

export interface StrategyPreferences {
  withdrawalPolicy: "OPTIMIZE" | "USER_DEFINED" | "TAX_TARGETED" | "REGISTERED_FIRST" | "TFSA_FIRST" | "NON_REGISTERED_FIRST";
  objective: "MAX_SUSTAINABLE_SPENDING" | "MAX_LIFETIME_AFTER_TAX_CASH" | "MAX_ESTATE" | "MIN_DEPLETION_RISK" | "MIN_TAX" | "CUSTOM";
  taxableIncomeTarget?: Money;
  cashReserve?: Money;
  estateTarget?: Money;
}

export interface RetirementScenario {
  id: string;
  name: string;
  household: { province: ProvinceCode; people: PersonScenario[]; stage: HouseholdStage };
  goals: RetirementGoals;
  accounts: AccountScenario[];
  assumptions: ScenarioAssumptions;
  strategy: StrategyPreferences;
  metadata: { createdAt: string; engineVersion: string; rulesVersion: string; scenarioHash?: string };
}

export interface MonthlySnapshot {
  date: string;
  ages: Partial<Record<PersonRole, number>>;
  householdStage: HouseholdStage;
  portfolio: Money;
  registered: Money;
  tfsa: Money;
  nonRegistered: Money;
  cash: Money;
  debt: Money;
  netWorth: Money;
  grossIncome: Money;
  benefits: Money;
  withdrawals: Money;
  taxes: Money;
  spending: Money;
  shortfall: Money;
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
  survivorShortfall?: Money;
  estateValue?: Money;
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

export interface OptimizationResult {
  feasiblePlans: RetirementScenario[];
  paretoFrontier: RetirementScenario[];
  selectedPlan?: RetirementScenario;
  objective: StrategyPreferences["objective"];
  constraints: { name: string; satisfied: boolean; value?: number; limit?: number }[];
}
