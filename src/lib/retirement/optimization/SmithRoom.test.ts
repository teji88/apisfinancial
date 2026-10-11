import { describe, expect, it } from "vitest";
import { computeRoom, computeRoomSegmented } from "./SmithRoom";

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

describe("computeRoomSegmented", () => {
  const seg1 = {
    startDate: "2026-01-01",
    endDate: "2026-04-01",
    startBalance: 400_000,
    rate: 0.05,
    payment: 2_000,
    frequency: "monthly" as const,
  };
  const seg2 = {
    startDate: "2026-04-01",
    endDate: null,
    startBalance: 398_000,
    rate: 0.04,
    payment: 1_900,
    frequency: "monthly" as const,
  };

  it("sums principal across segments with their own terms", () => {
    const r = computeRoomSegmented([seg1, seg2], 0, "2026-07-01");
    expect(r.paymentsCounted).toBeGreaterThan(0);
    expect(r.roomCreated).toBeGreaterThan(0);
    // Segmented must differ from single-term-with-new-rate (history preserved)
    const single = computeRoom({
      startBalance: 400_000,
      rate: 0.04,
      payment: 1_900,
      frequency: "monthly",
      startDate: "2026-01-01",
      totalDrawn: 0,
      today: "2026-07-01",
    });
    expect(r.roomCreated).not.toBeCloseTo(single.roomCreated, 0);
  });

  it("matches single-term calc when only one segment", () => {
    const r = computeRoomSegmented(
      [{ ...seg1, endDate: null }],
      0,
      "2026-07-01",
    );
    const single = computeRoom({ ...base });
    expect(r.roomCreated).toBeCloseTo(single.roomCreated, 2);
    expect(r.paymentsCounted).toBe(single.paymentsCounted);
  });

  it("ignores segments starting after today", () => {
    const r = computeRoomSegmented(
      [seg1, { ...seg2, startDate: "2027-01-01" }],
      0,
      "2026-07-01",
    );
    const onlyFirst = computeRoomSegmented([seg1], 0, "2026-07-01");
    expect(r.roomCreated).toBeCloseTo(onlyFirst.roomCreated, 2);
  });

  it("subtracts drawn; never negative; empty segments give zeros", () => {
    const r = computeRoomSegmented([seg1, seg2], 1_000_000, "2026-07-01");
    expect(r.roomAvailable).toBe(0);
    expect(computeRoomSegmented([], 0, "2026-07-01").roomCreated).toBe(0);
  });
});
