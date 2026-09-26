import type { RuleVersion } from "./RuleVersion";
export const CANADA_2026_RULES: RuleVersion[] = [
 {id:"cpp-2026",ruleType:"CPP_RETIREMENT",jurisdiction:"FEDERAL",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Government of Canada"},
 {id:"oas-2026",ruleType:"OAS",jurisdiction:"FEDERAL",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Government of Canada"},
 {id:"gis-2026",ruleType:"GIS",jurisdiction:"FEDERAL",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Government of Canada"},
 {id:"tax-federal-2026",ruleType:"PERSONAL_INCOME_TAX",jurisdiction:"FEDERAL",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Canada Revenue Agency"},
 {id:"tax-ab-2026",ruleType:"PERSONAL_INCOME_TAX",jurisdiction:"AB",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Canada Revenue Agency"},
 {id:"tfsa-2026",ruleType:"TFSA",jurisdiction:"FEDERAL",effectiveFrom:"2026-01-01",version:"2026",status:"PUBLISHED",source:"Canada Revenue Agency"},
];
export const CANADA_2026_PARAMETERS = {
 cpp: { startMinAge:60, startMaxAge:70, before65MonthlyAdjustment:-0.006, after65MonthlyAdjustment:0.007 },
 oas: { startMinAge:65, startMaxAge:70, deferralMonthlyAdjustment:0.006, maxDeferralAdjustment:0.36, age75Increase:0.10 },
 tfsa: { annualLimit:7000, withdrawalRoomRestoration:"NEXT_CALENDAR_YEAR" as const },
 tax: {
  federalBrackets:[[0,58523,0.14],[58523,117045,0.205],[117045,181440,0.26],[181440,258482,0.29],[258482,Infinity,0.33]],
  albertaBrackets:[[0,61200,0.08],[61200,154259,0.10],[154259,185111,0.12],[185111,246813,0.13],[246813,370220,0.14],[370220,Infinity,0.15]],
  federalBasicPersonalAmount:16452,
  albertaBasicPersonalAmount:22769,
 },
 oasRecovery: { startIncome:95323, upperIncomeUnder75:155109, upperIncome75Plus:161088 },
} as const;
