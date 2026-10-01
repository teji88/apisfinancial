import { describe, expect, it } from "vitest";
import { benchmarkValueSeries, closeOn, type FlowPoint } from "./benchmark";

describe("benchmark pricing", () => {
  const points = [
    { date: "2026-01-02", close: 100 },
    { date: "2026-01-05", close: 105 },
    { date: "2026-01-06", close: 106 },
  ];

  it("uses the preceding trading close for weekends and holidays", () => {
    expect(closeOn(points, "2026-01-04")).toBe(100);
    expect(closeOn(points, "2026-01-05")).toBe(105);
  });

  it("falls forward to the first available close when the requested date predates the feed", () => {
    expect(closeOn(points, "2025-12-31")).toBe(100);
  });

  it("does not drop a benchmark contribution when the trade date has no preceding close", () => {
    const flows: FlowPoint[] = [{ date: "2025-12-31", amount: 1000 }];
    const values = benchmarkValueSeries(
      ["2025-12-31", "2026-01-02"],
      flows,
      { currency: "CAD", points },
      [],
      1,
      0,
    );

    expect(values[0]).toBeGreaterThan(0);
    expect(values[1]).toBeGreaterThan(0);
  });
});
