import { describe, expect, it } from "vitest";
import { benchmarkValueSeries, type FlowPoint } from "./benchmark";
import {
  benchmarkCoversStart,
  resolveHoldingWeights,
  totalReturnFactor,
} from "./simulator";

describe("audit #18 — benchmark weight resolution", () => {
  it("splits evenly when every weight is blank", () => {
    const out = resolveHoldingWeights([
      { symbol: "ENB.TO", weight: "" },
      { symbol: "AAPL", weight: "" },
      { symbol: "TSLA", weight: "" },
    ]);
    expect(out).toHaveLength(3);
    for (const h of out) expect(h.weight).toBeCloseTo(100 / 3, 9);
  });

  it("blanks split the unallocated remainder evenly", () => {
    const out = resolveHoldingWeights([
      { symbol: "ENB.TO", weight: "60" },
      { symbol: "AAPL", weight: "" },
      { symbol: "TSLA", weight: "" },
    ]);
    expect(out).toEqual([
      { symbol: "ENB.TO", weight: 60 },
      { symbol: "AAPL", weight: 20 },
      { symbol: "TSLA", weight: 20 },
    ]);
  });

  it("an explicit zero excludes the holding instead of becoming weight 1", () => {
    const out = resolveHoldingWeights([
      { symbol: "ENB.TO", weight: "0" },
      { symbol: "AAPL", weight: "" },
    ]);
    expect(out).toEqual([{ symbol: "AAPL", weight: 100 }]);
  });

  it("blanks are dropped when explicit weights already cover 100%+", () => {
    const out = resolveHoldingWeights([
      { symbol: "ENB.TO", weight: "60" },
      { symbol: "AAPL", weight: "50" },
      { symbol: "TSLA", weight: "" },
    ]);
    expect(out).toEqual([
      { symbol: "ENB.TO", weight: 60 },
      { symbol: "AAPL", weight: 50 },
    ]);
  });

  it("non-numeric input is treated as blank", () => {
    const out = resolveHoldingWeights([
      { symbol: "ENB.TO", weight: "oops" },
      { symbol: "AAPL", weight: "50" },
    ]);
    expect(out).toEqual([
      { symbol: "AAPL", weight: 50 },
      { symbol: "ENB.TO", weight: 50 },
    ]);
  });

  it("drops rows with no symbol", () => {
    expect(resolveHoldingWeights([{ symbol: "  ", weight: "" }])).toEqual([]);
  });
});

describe("audit #19 — no double-count on adjusted price series", () => {
  it("totalReturnFactor grosses up only unadjusted series", () => {
    expect(totalReturnFactor(0.05, 2, false)).toBeCloseTo(1.1025, 9);
    expect(totalReturnFactor(0.05, 2, true)).toBe(1);
    expect(totalReturnFactor(0, 5, false)).toBe(1);
    expect(totalReturnFactor(0.05, 0, false)).toBe(1);
  });

  it("benchmarkValueSeries skips yield reinvestment for adjusted series", () => {
    const points = [
      { date: "2026-01-02", close: 100 },
      { date: "2026-01-05", close: 105 },
      { date: "2026-01-06", close: 106 },
    ];
    const flows: FlowPoint[] = [{ date: "2025-12-31", amount: 1000 }];
    const grid = ["2026-01-02", "2026-01-05", "2026-01-06"];
    const bench = { currency: "CAD", points };
    const priceOnly = benchmarkValueSeries(grid, flows, bench, [], 1, 0);
    const adjusted = benchmarkValueSeries(grid, flows, bench, [], 1, 0.1, true);
    // An adjusted close already contains its distributions: identical output.
    expect(adjusted).toEqual(priceOnly);
    const unadjusted = benchmarkValueSeries(grid, flows, bench, [], 1, 0.1, false);
    // Unadjusted + yield: distributions reinvested, so values run higher.
    expect(unadjusted[2]!).toBeGreaterThan(priceOnly[2]!);
  });
});

describe("audit #20 — slightly-late benchmarks are kept", () => {
  it("keeps benchmarks starting on or before the window", () => {
    expect(benchmarkCoversStart("2020-01-01", "2020-01-01")).toBe(true);
    expect(benchmarkCoversStart("2019-06-01", "2020-01-01")).toBe(true);
  });

  it("keeps benchmarks starting within the grace period after the window", () => {
    expect(benchmarkCoversStart("2020-01-02", "2020-01-01")).toBe(true);
    expect(benchmarkCoversStart("2020-01-08", "2020-01-01")).toBe(true);
  });

  it("drops benchmarks starting after the grace period", () => {
    expect(benchmarkCoversStart("2020-01-09", "2020-01-01")).toBe(false);
    expect(benchmarkCoversStart("2021-01-01", "2020-01-01")).toBe(false);
  });

  it("honours a custom grace period", () => {
    expect(benchmarkCoversStart("2020-01-09", "2020-01-01", 10)).toBe(true);
  });
});
