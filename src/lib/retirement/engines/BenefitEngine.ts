import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import type { Money, PersonScenario } from "../domain/types";
export interface BenefitEstimate { cpp:Money; oas:Money; }
export function estimateGovernmentBenefits(person:PersonScenario, year:number):BenefitEstimate {
 if(year!==2026) return {cpp:0,oas:0};
 const cppBase=person.cppAt65 ?? 0;
 const cppAge=typeof person.cppStartAge==="number"?person.cppStartAge:65;
 const cppFactor=cppAge<65 ? 1 + (65-cppAge)*12*CANADA_2026_PARAMETERS.cpp.before65MonthlyAdjustment : 1 + Math.min(cppAge-65,5)*12*CANADA_2026_PARAMETERS.cpp.after65MonthlyAdjustment;
 const oasBase=0;
 const oasAge=typeof person.oasStartAge==="number"?person.oasStartAge:65;
 const oasFactor=1 + Math.min(Math.max(oasAge-65,0),5)*12*CANADA_2026_PARAMETERS.oas.deferralMonthlyAdjustment;
 return {cpp:Math.max(0,cppBase*cppFactor),oas:oasBase*oasFactor};
}
