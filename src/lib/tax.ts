/**
 * MapleWealth Canadian tax engine — 2026 estimated federal + provincial brackets.
 * Figures are projections and should be treated as planning estimates.
 */

export type Bracket = { upTo: number; rate: number };

export const FEDERAL_BRACKETS: Bracket[] = [
  { upTo: 58_375, rate: 0.14 },
  { upTo: 116_750, rate: 0.205 },
  { upTo: 180_940, rate: 0.26 },
  { upTo: 258_010, rate: 0.29 },
  { upTo: Infinity, rate: 0.33 },
];

export const FEDERAL_BPA = 16_500;
export const LOWEST_FED_RATE = 0.14;

/** Age amount (65+) and pension income amount, federal — 2026 values. */
export const FED_AGE_CLAWBACK_START = 44_325;
/** Net income at which the age amount is fully clawed back. */
export const FED_AGE_CLAWBACK_END = 86_912;
export const FED_AGE_AMOUNT = (FED_AGE_CLAWBACK_END - FED_AGE_CLAWBACK_START) * 0.15;
export const FED_PENSION_AMOUNT = 2_000;

export type ProvinceCode =
  | "AB"
  | "BC"
  | "ON"
  | "QC"
  | "MB"
  | "SK"
  | "NS"
  | "NB"
  | "NL"
  | "PE";

type ProvinceDef = {
  name: string;
  brackets: Bracket[];
  bpa: number;
  lowestRate: number;
  /** Ontario-style surtax on basic provincial tax. */
  surtax?: { threshold1: number; rate1: number; threshold2: number; rate2: number };
  /** Quebec residents get a federal abatement. */
  federalAbatement?: number;
};

