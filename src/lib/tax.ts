/**
 * Apis Financial Canadian tax engine — 2026 estimated federal + provincial brackets.
 * Figures are projections and should be treated as planning estimates.
 */

export type Bracket = { upTo: number; rate: number };

export const FEDERAL_BRACKETS: Bracket[] = [
  { upTo: 58_523, rate: 0.14 },
  { upTo: 117_045, rate: 0.205 },
  { upTo: 181_440, rate: 0.26 },
  { upTo: 258_482, rate: 0.29 },
  { upTo: Infinity, rate: 0.33 },
];

export const FEDERAL_BPA = 16_452;
export const FEDERAL_BPA_MIN = 14_829;
export const FEDERAL_BPA_PHASEOUT_START = 181_440;
export const FEDERAL_BPA_PHASEOUT_END = 258_482;
export const LOWEST_FED_RATE = 0.14;

/** Federal age amount (65+) claim values, using 2026 CRA indexation. */
export const FED_AGE_CLAWBACK_START = 46_432;
/** Net income at which the age amount is fully clawed back. */
export const FED_AGE_CLAWBACK_END = 107_819;
export const FED_AGE_AMOUNT = 9_208;
export const FED_PENSION_AMOUNT = 2_000;

export type ProvinceCode = "AB" | "BC" | "ON" | "QC" | "MB" | "SK" | "NS" | "NB" | "NL" | "PE";

type ProvinceDef = {
  name: string;
  brackets: Bracket[];
  bpa: number;
  lowestRate: number;
  /** Estimated 2026 age amount maximum and start of its 15% income phaseout. */
  ageAmount?: { maximum: number; phaseoutStart: number };
  /** Income-based basic-personal-amount phaseout (Manitoba). */
  bpaPhaseout?: { start: number; end: number };
  /** Ontario-style surtax on basic provincial tax. */
  surtax?: { threshold1: number; rate1: number; threshold2: number; rate2: number };
  /** Quebec residents get a federal abatement. */
  federalAbatement?: number;
};

