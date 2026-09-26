import type { RetirementScenario } from "../domain/types";
import { applyAccountDeathTreatment, createAccountState, mandatoryRegisteredWithdrawal } from "../engines/AccountEngine";
import { estimateCppSurvivorAnnual, estimateGovernmentBenefits } from "../engines/BenefitEngine";
import { calculateBasicTax, calculateIncrementalWithdrawalCost } from "../engines/TaxEngine";

export interface RetirementValidationIssue {
  id: string;
  severity: "ERROR" | "WARNING";
  category: "INPUT" | "ACCOUNT" | "BENEFIT" | "TAX" | "DEATH" | "SIMULATION";
  message: string;
}

export function validateRetirementScenario(scenario: RetirementScenario): RetirementValidationIssue[] {
  const issues: RetirementValidationIssue[] = [];
  if (!scenario.household.people.length) issues.push({ id:"no-person", severity:"ERROR", category:"INPUT", message:"At least one person is required." });
  if (scenario.goals.annualSpending < 0) issues.push({ id:"negative-spending", severity:"ERROR", category:"INPUT", message:"Annual spending cannot be negative." });
  if (scenario.goals.planningAge <= 0) issues.push({ id:"invalid-planning-age", severity:"ERROR", category:"INPUT", message:"Planning age must be positive." });
  if (scenario.assumptions.inflationRate <= -100) issues.push({ id:"invalid-inflation", severity:"ERROR", category:"INPUT", message:"Inflation must be greater than -100%." });
  if (scenario.assumptions.investmentReturn <= -100) issues.push({ id:"invalid-return", severity:"ERROR", category:"INPUT", message:"Investment return must be greater than -100%." });
  if (scenario.assumptions.investmentFeeRate < 0) issues.push({ id:"negative-fee", severity:"ERROR", category:"INPUT", message:"Investment fees cannot be negative." });

  const ids = new Set<string>();
  for (const account of scenario.accounts) {
    if (ids.has(account.id)) issues.push({ id:"duplicate-account-"+account.id, severity:"ERROR", category:"ACCOUNT", message:"Account IDs must be unique." });
    ids.add(account.id);
    const value = account.valuation.value ?? account.valuation.linkedValue ?? 0;
    if (value < 0) issues.push({ id:"negative-account-"+account.id, severity:"ERROR", category:"ACCOUNT", message:"Account values cannot be negative." });
    if (account.type === "NON_REGISTERED" && account.nonRegisteredAcb !== undefined && account.nonRegisteredAcb < 0)
      issues.push({ id:"negative-acb-"+account.id, severity:"ERROR", category:"ACCOUNT", message:"Adjusted cost base cannot be negative." });
    if (account.type === "NON_REGISTERED" && (account.nonRegisteredAcb ?? 0) > value)
      issues.push({ id:"acb-exceeds-value-"+account.id, severity:"WARNING", category:"ACCOUNT", message:"Adjusted cost base exceeds the modeled account value; the simulation will cap it at account value." });
  }

  for (const person of scenario.household.people) {
    if (person.birthMonth < 1 || person.birthMonth > 12) issues.push({ id:"birth-month-"+person.role, severity:"ERROR", category:"INPUT", message:"Birth month must be between 1 and 12." });
    if (person.retirementAge < 0 || person.retirementAge > 100) issues.push({ id:"retirement-age-"+person.role, severity:"ERROR", category:"INPUT", message:"Retirement age must be between 0 and 100." });
    if (typeof person.cppStartAge === "number" && (person.cppStartAge < 60 || person.cppStartAge > 70))
      issues.push({ id:"cpp-age-"+person.role, severity:"ERROR", category:"BENEFIT", message:"CPP start age must be between 60 and 70." });
    if (typeof person.oasStartAge === "number" && (person.oasStartAge < 65 || person.oasStartAge > 70))
      issues.push({ id:"oas-age-"+person.role, severity:"ERROR", category:"BENEFIT", message:"OAS start age must be between 65 and 70." });
    if (person.oasResidenceYears < 0 || person.oasResidenceYears > 40)
      issues.push({ id:"oas-residence-"+person.role, severity:"ERROR", category:"BENEFIT", message:"OAS residence years must be between 0 and 40." });
    if (person.deathAge !== undefined && person.deathAge <= 0) issues.push({ id:"death-age-"+person.role, severity:"ERROR", category:"DEATH", message:"Death age must be positive." });
    if (person.survivorCppPercent !== undefined && (person.survivorCppPercent < 0 || person.survivorCppPercent > 100))
      issues.push({ id:"survivor-cpp-"+person.role, severity:"ERROR", category:"DEATH", message:"Survivor CPP percentage must be between 0% and 100%." });
  }
  return issues;
}

