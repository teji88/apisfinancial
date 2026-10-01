import { describe, expect, it } from "vitest";
import { chooseRegisteredWithdrawalOwner, planWithdrawalSequence, solveGrossWithdrawalForNetNeed } from "./WithdrawalEngine";

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
      payer: { age: 70, rrspRrif: 40_000, eligiblePensionIncome: 40_000 },
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
  it("does not treat an RRSP withdrawal as eligible pension income after age 65", () => {
    const result = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 20_000,
      registeredAccountType: "RRSP",
      payer: { age: 70, rrspRrif: 40_000, eligiblePensionIncome: 0 },
    });
    expect(result.grossWithdrawal).toBeGreaterThan(10_000);
  });

  it("treats an RRIF withdrawal as eligible pension income after age 65", () => {
    const result = solveGrossWithdrawalForNetNeed({
      ...base,
      netNeed: 10_000,
      maxGross: 20_000,
      registeredAccountType: "RRIF",
      payer: { age: 70, rrspRrif: 40_000, eligiblePensionIncome: 40_000 },
    });
    expect(result.grossWithdrawal).toBeGreaterThan(10_000);
  });

  it("taxes only the realized gain portion of a non-registered withdrawal", () => {
    const taxFree = solveGrossWithdrawalForNetNeed({ ...base, netNeed: 10_000, maxGross: 20_000, taxableRegistered: false, nonRegisteredGainFraction: 0 });
    const halfGain = solveGrossWithdrawalForNetNeed({ ...base, netNeed: 10_000, maxGross: 20_000, taxableRegistered: false, nonRegisteredGainFraction: 0.5, payer: { age: 70, rrspRrif: 50_000 } });
    expect(taxFree.grossWithdrawal).toBe(10_000);
    expect(halfGain.grossWithdrawal).toBeGreaterThan(10_000);
    expect(halfGain.incrementalTax).toBeGreaterThan(0);
  });

  it("accepts an explicit registered account type for owner selection", () => {
    const result = chooseRegisteredWithdrawalOwner({
      netNeed: 10_000,
      owners: [{ owner: "MAIN_USER", balance: 20_000, age: 70 }],
      province: "AB",
      payerAge: 70,
      spouseAge: 70,
      registeredAccountType: "RRSP",
      taxInputs: {
        MAIN_USER: { age: 70, rrspRrif: 40_000, eligiblePensionIncome: 0 },
        PARTNER: { age: 70, rrspRrif: 0, eligiblePensionIncome: 0 },
      },
    });
    expect(result).toBeDefined();
    expect(result!.solved.grossWithdrawal).toBeGreaterThan(10_000);
  });

  it("funds a need from the configured sequence and preserves account-level traceability", () => {
    const result = planWithdrawalSequence({
      netNeed: 12_000,
      province: "AB",
      payerAge: 70,
      spouseAge: 70,
      taxInputs: {
        MAIN_USER: { age: 70 },
        PARTNER: { age: 70 },
      },
      owners: [
        { accountId: "cash-1", owner: "MAIN_USER", type: "CASH", balance: 5_000, age: 70 },
        { accountId: "tfsa-1", owner: "MAIN_USER", type: "TFSA", balance: 20_000, age: 70 },
      ],
      priority: ["CASH", "TFSA"],
    });
    expect(result.fullyFunded).toBe(true);
    expect(result.remainingNeed).toBeLessThanOrEqual(0.005);
    expect(result.steps.map((step) => step.accountId)).toEqual(["cash-1", "tfsa-1"]);
    expect(result.totalGrossWithdrawal).toBe(12_000);
    expect(result.totalNetCash).toBe(12_000);
  });

  it("does not treat a non-registered capital gain as the full withdrawal", () => {
    const result = planWithdrawalSequence({
      netNeed: 10_000,
      province: "AB",
      payerAge: 70,
      spouseAge: 70,
      taxInputs: { MAIN_USER: { age: 70, rrspRrif: 50_000 }, PARTNER: { age: 70 } },
      owners: [{
        accountId: "nr-1",
        owner: "MAIN_USER",
        type: "NON_REGISTERED",
        balance: 20_000,
        age: 70,
        gainFraction: 0.5,
      }],
      priority: ["NON_REGISTERED"],
    });
    expect(result.fullyFunded).toBe(true);
    expect(result.steps[0]!.grossWithdrawal).toBeGreaterThan(10_000);
    expect(result.steps[0]!.netCash).toBeGreaterThanOrEqual(10_000);
  });

});
