import { describe, expect, it } from "vitest";
import { accrueDebtMonth, calculateAmortizingPayment, createDebtState } from "./DebtEngine";

describe("DebtEngine", () => {
  it("calculates a monthly amortizing payment", () => {
    const payment = calculateAmortizingPayment(100_000, 6, 120);
    expect(payment).toBeCloseTo(1110.21, 1);
  });

  it("splits a debt payment into interest and principal", () => {
    const state = createDebtState({
      id: "mortgage",
      type: "MORTGAGE",
      startingBalance: 100_000,
      annualInterestRate: 6,
      paymentAmount: 1_110.21,
    });
    const month = accrueDebtMonth(state);
    expect(month.interest).toBeCloseTo(500, 6);
    expect(month.scheduledPrincipal).toBeCloseTo(610.21, 2);
    expect(month.totalPayment).toBeCloseTo(1_110.21, 2);
    expect(month.endingBalance).toBeCloseTo(99_389.79, 2);
  });

  it("caps the final payment at the remaining debt", () => {
    const state = createDebtState({
      id: "loan",
      type: "PERSONAL_LOAN",
      startingBalance: 1_000,
      annualInterestRate: 12,
      paymentAmount: 2_000,
    });
    const month = accrueDebtMonth(state);
    expect(month.endingBalance).toBe(0);
    expect(month.totalPayment).toBeCloseTo(1_010, 6);
    expect(state.active).toBe(false);
  });

  it("applies an extra payment without double-counting interest", () => {
    const state = createDebtState({
      id: "loan",
      type: "LINE_OF_CREDIT",
      startingBalance: 10_000,
      annualInterestRate: 12,
      paymentAmount: 500,
      extraPayment: 250,
    });
    const month = accrueDebtMonth(state);
    expect(month.interest).toBeCloseTo(100, 6);
    expect(month.scheduledPrincipal).toBeCloseTo(400, 6);
    expect(month.extraPrincipal).toBeCloseTo(250, 6);
    expect(month.endingBalance).toBeCloseTo(9_350, 6);
  });
});
