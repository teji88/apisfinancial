import { CANADA_2026_PARAMETERS, CANADA_2026_RULES } from "./canada2026";
import type { RuleJurisdiction, RuleVersion } from "./RuleVersion";
export interface RulesProvider { getVersions(jurisdiction:RuleJurisdiction, year:number):RuleVersion[]; getParameters(jurisdiction:RuleJurisdiction, year:number):unknown; }
export const rulesProvider:RulesProvider = {
 getVersions(jurisdiction,year){ if(year===2026) return CANADA_2026_RULES.filter(r=>r.jurisdiction===jurisdiction || r.jurisdiction==="FEDERAL"); return []; },
 getParameters(jurisdiction,year){ if(year!==2026) return undefined; return jurisdiction==="AB" ? CANADA_2026_PARAMETERS : CANADA_2026_PARAMETERS; }
};
