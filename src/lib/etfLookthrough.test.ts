import { describe, expect, it } from "vitest";
import { buildLookthroughRows, type EtfHoldingsMap } from "./etfLookthrough";

type Row = { symbol: string; name: string; marketValue: number; isEtf: boolean };
const stock = (symbol: string, marketValue: number, name = ""): Row => ({
  symbol,
  name,
  marketValue,
  isEtf: false,
});
const etf = (symbol: string, marketValue: number, name = ""): Row => ({
  symbol,
  name,
  marketValue,
  isEtf: true,
});

describe("buildLookthroughRows", () => {
  it("passes direct holdings through with no via-ETF value", () => {
    const out = buildLookthroughRows([stock("RY.TO", 1000, "Royal Bank"), stock("AAPL", 500)], {});
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      symbol: "RY.TO",
      directValue: 1000,
      viaEtfValue: 0,
      totalValue: 1000,
      pct: (1000 / 1500) * 100,
    });
    expect(out.rows[1]).toMatchObject({ symbol: "AAPL", directValue: 500, viaEtfValue: 0 });
    expect(out.unmappedValue).toBe(0);
    expect(out.total).toBe(1500);
  });

  it("expands one ETF into its stocks and leaves the remainder unmapped", () => {
    const holdings: EtfHoldingsMap = {
      SPY: {
        asOf: "2026-11-12",
        rows: [
          { symbol: "AAPL", name: "Apple Inc", weight: 0.0789 },
          { symbol: "MSFT", name: "Microsoft Corp", weight: 0.0589 },
        ],
      },
    };
    const out = buildLookthroughRows([etf("SPY", 10_000)], holdings);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      symbol: "AAPL",
      directValue: 0,
      viaEtfValue: 789,
      totalValue: 789,
      pct: 7.89,
    });
    expect(out.rows[1]).toMatchObject({ symbol: "MSFT", viaEtfValue: 589 });
    // 100% - (7.89% + 5.89%) of the ETF is not in the stored rows.
    expect(out.unmappedValue).toBeCloseTo(10_000 - 789 - 589, 6);
    expect(out.asOf).toBe("2026-11-12");
  });

  it("recurses through a fund of funds (XEQT -> XIC/ITOT -> stocks)", () => {
    const holdings: EtfHoldingsMap = {
      XEQT: {
        asOf: "2026-11-12",
        rows: [
          { symbol: "XIC", name: "iShares Core S&P/TSX Capped Composite", weight: 0.25 },
          { symbol: "ITOT", name: "iShares Core S&P Total U.S. Stock Market", weight: 0.45 },
        ],
      },
      XIC: {
        asOf: "2026-11-12",
        rows: [{ symbol: "RY.TO", name: "Royal Bank of Canada", weight: 0.03 }],
      },
      ITOT: {
        asOf: "2026-11-12",
        rows: [{ symbol: "AAPL", name: "Apple Inc", weight: 0.07 }],
      },
    };
    const out = buildLookthroughRows([etf("XEQT", 10_000)], holdings);
    const ry = out.rows.find((r) => r.symbol === "RY.TO");
    const aapl = out.rows.find((r) => r.symbol === "AAPL");
    expect(ry).toMatchObject({ viaEtfValue: 10_000 * 0.25 * 0.03 });
    expect(aapl).toMatchObject({ viaEtfValue: 10_000 * 0.45 * 0.07 });
    // XEQT's own rows only sum to 70% (XIC + ITOT); the sub-funds' rows are
    // partial fixtures too, so every level leaves a remainder unmapped:
    // XEQT 30% (3000) + XIC 97% of 2500 (2425) + ITOT 93% of 4500 (4185).
    expect(out.unmappedValue).toBeCloseTo(9610, 6);
    expect(out.unmappedEtfs.map((u) => u.symbol)).toContain("XEQT");
  });

  it("merges a direct holding with the same stock held via an ETF", () => {
    const holdings: EtfHoldingsMap = {
      SPY: { asOf: "2026-11-12", rows: [{ symbol: "AMZN", name: "Amazon.com Inc", weight: 0.04 }] },
    };
    const out = buildLookthroughRows([stock("AMZN", 1000), etf("SPY", 5000)], holdings);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      symbol: "AMZN",
      directValue: 1000,
      viaEtfValue: 200,
      totalValue: 1200,
    });
    expect(out.rows[0]!.viaEtfs).toEqual(["SPY"]);
  });

  it("treats an ETF with no holdings data as fully unmapped", () => {
    const out = buildLookthroughRows([etf("FNDX", 4000), stock("RY.TO", 1000)], {});
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.symbol).toBe("RY.TO");
    expect(out.unmappedValue).toBe(4000);
    expect(out.unmappedEtfs).toEqual([{ symbol: "FNDX", value: 4000, reason: "no holdings data" }]);
    expect(out.asOf).toBeNull();
  });

  it("merges the same stock across different casings", () => {
    const holdings: EtfHoldingsMap = {
      SPY: { asOf: "2026-11-12", rows: [{ symbol: "AAPL", name: "Apple Inc", weight: 0.1 }] },
    };
    const out = buildLookthroughRows([stock("aapl", 100), etf("SPY", 1000)], holdings);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      symbol: "aapl",
      directValue: 100,
      viaEtfValue: 100,
      totalValue: 200,
    });
  });

  it("stops at a cycle instead of recursing forever", () => {
    const holdings: EtfHoldingsMap = {
      AAA: { asOf: "2026-11-12", rows: [{ symbol: "BBB", name: "Fund B", weight: 0.5 }] },
      BBB: { asOf: "2026-11-12", rows: [{ symbol: "AAA", name: "Fund A", weight: 0.5 }] },
    };
    const out = buildLookthroughRows([etf("AAA", 1000)], holdings);
    expect(out.rows).toHaveLength(0);
    expect(out.unmappedValue).toBe(1000);
  });

  it("returns empty rows and zero total for an empty portfolio", () => {
    const out = buildLookthroughRows([], {});
    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.unmappedValue).toBe(0);
    expect(out.asOf).toBeNull();
  });
});
