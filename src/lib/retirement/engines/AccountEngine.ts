import type { AccountScenario, Money } from "../domain/types";
export function classifyAccount(account:AccountScenario):{registered:boolean;taxFree:boolean;taxableWithdrawal:boolean}{
 switch(account.type){case "TFSA":return {registered:false,taxFree:true,taxableWithdrawal:false};case "RRSP":case "RRIF":case "LIRA":case "LIF":return {registered:true,taxFree:false,taxableWithdrawal:true};default:return {registered:false,taxFree:false,taxableWithdrawal:false};}
}
export function applyReturn(balance:Money,annualReturn:number,monthlyContribution=0){return balance*Math.pow(1+annualReturn/100,1/12)+monthlyContribution;}
