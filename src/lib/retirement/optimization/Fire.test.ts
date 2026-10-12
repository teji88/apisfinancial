import { describe, expect, it } from "vitest";
import {
  classicFireNumber,
  coastFireNumber,
  computeFire,
  fireProgress,
  yearsToCoastFire,
} from "./Fire";

describe("classicFireNumber", () => {
  it("$60k spend at 4% → $1.5M", () => {
    expect(classicFireNumber(60000, 0.04)).toBe(1500000);
  });

  it("uses a custom withdrawal rate", () => {
    expect(classicFireNumber(60000, 0.03)).toBe(2000000);
  });

  it("guards non-positive inputs", () => {
    expect(classicFireNumber(0)).toBe(0);
    expect(classicFireNumber(-5000)).toBe(0);
    expect(classicFireNumber(60000, 0)).toBe(0);
    expect(classicFireNumber(60000, -0.01)).toBe(0);
  });
});

describe("coastFireNumber", () => {
  it("discounts the FIRE number by real growth over the horizon", () => {
    // $1.5M, 25 years, 5% real → ≈ $442.5k
    expect(coastFireNumber(1500000, 25, 0.05)).toBeCloseTo(
      1500000 / Math.pow(1.05, 25),
      6,
    );
    expect(coastFireNumber(1500000, 25, 0.05)).toBeCloseTo(442956, -3);
  });

  it("returns the full FIRE number with no time or no growth", () => {
    expect(coastFireNumber(1500000, 0, 0.05)).toBe(1500000);
    expect(coastFireNumber(1500000, -5, 0.05)).toBe(1500000);
    expect(coastFireNumber(1500000, 25, 0)).toBe(1500000);
  });

  it("guards non-positive FIRE numbers", () => {
    expect(coastFireNumber(0, 25, 0.05)).toBe(0);
  });
});

describe("yearsToCoastFire", () => {
  it("solves the annuity equation — forward simulation lands on the coast number", () => {
    const pv = 100000;
    const pmt = 10000;
    const coast = 442956;
    const r = 0.05;
    const n = yearsToCoastFire(pv, pmt, coast, r);
    expect(n).not.toBeNull();
    expect(n!).toBeGreaterThan(0);
    // Verify: FV at n equals the coast number.
    const fv = pv * Math.pow(1 + r, n!) + pmt * ((Math.pow(1 + r, n!) - 1) / r);
    expect(fv).toBeCloseTo(coast, 0);
  });

  it("returns 0 when already coasted", () => {
    expect(yearsToCoastFire(500000, 0, 442956, 0.05)).toBe(0);
    expect(yearsToCoastFire(442956, 0, 442956, 0.05)).toBe(0);
  });

  it("uses the linear formula when real return is zero", () => {
    // ($200k − $100k) / $20k per year = 5 years.
    expect(yearsToCoastFire(100000, 20000, 200000, 0)).toBe(5);
  });

  it("returns null when unreachable", () => {
    // No growth and no contributions: never gets there.
    expect(yearsToCoastFire(100000, 0, 200000, 0)).toBeNull();
    expect(yearsToCoastFire(0, 0, 200000, 0.05)).toBeNull();
  });

  it("returns 0 for a non-positive coast number", () => {
    expect(yearsToCoastFire(0, 0, 0, 0.05)).toBe(0);
  });
});

describe("fireProgress", () => {
  it("is the clamped invested-to-target ratio", () => {
    expect(fireProgress(750000, 1500000)).toBe(0.5);
    expect(fireProgress(2000000, 1500000)).toBe(1);
    expect(fireProgress(-100, 1500000)).toBe(0);
  });

  it("guards non-positive FIRE numbers", () => {
    expect(fireProgress(100000, 0)).toBe(0);
  });
});

describe("computeFire", () => {
  it("combines the pieces consistently", () => {
    const r = computeFire({
      annualSpend: 60000,
      withdrawalRate: 0.04,
      realReturn: 0.05,
      yearsToRetirement: 25,
      currentInvested: 200000,
      annualContribution: 15000,
    });
    expect(r.fireNumber).toBe(1500000);
    expect(r.coastNumber).toBeCloseTo(442956, -3);
    expect(r.progress).toBeCloseTo(200000 / 1500000, 6);
    expect(r.yearsToCoast).not.toBeNull();
    expect(r.yearsToCoast!).toBeGreaterThan(0);
  });
});