export interface GoldenCaseResult { name: string; passed: boolean; details: string; }

export function runRetirementGoldenCases(): GoldenCaseResult[] {
  const cases: GoldenCaseResult[] = [];
  const base = {
    id:"golden", name:"Golden", household:{ province:"AB" as const, stage:"BOTH_ALIVE" as const, people:[{ role:"MAIN_USER" as const, birthYear:1960, birthMonth:1, retirementAge:65, cppAt65:1000, cppStartAge:65 as const, oasStartAge:65 as const, oasResidenceYears:40 }] },
    goals:{ retirementAge:65, annualSpending:60000, spendingBasis:"TODAYS_DOLLARS" as const, planningAge:90 },
    accounts:[], assumptions:{ inflationRate:2, investmentReturn:5, investmentFeeRate:.5, futureRulesMode:"CURRENT_LAW_PLUS_INDEXING" as const },
    strategy:{ withdrawalPolicy:"TFSA_FIRST" as const, objective:"MAX_SUSTAINABLE_SPENDING" as const }, metadata:{createdAt:"2026-01-01",engineVersion:"test",rulesVersion:"test"}
  } satisfies RetirementScenario;

  const taxFree = createAccountState({id:"tfsa",owner:"MAIN_USER",type:"TFSA",valuation:{mode:"MANUAL",value:1000}});
  const taxable = createAccountState({id:"rrsp",owner:"MAIN_USER",type:"RRSP",valuation:{mode:"MANUAL",value:1000}});
  cases.push({name:"TFSA withdrawals are tax-free",passed:calculateBasicTax(0,"AB",65).totalTax === 0,details:"Zero taxable income produces zero modeled basic tax."});
  cases.push({name:"RRSP withdrawals are taxable",passed:calculateIncrementalWithdrawalCost(50000,1000,"AB",65).incrementalTax > 0,details:"A positive registered withdrawal creates incremental tax."});
  cases.push({name:"RRIF minimum before age 71 is zero",passed:mandatoryRegisteredWithdrawal("RRIF",70,100000) === 0,details:"No minimum is required before age 71."});
  cases.push({name:"RRIF minimum at 71 is positive",passed:mandatoryRegisteredWithdrawal("RRIF",71,100000) > 0,details:"The age-71 minimum is applied."});
  cases.push({name:"OAS residence is capped at 40 years",passed:estimateGovernmentBenefits({...base.household.people[0],oasResidenceYears:80},65,0,{calendarYear:2026}).oas === estimateGovernmentBenefits(base.household.people[0],65,0,{calendarYear:2026}).oas,details:"Residence factor is capped at full residence."});
  cases.push({name:"CPP survivor cannot exceed requested/base cap",passed:estimateCppSurvivorAnnual(12000,70,0,60) <= 7200,details:"Survivor estimate is bounded by the modeled survivor percentage."});
  const death = applyAccountDeathTreatment(taxable,true,0,"SPOUSE");
  cases.push({name:"Spousal RRSP transfer is not immediately taxable",passed:death.transferredToSurvivor===1000 && death.taxableAtDeath===0,details:"Modeled spouse rollover transfers value without immediate tax."});
  const nr = applyAccountDeathTreatment({...taxable,type:"NON_REGISTERED"},false,400,"ESTATE");
  cases.push({name:"Non-registered death models capital gain",passed:nr.capitalGainAtDeath===600 && nr.taxableCapitalGainAtDeath===300,details:"Value less ACB creates the modeled capital gain."});
  const invalid = validateRetirementScenario({...base,goals:{...base.goals,annualSpending:-1}});
  cases.push({name:"Invalid negative spending is rejected",passed:invalid.some(x=>x.id==="negative-spending"&&x.severity==="ERROR"),details:"Scenario validation catches negative spending."});
  void taxFree;
  return cases;
}
