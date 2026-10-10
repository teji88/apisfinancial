import { describe, expect, it } from "vitest";
import { analyzeProperty, monthsSince, isValueStale, rollupProperties, type PropertyInputs } from "./RealEstate";

const base: PropertyInputs = {
  name: "Test condo",
  currentValue: 400_000,
  mortgageBalance: 300_000,
  mortgagePayment: 1_700,
  monthlyRent: 2_200,
  otherIncome: 50,
  vacancyPct: 5,
  expenses: {
    propertyTax: 2_400,
    insurance: 600,
    maintenance: 1_800,
    managementPct: 8,
    condoFees: 3_600,
    utilities: 0,
    other: 0,
  },
  cashInvested: 100_000,
};

describe("analyzeProperty", () => {
  it("computes NOI, cash flow, cap rate, cash-on-cash, equity", () => {
    const r = analyzeProperty(base);
    // Gross: (2200+50)*12 = 27,000; vacancy 5% = 1,350; effective = 25,650
    expect(r.effectiveIncome).toBeCloseTo(25_650, 0);
    // Expenses: 2400+600+1800+ (8% of 25650=2052) +3600 = 10,452
    expect(r.operatingExpenses).toBeCloseTo(10_452, 0);
    expect(r.noi).toBeCloseTo(15_198, 0);
    // Mortgage: 1700*12 = 20,400; cash flow = 15198-20400 = -5,202
    expect(r.cashFlowAnnual).toBeCloseTo(-5_202, 0);
    expect(r.capRatePct).toBeCloseTo((15_198 / 400_000) * 100, 1);
    expect(r.cashOnCashPct).toBeCloseTo((-5_202 / 100_000) * 100, 1);
    expect(r.equity).toBe(100_000);
  });

  it("a cash-flowing property shows positive numbers", () => {
    const r = analyzeProperty({ ...base, monthlyRent: 2_800, mortgagePayment: 1_200 });
    expect(r.cashFlowMonthly).toBeGreaterThan(0);
    expect(r.cashOnCashPct).toBeGreaterThan(0);
  });

  it("handles a free-and-clear property", () => {
    const r = analyzeProperty({ ...base, mortgageBalance: 0, mortgagePayment: 0 });
    expect(r.cashFlowAnnual).toBe(r.noi);
    expect(r.equity).toBe(400_000);
  });

  it("clamps negatives to zero", () => {
    const r = analyzeProperty({ ...base, monthlyRent: -100, vacancyPct: -5 });
    expect(r.effectiveIncome).toBeGreaterThanOrEqual(0);
  });
});

describe("rollupProperties", () => {
  it("rolls up a portfolio", () => {
    const roll = rollupProperties([base, { ...base, name: "Second", currentValue: 500_000, mortgageBalance: 350_000 }]);
    expect(roll.properties.length).toBe(2);
    expect(roll.totalValue).toBe(900_000);
    expect(roll.totalMortgage).toBe(650_000);
    expect(roll.totalEquity).toBe(250_000);
    expect(roll.totalCashFlowAnnual).toBeCloseTo(
      roll.properties[0].cashFlowAnnual + roll.properties[1].cashFlowAnnual, 0,
    );
  });

  it("handles an empty portfolio", () => {
    const roll = rollupProperties([]);
    expect(roll.totalEquity).toBe(0);
    expect(roll.properties.length).toBe(0);
  });
});

describe("expense ratio and capex reserve", () => {
  it("reports operating expenses as a % of effective income", () => {
    const r = analyzeProperty({ ...base, monthlyRent: 2000, vacancyPct: 5 });
    const expected = (r.operatingExpenses / r.effectiveIncome) * 100;
    expect(r.expenseRatioPct).toBeCloseTo(expected, 6);
    expect(r.expenseRatioPct).toBeGreaterThan(0);
  });
  it("guards the expense ratio when income is zero", () => {
    const r = analyzeProperty({ ...base, monthlyRent: 0, otherIncome: 0 });
    expect(r.expenseRatioPct).toBe(0);
  });
  it("subtracts the capex reserve from cash flow", () => {
    const r = analyzeProperty({ ...base, capexReserveAnnual: 3600 });
    expect(r.capexReserveAnnual).toBe(3600);
    const plain = analyzeProperty({ ...base });
    expect(r.cashFlowAnnual).toBe(plain.cashFlowAnnual - 3600);
  });
});

describe("monthsSince / isValueStale", () => {
  it("counts whole months between dates", () => {
    expect(monthsSince("2026-01-15", "2026-10-10")).toBe(9);
    expect(monthsSince("2026-10-01", "2026-10-10")).toBe(0);
    expect(monthsSince(null, "2026-10-10")).toBe(null);
  });
  it("flags values older than 6 months or never stamped", () => {
    expect(isValueStale("2026-01-01", "2026-10-10")).toBe(true);
    expect(isValueStale(null, "2026-10-10")).toBe(true);
    expect(isValueStale("2026-08-01", "2026-10-10")).toBe(false);
  });
});
