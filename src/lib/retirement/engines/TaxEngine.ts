import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { ProvinceCode } from "../domain/types";

type TaxBracket = readonly [number, number, number];

export interface TaxResult {
  taxableIncome: number;
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  effectiveRate: number;
  oasRecovery: number;
  marginalRate: number;
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
  if (province === "QC") {
    // Quebec has a separate provincial return and ruleset. Until the Quebec
    // engine is added, do not silently pretend that another province's rules apply.
    return [];
  }

  return (CANADA_2026_PARAMETERS.tax.provincialBrackets[province] ?? []) as readonly TaxBracket[];
}

function provincialBasicPersonalAmount(province: ProvinceCode): number {
  // Only amounts currently maintained in the rules dataset are applied.
  // Missing provincial credit data must not be invented.
  if (province === "AB") return CANADA_2026_PARAMETERS.tax.albertaBasicPersonalAmount;
  return 0;
}

function federalBasicCredit(age: number): number {
  // The full 2026 BPA is appropriate for the common retirement-planning case
  // modelled here. Advanced income-tested BPA/age-credit phase-outs are tracked
  // separately as future rule work rather than silently approximated.
  return CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount * 0.14;
}

function provincialBasicCredit(province: ProvinceCode): number {
  const rate = marginalBracketRate(0, bracketsForProvince(province));
  return provincialBasicPersonalAmount(province) * rate;
}

function oasRecoveryForIncome(income: number, age: number): number {
  const threshold = CANADA_2026_PARAMETERS.oasRecovery.startIncome;
  const upper = age >= 75
    ? CANADA_2026_PARAMETERS.oasRecovery.upperIncome75Plus
    : CANADA_2026_PARAMETERS.oasRecovery.upperIncomeUnder75;

  // OAS recovery tax is 15% of income above the threshold, capped by the OAS
  // amount that can actually be recovered. The current rules dataset does not
  // yet carry a person-specific annual OAS entitlement, so use the published
  // threshold/upper-income range to derive the cap.
  return Math.max(0, Math.min(
    Math.max(0, income - threshold) * 0.15,
    Math.max(0, upper - threshold) * 0.15,
  ));
}

export function calculateBasicTax(
  taxableIncome: number,
  province: ProvinceCode = "AB",
  age = 65,
): TaxResult {
  const income = Math.max(0, taxableIncome);
  const federalBrackets = CANADA_2026_PARAMETERS.tax.federalBrackets as readonly TaxBracket[];
  const provincialBrackets = bracketsForProvince(province);

  const federalGross = taxFromBrackets(income, federalBrackets);
  const provincialGross = taxFromBrackets(income, provincialBrackets);

  const federalTax = Math.max(0, federalGross - federalBasicCredit(age));
  const provincialTax = Math.max(0, provincialGross - provincialBasicCredit(province));
  const oasRecovery = oasRecoveryForIncome(income, age);
  const totalTax = federalTax + provincialTax + oasRecovery;

  const federalMarginal = marginalBracketRate(income, federalBrackets);
  const provincialMarginal = marginalBracketRate(income, provincialBrackets);
  const recoveryMarginal = income >= CANADA_2026_PARAMETERS.oasRecovery.startIncome
    ? 0.15
    : 0;

  return {
    taxableIncome: income,
    federalTax,
    provincialTax,
    totalTax,
    effectiveRate: income > 0 ? totalTax / income : 0,
    oasRecovery,
    marginalRate: federalMarginal + provincialMarginal + recoveryMarginal,
  };
}

export function calculateIncrementalTax(
  currentIncome: number,
  additionalIncome: number,
  province: ProvinceCode,
  age: number,
) {
  const before = calculateBasicTax(currentIncome, province, age).totalTax;
  const after = calculateBasicTax(
    Math.max(0, currentIncome) + Math.max(0, additionalIncome),
    province,
    age,
  ).totalTax;

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

  const incrementalTax = calculateIncrementalTax(
    currentTaxableIncome,
    gross,
    province,
    age,
  );

  return {
    incrementalTax,
    effectiveCostRate: incrementalTax / gross,
  };
}