export const PROVINCES: Record<ProvinceCode, ProvinceDef> = {
  AB: {
    name: "Alberta",
    bpa: 22_323,
    lowestRate: 0.08,
    brackets: [
      { upTo: 60_000, rate: 0.08 },
      { upTo: 151_234, rate: 0.1 },
      { upTo: 181_481, rate: 0.12 },
      { upTo: 241_974, rate: 0.13 },
      { upTo: 362_961, rate: 0.14 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },
  BC: {
    name: "British Columbia",
    bpa: 12_932,
    lowestRate: 0.0506,
    brackets: [
      { upTo: 50_400, rate: 0.0506 },
      { upTo: 100_800, rate: 0.077 },
      { upTo: 115_700, rate: 0.105 },
      { upTo: 140_400, rate: 0.1229 },
      { upTo: 190_500, rate: 0.147 },
      { upTo: 265_600, rate: 0.168 },
      { upTo: Infinity, rate: 0.205 },
    ],
  },
  ON: {
    name: "Ontario",
    bpa: 12_899,
    lowestRate: 0.0505,
    brackets: [
      { upTo: 53_430, rate: 0.0505 },
      { upTo: 106_860, rate: 0.0915 },
      { upTo: 150_000, rate: 0.1116 },
      { upTo: 220_000, rate: 0.1216 },
      { upTo: Infinity, rate: 0.1316 },
    ],
    surtax: { threshold1: 5_852, rate1: 0.2, threshold2: 7_490, rate2: 0.36 },
  },
  QC: {
    name: "Quebec",
    bpa: 18_800,
    lowestRate: 0.14,
    brackets: [
      { upTo: 54_000, rate: 0.14 },
      { upTo: 108_000, rate: 0.19 },
      { upTo: 131_500, rate: 0.24 },
      { upTo: Infinity, rate: 0.2575 },
    ],
    federalAbatement: 0.165,
  },
  MB: {
    name: "Manitoba",
    bpa: 15_969,
    lowestRate: 0.108,
    brackets: [
      { upTo: 47_800, rate: 0.108 },
      { upTo: 101_200, rate: 0.1275 },
      { upTo: Infinity, rate: 0.174 },
    ],
  },
  SK: {
    name: "Saskatchewan",
    bpa: 19_491,
    lowestRate: 0.105,
    brackets: [
      { upTo: 55_000, rate: 0.105 },
      { upTo: 157_200, rate: 0.125 },
      { upTo: Infinity, rate: 0.145 },
    ],
  },
  NS: {
    name: "Nova Scotia",
    bpa: 11_744,
    lowestRate: 0.0879,
    brackets: [
      { upTo: 31_000, rate: 0.0879 },
      { upTo: 62_000, rate: 0.1495 },
      { upTo: 96_000, rate: 0.1667 },
      { upTo: 154_650, rate: 0.175 },
      { upTo: Infinity, rate: 0.21 },
    ],
  },
  NB: {
    name: "New Brunswick",
    bpa: 13_396,
    lowestRate: 0.094,
    brackets: [
      { upTo: 51_306, rate: 0.094 },
      { upTo: 102_614, rate: 0.14 },
      { upTo: 190_060, rate: 0.16 },
      { upTo: Infinity, rate: 0.195 },
    ],
  },
  NL: {
    name: "Newfoundland & Labrador",
    bpa: 11_067,
    lowestRate: 0.087,
    brackets: [
      { upTo: 45_000, rate: 0.087 },
      { upTo: 90_000, rate: 0.145 },
      { upTo: 160_500, rate: 0.158 },
      { upTo: 224_700, rate: 0.178 },
      { upTo: 449_400, rate: 0.198 },
      { upTo: 1_128_000, rate: 0.208 },
      { upTo: Infinity, rate: 0.218 },
    ],
  },
  PE: {
    name: "Prince Edward Island",
    bpa: 15_000,
    lowestRate: 0.095,
    brackets: [
      { upTo: 33_328, rate: 0.095 },
      { upTo: 64_656, rate: 0.1347 },
      { upTo: 105_000, rate: 0.166 },
      { upTo: 140_000, rate: 0.1762 },
      { upTo: Infinity, rate: 0.19 },
    ],
  },
};

export const PROVINCE_CODES = Object.keys(PROVINCES) as ProvinceCode[];

export function bracketTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let last = 0;
  for (const b of brackets) {
    if (income <= last) break;
    const slice = Math.min(income, b.upTo) - last;
    tax += slice * b.rate;
    last = b.upTo;
  }
  return tax;
}

/** Top of the bracket the income currently sits in (federal). */
export function nextFederalBracketTop(income: number): number {
  for (const b of FEDERAL_BRACKETS) if (income < b.upTo) return b.upTo;
  return Infinity;
}

export type TaxInput = {
  /** Ordinary taxable income: RRIF/LIF withdrawals, CPP, OAS, pensions, interest. */
  ordinary: number;
  /** Realized capital gains (gross — inclusion rate applied here). */
  capitalGains?: number;
  /** Eligible Canadian dividends (actual amount received). */
  eligibleDividends?: number;
  province: ProvinceCode;
  age: number;
  /** Portion of ordinary income that qualifies for the pension income credit. */
  pensionIncome?: number;
};

export const CAPITAL_GAINS_INCLUSION = 0.5;
const DIVIDEND_GROSS_UP = 1.38;
const FED_DTC = 0.150198;
const PROV_DTC = 0.1;

export type TaxResult = {
  taxableIncome: number;
  netIncome: number;
  federal: number;
  provincial: number;
  total: number;
  averageRate: number;
};

export function computeTax(input: TaxInput): TaxResult {
  const prov = PROVINCES[input.province];
  const gains = (input.capitalGains ?? 0) * CAPITAL_GAINS_INCLUSION;
  const dividends = input.eligibleDividends ?? 0;
  const grossedDividends = dividends * DIVIDEND_GROSS_UP;
  const taxable = Math.max(0, input.ordinary + gains + grossedDividends);
  // Net income used for OAS clawback / age amount (before the taxable-income deductions).
  const netIncome = taxable;

  // Federal
  let fed = bracketTax(taxable, FEDERAL_BRACKETS);
  let fedCredits = FEDERAL_BPA;
  if (input.age >= 65) {
    const reduction = Math.max(0, (netIncome - FED_AGE_CLAWBACK_START) * 0.15);
    fedCredits += Math.max(0, FED_AGE_AMOUNT - reduction);
  }
  if ((input.pensionIncome ?? 0) > 0) {
    fedCredits += Math.min(FED_PENSION_AMOUNT, input.pensionIncome ?? 0);
  }
  fed -= fedCredits * LOWEST_FED_RATE;
  fed -= grossedDividends * FED_DTC;
  fed = Math.max(0, fed);
  if (prov.federalAbatement) fed *= 1 - prov.federalAbatement;

  // Provincial
  let provTax = bracketTax(taxable, prov.brackets);
  let provCredits = prov.bpa;
  if (input.age >= 65) provCredits += 5_500;
  if ((input.pensionIncome ?? 0) > 0) provCredits += Math.min(1_500, input.pensionIncome ?? 0);
  provTax -= provCredits * prov.lowestRate;
  provTax -= grossedDividends * PROV_DTC;
  provTax = Math.max(0, provTax);
  if (prov.surtax) {
    const s = prov.surtax;
    provTax +=
      Math.max(0, provTax - s.threshold1) * s.rate1 +
      Math.max(0, provTax - s.threshold2) * s.rate2;
  }

  const total = fed + provTax;
  return {
    taxableIncome: taxable,
    netIncome,
    federal: fed,
    provincial: provTax,
    total,
    averageRate: taxable > 0 ? total / taxable : 0,
  };
}
