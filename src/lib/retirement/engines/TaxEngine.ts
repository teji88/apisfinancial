import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
export interface TaxResult { taxableIncome:number; federalTax:number; provincialTax:number; totalTax:number; effectiveRate:number; }
function taxFromBrackets(income:number, brackets:readonly (readonly [number,number,number])[]){ let tax=0; for(const [low,high,rate] of brackets){ if(income>low) tax += (Math.min(income,high)-low)*rate; if(income<=high) break; } return Math.max(0,tax); }
export function calculateBasicTax(taxableIncome:number, province:"AB"="AB"):TaxResult {
 const federalGross=taxFromBrackets(taxableIncome,CANADA_2026_PARAMETERS.tax.federalBrackets);
 const provincialGross=taxFromBrackets(taxableIncome,province==="AB"?CANADA_2026_PARAMETERS.tax.albertaBrackets:[]);
 const credits=CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount*0.14 + (province==="AB"?CANADA_2026_PARAMETERS.tax.albertaBasicPersonalAmount*0.08:0);
 const totalTax=Math.max(0,federalGross+provincialGross-credits);
 return {taxableIncome,federalTax:Math.max(0,federalGross-CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount*0.14),provincialTax:Math.max(0,provincialGross-(province==="AB"?CANADA_2026_PARAMETERS.tax.albertaBasicPersonalAmount*0.08:0)),totalTax,effectiveRate:taxableIncome?totalTax/taxableIncome:0};
}
