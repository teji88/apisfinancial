import type { RetirementScenario } from "../domain/types";

export const RETIREMENT_ENGINE_VERSION = "2.0.0-foundation";
export const RETIREMENT_RULES_VERSION = "2026-canada-foundation";

export function createDefaultRetirementScenario(now = new Date()): RetirementScenario {
  const year = now.getUTCFullYear();
  return {
    id: crypto.randomUUID(),
    name: "Base retirement plan",
    household: {
      province: "AB",
      stage: "BOTH_ALIVE",
      people: [{ role: "MAIN_USER", birthYear: year - 40, birthMonth: 1, retirementAge: 65, cppStartAge: "OPTIMIZE", oasStartAge: "OPTIMIZE", oasResidenceYears: 40 }],
    },
    goals: { retirementAge: 65, annualSpending: 60000, spendingBasis: "TODAYS_DOLLARS", planningAge: 95 },
    accounts: [],
    assumptions: { inflationRate: 2.0, investmentReturn: 6.0, investmentFeeRate: 0.5, futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" },
    strategy: { withdrawalPolicy: "OPTIMIZE", objective: "MAX_SUSTAINABLE_SPENDING", cashReserve: 0 },
    metadata: { createdAt: now.toISOString(), engineVersion: RETIREMENT_ENGINE_VERSION, rulesVersion: RETIREMENT_RULES_VERSION },
  };
}
