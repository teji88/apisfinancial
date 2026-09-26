import { describe, expect, it } from "vitest";
import { solveGrossWithdrawalForNetNeed } from "./WithdrawalEngine";

const base = {
  province: "AB" as const,
  payerAge: 70,
  spouseAge: 70,
  payer: { age: 70, rrspRrif: 0, eligiblePensionIncome: 0 },
  spouse: { age: 70, rrspRrif: 0, eligiblePensionIncome: 0 },
  owner: "MAIN_USER" as const,
};

describe("tax-aware gross withdrawal solver", () => {
  it("withdraws dollar-for-dollar from a non-taxable bucket", () => {
    const result = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 10_000,
      taxableRegistered: false,
    });
    expect(result.grossWithdrawal).toBe(10_000);
    expect(result.incrementalTax).toBe(0);
    expect(result.netCash).toBe(10_000);
  });

  it("grosses up a registered withdrawal for income tax", () => {
    const result = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 20_000,
    });
    expect(result.grossWithdrawal).toBeGreaterThan(10_000);
    expect(result.netCash).toBeGreaterThanOrEqual(10_000);
    expect(result.incrementalTax).toBeGreaterThan(0);
  });

  it("requires more gross withdrawal when the household already has higher income", () => {
    const lowIncome = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 30_000,
    });
    const highIncome = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 30_000,
      payer: { age: 70, rrspRrif: 100_000, eligiblePensionIncome: 100_000 },
    });
    expect(highIncome.grossWithdrawal).toBeGreaterThan(lowIncome.grossWithdrawal);
  });

  it("accounts for OAS recovery at high net income", () => {
    const belowRecovery = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 30_000,
      payer: { age: 70, oas: 10_000 },
    });
    const aboveRecovery = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 30_000,
      payer: { age: 70, oas: 100_000 },
    });
    expect(aboveRecovery.grossWithdrawal).toBeGreaterThan(belowRecovery.grossWithdrawal);
    expect(aboveRecovery.incrementalTax).toBeGreaterThan(belowRecovery.incrementalTax);
  });
});
