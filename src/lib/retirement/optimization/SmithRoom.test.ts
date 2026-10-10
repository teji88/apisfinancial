import { describe, expect, it } from "vitest";
import { computeRoom } from "./SmithRoom";

const base = {
  startBalance: 400_000,
  rate: 0.05,
  payment: 2_000,
  frequency: "monthly" as const,
  startDate: "2026-01-01",
  totalDrawn: 0,
  today: "2026-07-01",
};

describe("computeRoom", () => {
  it("accrues principal repaid as room", () => {
    const r = computeRoom(base);
    // ~5 full monthly periods in 181 days; first payment principal ≈ 2000 − 400000×0.05/12 ≈ 333
    expect(r.paymentsCounted).toBe(5);
    expect(r.roomCreated).toBeGreaterThan(1_500);
    expect(r.roomCreated).toBeLessThan(3_000);
    expect(r.roomAvailable).toBe(r.roomCreated);
  });

  it("subtracts drawn amounts; never goes negative", () => {
    const r = computeRoom({ ...base, totalDrawn: 1_000_000 });
    expect(r.roomAvailable).toBe(0);
    const r2 = computeRoom({ ...base, totalDrawn: 1_000 });
    expect(r2.roomAvailable).toBeCloseTo(r2.roomCreated - 1_000, 2);
  });

  it("handles biweekly frequency (more payments)", () => {
    const monthly = computeRoom(base);
    const biweekly = computeRoom({ ...base, frequency: "biweekly", payment: 923 });
    expect(biweekly.paymentsCounted).toBeGreaterThan(monthly.paymentsCounted);
  });

  it("returns zeros for future start or no payment", () => {
    expect(computeRoom({ ...base, startDate: "2027-01-01" }).roomCreated).toBe(0);
    expect(computeRoom({ ...base, payment: 0 }).roomCreated).toBe(0);
  });

  it("stops accruing once the mortgage is paid off", () => {
    const r = computeRoom({ ...base, startBalance: 5_000, today: "2030-01-01" });
    expect(r.roomCreated).toBeCloseTo(5_000, 0);
  });
});
