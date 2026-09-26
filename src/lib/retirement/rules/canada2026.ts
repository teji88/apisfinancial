import type { RuleVersion } from "./RuleVersion";

export const CANADA_2026_RULES: RuleVersion[] = [
  { id: "cpp-2026", ruleType: "CPP_RETIREMENT", jurisdiction: "FEDERAL", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Government of Canada" },
  { id: "oas-2026", ruleType: "OAS", jurisdiction: "FEDERAL", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Government of Canada" },
  { id: "gis-2026", ruleType: "GIS", jurisdiction: "FEDERAL", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Government of Canada" },
  { id: "tax-federal-2026", ruleType: "PERSONAL_INCOME_TAX", jurisdiction: "FEDERAL", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Canada Revenue Agency" },
  { id: "tax-ab-2026", ruleType: "PERSONAL_INCOME_TAX", jurisdiction: "AB", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Canada Revenue Agency" },
  { id: "tfsa-2026", ruleType: "TFSA", jurisdiction: "FEDERAL", effectiveFrom: "2026-01-01", version: "2026", status: "PUBLISHED", source: "Canada Revenue Agency" },
];

export const CANADA_2026_PARAMETERS = {
  cpp: { startMinAge: 60, startMaxAge: 70, before65MonthlyAdjustment: -0.006, after65MonthlyAdjustment: 0.007, maxAt65Monthly: 1507.65 },
  oas: { startMinAge: 65, startMaxAge: 70, deferralMonthlyAdjustment: 0.006, maxDeferralAdjustment: 0.36, age75Increase: 0.10, maxMonthly65To74: 751.97, maxMonthly75Plus: 827.17 },
  gis: {
    singleMaxMonthly: 1123.17,
    singleIncomeCutoff: 22800,
    spouseOasMaxMonthly: 676.09,
    spouseOasIncomeCutoff: 30096,
    spouseNotOasIncomeCutoff: 54624,
    allowanceIncomeCutoff: 42144,
    allowanceSurvivorIncomeCutoff: 30696,
  },
  tfsa: { annualLimit: 7000, withdrawalRoomRestoration: "NEXT_CALENDAR_YEAR" as const },
  tax: {
    federalBrackets: [[0, 58523, 0.14], [58523, 117045, 0.205], [117045, 181440, 0.26], [181440, 258482, 0.29], [258482, Infinity, 0.33]],
    albertaBrackets: [[0, 61200, 0.08], [61200, 154259, 0.10], [154259, 185111, 0.12], [185111, 246813, 0.13], [246813, 370220, 0.14], [370220, Infinity, 0.15]],
    provincialBrackets: { AB: [[0, 61200, 0.08], [61200, 154259, 0.10], [154259, 185111, 0.12], [185111, 246813, 0.13], [246813, 370220, 0.14], [370220, Infinity, 0.15]], BC: [[0, 50363, 0.056], [50363, 100728, 0.077], [100728, 115648, 0.105], [115648, 140430, 0.1229], [140430, 190405, 0.147], [190405, 265545, 0.168], [265545, Infinity, 0.205]], MB: [[0, 47564, 0.108], [47564, 101200, 0.1275], [101200, Infinity, 0.174]], NB: [[0, 52333, 0.094], [52333, 104666, 0.14], [104666, 193861, 0.16], [193861, Infinity, 0.195]], NL: [[0, 44678, 0.087], [44678, 89354, 0.145], [89354, 159528, 0.158], [159528, 223340, 0.178], [223340, 285319, 0.198], [285319, 570638, 0.208], [570638, 1141275, 0.213], [1141275, Infinity, 0.218]], NT: [[0, 53003, 0.059], [53003, 106009, 0.086], [106009, 172346, 0.122], [172346, Infinity, 0.1405]], NS: [[0, 30995, 0.0879], [30995, 61991, 0.1495], [61991, 97417, 0.1667], [97417, 157124, 0.175], [157124, Infinity, 0.21]], NU: [[0, 55801, 0.04], [55801, 111602, 0.07], [111602, 181439, 0.09], [181439, Infinity, 0.115]], ON: [[0, 53891, 0.0505], [53891, 107785, 0.0915], [107785, 150000, 0.1116], [150000, 220000, 0.1216], [220000, Infinity, 0.1316]], PE: [[0, 33928, 0.095], [33928, 65820, 0.1347], [65820, 106890, 0.166], [106890, 142520, 0.1762], [142520, 200000, 0.19], [200000, Infinity, 0.20]], SK: [[0, 54532, 0.105], [54532, 155805, 0.125], [155805, Infinity, 0.145]], YT: [[0, 58523, 0.064], [58523, 117045, 0.09], [117045, 181440, 0.109], [181440, 500000, 0.128], [500000, Infinity, 0.15]] },
    federalBasicPersonalAmount: 16452,
    albertaBasicPersonalAmount: 22769,
    eligibleDividendGrossUp: 0.38,
    nonEligibleDividendGrossUp: 0.15,
    eligibleDividendFederalCreditRate: 6 / 11,
    nonEligibleDividendFederalCreditRate: 9 / 13,
    federalPensionIncomeCreditRate: 0.14,
    provincialPensionIncomeAmount: { AB: 1753 },
  },
  oasRecovery: { startIncome: 95323, upperIncomeUnder75: 155109, upperIncome75Plus: 161088 },
} as const;
