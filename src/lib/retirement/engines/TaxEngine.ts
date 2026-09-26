import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { ProvinceCode } from "../domain/types";

export interface TaxResult {
  taxableIncome: number;
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  effectiveRate: number;
  oasRecovery: number;
  marginalRate: number;
}

function taxFromBrackets(income: number, brackets: readonly (readonly [number, number, number])[]) {
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (income > low) tax += (Math.min(income, high) - low) * rate;
    if (income <= high) break;
  }
  return Math.max(0, tax);
}

function bracketsForProvince(province: ProvinceCode) {
  return province === "AB" ? CANADA_2026_PARAMETERS.tax.albertaBrackets : [];
}

export function calculateBasicTax(taxableIncome: number, province: ProvinceCode = "AB", age = 65): TaxResult {
  const federalGross = taxFromBrackets(taxableIncome, CANADA_2026_PARAMETERS.tax.federalBrackets);
  const provincialGross = taxFromBrackets(taxableIncome, bracketsForProvince(province));
  const federalCredit = CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount * 0.14;
  const provincialCredit = province === "AB" ? CANADA_2026_PARAMETERS.tax.albertaBasicPersonalAmount * 0.08 : 0;
  const federalTax = Math.max(0, federalGross - federalCredit);
  const provincialTax = Math.max(0, provincialGross - provincialCredit);
  const grossTax = federalTax + provincialTax;
  const recoveryStart = CANADA_2026_PARAMETERS.oasRecovery.startIncome;
  const recoveryUpper = age >= 75 ? CANADA_2026_PARAMETERS.oasRecovery.upperIncome75Plus : CANADA_2026_PARAMETERS.oasRecovery.upperIncomeUnder75;
  const oasRecovery = taxableIncome > recoveryStart
    ? Math.min(grossTax * 0 + Math.max(0, taxableIncome - recoveryStart) * 0.15, 999999)
    : 0;
  const totalTax = grossTax + oasRecovery;
  const marginalRate = taxableIncome <= 0 ? 0 : (
    (taxableIncome >= recoveryStart ? 0.14 + (province === "AB" ? 0.08 : 0) : 0)
    + (taxableIncome > recoveryStart && taxableIncome < recoveryUpper ? 0.15 : 0)
  );
  return { taxableIncome, federalTax, provincialTax, totalTax, effectiveRate: taxableIncome ? totalTax / taxableIncome : 0, oasRecovery, marginalRate };
}

export function calculateIncrementalTax(currentIncome: number, additionalIncome: number, province: ProvinceCode, age: number) {
  const before = calculateBasicTax(currentIncome, province, age).totalTax;
  const after = calculateBasicTax(currentIncome + additionalIncome, province, age).totalTax;
  return Math.max(0, after - before);
}
