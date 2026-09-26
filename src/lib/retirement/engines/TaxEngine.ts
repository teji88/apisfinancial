import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { ProvinceCode } from "../domain/types";

type TaxBracket = readonly [number, number, number];

export interface TaxIncomeComponents {
  employment?: number;
  cpp?: number;
  oas?: number;
  rrspRrif?: number;
  pension?: number;
  interest?: number;
  eligibleCanadianDividends?: number;
  nonEligibleCanadianDividends?: number;
  canadianDividends?: number;
  foreignIncome?: number;
  foreignTaxPaid?: number;
  capitalGains?: number;
  deductions?: number;
  /** Eligible pension income received by this person. */
  eligiblePensionIncome?: number;
  /** Requested percentage of eligible pension income to split to spouse (0-50). */
  pensionSplitPercent?: number;
  /** Age at year end, used for pension-income eligibility. */
  age?: number;
}

export interface TaxResult {
  totalIncome: number;
  netIncome: number;
  taxableIncome: number;
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  effectiveRate: number;
  oasRecovery: number;
  marginalRate: number;
  credits: number;
  dividendTaxCredit: number;
  foreignTaxCredit: number;
}

function taxFromBrackets(income: number, brackets: readonly TaxBracket[]) {
  const taxable = Math.max(0, income);
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (taxable <= low) continue;
    tax += (Math.min(taxable, high) - low) * rate;
    if (taxable <= high) break;
  }
  return Math.max(0, tax);
}

function marginalBracketRate(income: number, brackets: readonly TaxBracket[]) {
  const taxable = Math.max(0, income);
  for (const [low, high, rate] of brackets) {
    if (taxable >= low && taxable <= high) return rate;
  }
  return brackets.at(-1)?.[2] ?? 0;
}

function bracketsForProvince(province: ProvinceCode): readonly TaxBracket[] {
  if (province === "QC") return [];
  return (CANADA_2026_PARAMETERS.tax.provincialBrackets[province] ?? []) as readonly TaxBracket[];
}

function provincialBasicPersonalAmount(province: ProvinceCode): number {
  if (province === "AB") return CANADA_2026_PARAMETERS.tax.albertaBasicPersonalAmount;
  return 0;
}

function federalBasicCredit(): number {
  return CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount * 0.14;
}

function provincialBasicCredit(province: ProvinceCode): number {
  const rate = marginalBracketRate(0, bracketsForProvince(province));
  return provincialBasicPersonalAmount(province) * rate;
}

function normalizeIncome(components: TaxIncomeComponents): Required<TaxIncomeComponents> {
  const capitalGains = Math.max(0, components.capitalGains ?? 0);
  return {
    employment: Math.max(0, components.employment ?? 0),
    cpp: Math.max(0, components.cpp ?? 0),
    oas: Math.max(0, components.oas ?? 0),
    rrspRrif: Math.max(0, components.rrspRrif ?? 0),
    pension: Math.max(0, components.pension ?? 0),
    interest: Math.max(0, components.interest ?? 0),
    eligibleCanadianDividends: Math.max(0, components.eligibleCanadianDividends ?? 0),
    nonEligibleCanadianDividends: Math.max(0, components.nonEligibleCanadianDividends ?? 0),
    canadianDividends: Math.max(0, components.canadianDividends ?? 0),
    foreignIncome: Math.max(0, components.foreignIncome ?? 0),
    foreignTaxPaid: Math.max(0, components.foreignTaxPaid ?? 0),
    capitalGains,
    deductions: Math.max(0, components.deductions ?? 0),
    eligiblePensionIncome: Math.max(0, components.eligiblePensionIncome ?? 0),
    pensionSplitPercent: Math.min(50, Math.max(0, components.pensionSplitPercent ?? 0)),
    age: Math.max(0, components.age ?? 65),
  };
}

/**
 * Builds the retirement tax ledgers without pretending all income types have
 * identical tax treatment. This is the V1 foundation for the eventual CRA
 * return model: total income -> net income -> taxable income.
 *
 * Capital gains are currently represented at the 50% inclusion rate. Dividend
 * gross-up/credit and detailed foreign-tax-credit treatment remain explicit
 * future work rather than hidden approximations.
 */
