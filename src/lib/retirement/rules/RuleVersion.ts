export type RuleStatus = "LEGISLATED" | "PUBLISHED" | "PROJECTED";
export type RuleJurisdiction = "FEDERAL" | "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";
export interface RuleVersion { id:string; ruleType:string; jurisdiction:RuleJurisdiction; effectiveFrom:string; effectiveTo?:string; version:string; status:RuleStatus; source:string; }
export const RULE_REPOSITORY_VERSION = "2026.1";
