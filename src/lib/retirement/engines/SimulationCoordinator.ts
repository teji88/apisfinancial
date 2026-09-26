import type { RetirementScenario, SimulationResult, MonthlySnapshot } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION } from "../scenario/defaults";
export function runBasicSimulation(scenario:RetirementScenario, startingPortfolio:number, startYear=new Date().getUTCFullYear()):SimulationResult {
 const months:number=12*Math.max(1,scenario.goals.planningAge-scenario.goals.retirementAge);
 const monthly:MonthlySnapshot[]=[]; let portfolio=startingPortfolio; let lifetimeSpending=0,lifetimeTax=0;
 const r=Math.pow(1+scenario.assumptions.investmentReturn/100,1/12)-1;
 const inflation=Math.pow(1+scenario.assumptions.inflationRate/100,1/12)-1;
 let spending=scenario.goals.annualSpending/12;
 for(let i=0;i<months;i++){ const date=new Date(Date.UTC(startYear+Math.floor(i/12),i%12,1)); portfolio*=1+r; const withdrawal=Math.min(portfolio,spending); portfolio-=withdrawal; lifetimeSpending+=withdrawal; const tax=0;lifetimeTax+=tax; monthly.push({date:date.toISOString(),ages:{},householdStage:"BOTH_ALIVE",portfolio,registered:0,tfsa:0,nonRegistered:0,cash:0,debt:0,netWorth:portfolio,grossIncome:withdrawal,benefits:0,withdrawals:withdrawal,taxes:tax,spending,shortfall:Math.max(0,spending-withdrawal)}); spending*=1+inflation; }
 const shortfall=monthly.reduce((m,x)=>Math.max(m,x.shortfall),0);
 return {simulationId:crypto.randomUUID(),scenarioId:scenario.id,status:"COMPLETE",startDate:monthly[0]?.date ?? new Date().toISOString(),endDate:monthly.at(-1)?.date ?? new Date().toISOString(),monthly,metrics:{feasible:shortfall===0,depletionDate:portfolio<=0?monthly.find(x=>x.portfolio<=0)?.date:undefined,lifetimeSpending,lifetimeAfterTaxCash:lifetimeSpending,lifetimeTax,totalBenefits:0,endingPortfolio:portfolio,endingNetWorth:portfolio,minimumPortfolio:Math.min(...monthly.map(x=>x.portfolio)),maximumSpendingShortfall:shortfall},warnings:["Foundation simulation only: government benefits, taxes, account-specific rules, survivor events and optimizer are not yet included."],assumptions:[],engineVersion:RETIREMENT_ENGINE_VERSION,rulesVersion:"2026.1",scenarioHash:scenario.id};
}