export const PROVINCES: Record<ProvinceCode, ProvinceDef> = {
  AB: {
    name: "Alberta",
    bpa: 22_769,
    lowestRate: 0.08,
    ageAmount: { maximum: 6_345, phaseoutStart: 47_234 },
    brackets: [
      { upTo: 61_200, rate: 0.08 },
      { upTo: 154_259, rate: 0.1 },
      { upTo: 185_111, rate: 0.12 },
      { upTo: 246_813, rate: 0.13 },
      { upTo: 370_220, rate: 0.14 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },
  BC: {
    name: "British Columbia",
    bpa: 13_216,
    lowestRate: 0.056,
    ageAmount: { maximum: 5_927, phaseoutStart: 44_119 },
    brackets: [
      { upTo: 50_363, rate: 0.056 },
      { upTo: 100_728, rate: 0.077 },
      { upTo: 115_648, rate: 0.105 },
      { upTo: 140_430, rate: 0.1229 },
      { upTo: 190_405, rate: 0.147 },
      { upTo: 265_545, rate: 0.168 },
      { upTo: Infinity, rate: 0.205 },
    ],
  },
  ON: {
    name: "Ontario",
    bpa: 12_989,
    lowestRate: 0.0505,
    ageAmount: { maximum: 6_341, phaseoutStart: 47_210 },
    brackets: [
      { upTo: 53_891, rate: 0.0505 },
      { upTo: 107_785, rate: 0.0915 },
      { upTo: 150_000, rate: 0.1116 },
      { upTo: 220_000, rate: 0.1216 },
      { upTo: Infinity, rate: 0.1316 },
    ],
    surtax: { threshold1: 5_818, rate1: 0.2, threshold2: 7_446, rate2: 0.36 },
  },
  QC: {
    name: "Quebec",
    bpa: 18_952,
    lowestRate: 0.14,
    ageAmount: { maximum: 3_986, phaseoutStart: 42_955 },
    brackets: [
      { upTo: 54_345, rate: 0.14 },
      { upTo: 108_680, rate: 0.19 },
      { upTo: 132_245, rate: 0.24 },
      { upTo: Infinity, rate: 0.2575 },
    ],
    federalAbatement: 0.165,
  },
  MB: {
    name: "Manitoba",
    bpa: 15_780,
    lowestRate: 0.108,
    ageAmount: { maximum: 3_806, phaseoutStart: 28_332 },
    bpaPhaseout: { start: 200_000, end: 400_000 },
    brackets: [
      { upTo: 47_000, rate: 0.108 },
      { upTo: 101_200, rate: 0.1275 },
      { upTo: Infinity, rate: 0.174 },
    ],
  },
  SK: {
    name: "Saskatchewan",
    bpa: 20_381,
    lowestRate: 0.105,
    ageAmount: { maximum: 5_901, phaseoutStart: 43_927 },
    brackets: [
      { upTo: 54_532, rate: 0.105 },
      { upTo: 155_805, rate: 0.125 },
      { upTo: Infinity, rate: 0.145 },
    ],
  },
  NS: {
    name: "Nova Scotia",
    bpa: 11_932,
    lowestRate: 0.0879,
    ageAmount: { maximum: 5_826, phaseoutStart: 31_321 },
    brackets: [
      { upTo: 30_995, rate: 0.0879 },
      { upTo: 61_991, rate: 0.1495 },
      { upTo: 97_417, rate: 0.1667 },
      { upTo: 157_124, rate: 0.175 },
      { upTo: Infinity, rate: 0.21 },
    ],
  },
  NB: {
    name: "New Brunswick",
    bpa: 13_664,
    lowestRate: 0.094,
    ageAmount: { maximum: 6_158, phaseoutStart: 45_844 },
    brackets: [
      { upTo: 52_333, rate: 0.094 },
      { upTo: 104_666, rate: 0.14 },
      { upTo: 193_861, rate: 0.16 },
      { upTo: Infinity, rate: 0.195 },
    ],
  },
  NL: {
    name: "Newfoundland & Labrador",
    bpa: 15_000,
    lowestRate: 0.087,
    ageAmount: { maximum: 7_142, phaseoutStart: 39_138 },
    brackets: [
      { upTo: 44_678, rate: 0.087 },
      { upTo: 89_354, rate: 0.145 },
      { upTo: 159_528, rate: 0.158 },
      { upTo: 223_340, rate: 0.178 },
      { upTo: 285_319, rate: 0.198 },
      { upTo: 570_638, rate: 0.208 },
      { upTo: 1_141_275, rate: 0.213 },
      { upTo: Infinity, rate: 0.218 },
    ],
  },
  PE: {
    name: "Prince Edward Island",
    bpa: 15_000,
    lowestRate: 0.095,
    ageAmount: { maximum: 6_510, phaseoutStart: 36_600 },
    brackets: [
      { upTo: 33_928, rate: 0.095 },
      { upTo: 65_820, rate: 0.1347 },
      { upTo: 106_890, rate: 0.166 },
      { upTo: 142_520, rate: 0.1762 },
      { upTo: 200_000, rate: 0.19 },
      { upTo: Infinity, rate: 0.2 },
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

function federalBasicPersonalAmount(netIncome: number): number {
  if (netIncome <= FEDERAL_BPA_PHASEOUT_START) return FEDERAL_BPA;
  if (netIncome >= FEDERAL_BPA_PHASEOUT_END) return FEDERAL_BPA_MIN;
  const phaseout = (netIncome - FEDERAL_BPA_PHASEOUT_START) / (FEDERAL_BPA_PHASEOUT_END - FEDERAL_BPA_PHASEOUT_START);
  return FEDERAL_BPA - phaseout * (FEDERAL_BPA - FEDERAL_BPA_MIN);
}

function provincialBasicPersonalAmount(prov: ProvinceDef, netIncome: number): number {
  if (!prov.bpaPhaseout) return prov.bpa;
  if (netIncome <= prov.bpaPhaseout.start) return prov.bpa;
  if (netIncome >= prov.bpaPhaseout.end) return 0;
  return prov.bpa * (1 - (netIncome - prov.bpaPhaseout.start) / (prov.bpaPhaseout.end - prov.bpaPhaseout.start));
}

function ageAmount(
  age: number,
  netIncome: number,
  amount: { maximum: number; phaseoutStart: number },
): number {
  if (age < 65) return 0;
  return Math.max(0, amount.maximum - Math.max(0, netIncome - amount.phaseoutStart) * 0.15);
}

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
  let fedCredits = federalBasicPersonalAmount(netIncome);
  fedCredits += ageAmount(input.age, netIncome, {
    maximum: FED_AGE_AMOUNT,
    phaseoutStart: FED_AGE_CLAWBACK_START,
  });
  if ((input.pensionIncome ?? 0) > 0) {
    fedCredits += Math.min(FED_PENSION_AMOUNT, input.pensionIncome ?? 0);
  }
  fed -= fedCredits * LOWEST_FED_RATE;
  fed -= grossedDividends * FED_DTC;
  fed = Math.max(0, fed);
  if (prov.federalAbatement) fed *= 1 - prov.federalAbatement;

  // Provincial
  let provTax = bracketTax(taxable, prov.brackets);
  let provCredits = provincialBasicPersonalAmount(prov, netIncome);
  if (prov.ageAmount) provCredits += ageAmount(input.age, netIncome, prov.ageAmount);
  if ((input.pensionIncome ?? 0) > 0) provCredits += Math.min(1_500, input.pensionIncome ?? 0);
  provTax -= provCredits * prov.lowestRate;
  provTax -= grossedDividends * PROV_DTC;
  provTax = Math.max(0, provTax);
  if (prov.surtax) {
    const s = prov.surtax;
    provTax +=
      Math.max(0, provTax - s.threshold1) * s.rate1 + Math.max(0, provTax - s.threshold2) * s.rate2;
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