export function buildTaxIncome(components: TaxIncomeComponents) {
  const income = normalizeIncome(components);
  const ordinaryIncome =
    income.employment +
    income.cpp +
    income.oas +
    income.rrspRrif +
    income.pension +
    income.interest +
    income.foreignIncome;

  const pensionSplitEligible = income.age >= 65 ? income.eligiblePensionIncome : 0;
  const pensionSplit = Math.min(pensionSplitEligible * 0.5, pensionSplitEligible * income.pensionSplitPercent / 100);
  const eligibleDividends = income.eligibleCanadianDividends;
  const nonEligibleDividends = income.nonEligibleCanadianDividends + income.canadianDividends;
  const taxableCanadianDividends =
    eligibleDividends * (1 + CANADA_2026_PARAMETERS.tax.eligibleDividendGrossUp) +
    nonEligibleDividends * (1 + CANADA_2026_PARAMETERS.tax.nonEligibleDividendGrossUp);
  const totalIncome = ordinaryIncome + taxableCanadianDividends + income.capitalGains;
  const capitalGainInclusion = income.capitalGains * 0.5;
  const netIncomeBeforeDeductions = Math.max(0, ordinaryIncome + taxableCanadianDividends + capitalGainInclusion - pensionSplit);
  const netIncome = Math.max(0, netIncomeBeforeDeductions - income.deductions);
  const taxableIncome = netIncome;

  return {
    ...income,
    ordinaryIncome,
    eligibleDividendGrossUp: eligibleDividends * CANADA_2026_PARAMETERS.tax.eligibleDividendGrossUp,
    nonEligibleDividendGrossUp: nonEligibleDividends * CANADA_2026_PARAMETERS.tax.nonEligibleDividendGrossUp,
    taxableCanadianDividends,
    capitalGainInclusion,
    totalIncome,
    netIncome,
    taxableIncome,
    pensionSplit,
    pensionIncomeCreditBase: Math.min(2_000, income.eligiblePensionIncome - pensionSplit),
  };
}

function oasRecoveryForIncome(income: number, age: number): number {
  const threshold = CANADA_2026_PARAMETERS.oasRecovery.startIncome;
  const upper = age >= 75
    ? CANADA_2026_PARAMETERS.oasRecovery.upperIncome75Plus
    : CANADA_2026_PARAMETERS.oasRecovery.upperIncomeUnder75;
  return Math.max(0, Math.min(
    Math.max(0, income - threshold) * 0.15,
    Math.max(0, upper - threshold) * 0.15,
  ));
}

export function calculateTaxFromIncome(
  components: TaxIncomeComponents,
  province: ProvinceCode = "AB",
  age = 65,
): TaxResult {
  const ledgers = buildTaxIncome(components);
  const federalBrackets = CANADA_2026_PARAMETERS.tax.federalBrackets as readonly TaxBracket[];
  const provincialBrackets = bracketsForProvince(province);
  const federalGross = taxFromBrackets(ledgers.taxableIncome, federalBrackets);
  const provincialGross = taxFromBrackets(ledgers.taxableIncome, provincialBrackets);
  const federalDividendCredit =
    ledgers.eligibleDividendGrossUp * CANADA_2026_PARAMETERS.tax.eligibleDividendFederalCreditRate +
    ledgers.nonEligibleDividendGrossUp * CANADA_2026_PARAMETERS.tax.nonEligibleDividendFederalCreditRate;
  const credits = federalBasicCredit() + provincialBasicCredit(province) + federalDividendCredit;
  const federalTax = Math.max(0, federalGross - federalBasicCredit() - federalDividendCredit);
  const provincialTax = Math.max(0, provincialGross - provincialBasicCredit(province));
  const oasRecovery = oasRecoveryForIncome(ledgers.netIncome, age);
  const foreignIncome = Math.max(0, ledgers.foreignIncome);
  const foreignTaxCredit = foreignIncome > 0
    ? Math.min(ledgers.foreignTaxPaid, Math.max(0, (federalTax + provincialTax) * foreignIncome / Math.max(1, ledgers.taxableIncome)))
    : 0;
  const totalTax = Math.max(0, federalTax + provincialTax + oasRecovery - foreignTaxCredit);
  const federalMarginal = marginalBracketRate(ledgers.taxableIncome, federalBrackets);
  const provincialMarginal = marginalBracketRate(ledgers.taxableIncome, provincialBrackets);
  const recoveryMarginal = ledgers.netIncome >= CANADA_2026_PARAMETERS.oasRecovery.startIncome ? 0.15 : 0;

  return {
    totalIncome: ledgers.totalIncome,
    netIncome: ledgers.netIncome,
    taxableIncome: ledgers.taxableIncome,
    federalTax,
    provincialTax,
    totalTax,
    effectiveRate: ledgers.netIncome > 0 ? totalTax / ledgers.netIncome : 0,
    oasRecovery,
    marginalRate: federalMarginal + provincialMarginal + recoveryMarginal,
    credits,
    dividendTaxCredit: federalDividendCredit,
    foreignTaxCredit,
  };
}

export function calculateBasicTax(taxableIncome: number, province: ProvinceCode = "AB", age = 65): TaxResult {
  return calculateTaxFromIncome({ rrspRrif: taxableIncome }, province, age);
}

export function calculateIncrementalTax(
  currentIncome: number,
  additionalIncome: number,
  province: ProvinceCode,
  age: number,
) {
  const before = calculateTaxFromIncome({ rrspRrif: currentIncome }, province, age).totalTax;
  const after = calculateTaxFromIncome({ rrspRrif: Math.max(0, currentIncome) + Math.max(0, additionalIncome) }, province, age).totalTax;
  return Math.max(0, after - before);
}

export function calculateIncrementalWithdrawalCost(
  currentTaxableIncome: number,
  grossWithdrawal: number,
  province: ProvinceCode,
  age: number,
) {
  const gross = Math.max(0, grossWithdrawal);
  if (gross === 0) return { incrementalTax: 0, effectiveCostRate: 0 };
  const incrementalTax = calculateIncrementalTax(currentTaxableIncome, gross, province, age);
  return { incrementalTax, effectiveCostRate: incrementalTax / gross };
}

export interface HouseholdTaxInput {
  payer: TaxIncomeComponents;
  spouse?: TaxIncomeComponents;
  province?: ProvinceCode;
  payerAge?: number;
  spouseAge?: number;
  pensionSplitPercent?: number;
}

export interface HouseholdTaxResult {
  payer: TaxResult;
  spouse: TaxResult;
  householdTotalIncome: number;
  householdNetIncome: number;
  householdTax: number;
  pensionSplit: number;
}

/**
 * Applies a pension-splitting election between two individual tax returns.
 * The transfer is limited to 50% of eligible pension income and is neutral
 * to household gross income while changing the individual tax allocation.
 */
export function calculateHouseholdTax(input: HouseholdTaxInput): HouseholdTaxResult {
  const payer = normalizeIncome(input.payer);
  const spouse = normalizeIncome(input.spouse ?? {});
  const requestedPercent = Math.min(50, Math.max(0, input.pensionSplitPercent ?? 0));
  const payerAge = input.payerAge ?? payer.age;
  const spouseAge = input.spouseAge ?? spouse.age;
  const eligible = payerAge >= 65 ? payer.eligiblePensionIncome : 0;
  const pensionSplit = Math.min(eligible * 0.5, eligible * requestedPercent / 100);

  const payerComponents: TaxIncomeComponents = {
    ...input.payer,
    pension: Math.max(0, (input.payer.pension ?? 0) - pensionSplit),
    eligiblePensionIncome: Math.max(0, (input.payer.eligiblePensionIncome ?? 0) - pensionSplit),
    age: payerAge,
    pensionSplitPercent: 0,
  };
  const spouseComponents: TaxIncomeComponents = {
    ...input.spouse,
    pension: Math.max(0, (input.spouse?.pension ?? 0) + pensionSplit),
    eligiblePensionIncome: Math.max(0, (input.spouse?.eligiblePensionIncome ?? 0) + pensionSplit),
    age: spouseAge,
    pensionSplitPercent: 0,
  };

  const payerTax = calculateTaxFromIncome(payerComponents, input.province ?? "AB", payerAge);
  const spouseTax = calculateTaxFromIncome(spouseComponents, input.province ?? "AB", spouseAge);

  return {
    payer: payerTax,
    spouse: spouseTax,
    householdTotalIncome: payerTax.totalIncome + spouseTax.totalIncome,
    householdNetIncome: payerTax.netIncome + spouseTax.netIncome,
    householdTax: payerTax.totalTax + spouseTax.totalTax,
    pensionSplit,
  };
}
