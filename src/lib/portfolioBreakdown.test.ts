import { describe, expect, it } from "vitest";
import type { HoldingPosition } from "./finance";
import {
  buildBreakdownRows,
  formatShare,
  groupAccountsByType,
  groupPositionsBySymbol,
  sanitizeSelection,
  toggleAccountId,
  toggleAccountType,
  type AccountPick,
  type SymbolBreakdownRow,
} from "./portfolioBreakdown";

function pos(overrides: Partial<HoldingPosition> & { symbol: string }): HoldingPosition {
  return {
    holdingId: `h-${overrides.symbol}-${overrides.accountId ?? "a1"}`,
    accountId: "a1",
    symbol: overrides.symbol,
    name: null,
    currency: "CAD",
    assetType: "Stock",
    units: 0,
    acb: 0,
    acbPerUnit: 0,
    realizedGain: 0,
    dividendsReceived: 0,
    price: null,
    priceEstimated: false,
    previousClose: null,
    marketValue: 0,
    dayChange: 0,
    unrealizedGain: 0,
    totalReturn: 0,
    totalReturnPct: 0,
    ...overrides,
  };
}

function account(id: string, type: string, name = id): AccountPick {
  return { id, account_name: name, account_type: type };
}

describe("groupPositionsBySymbol", () => {
  it("merges the same symbol across accounts, summing value and units", () => {
    const rows = groupPositionsBySymbol([
      pos({
        symbol: "XEQT",
        name: "iShares Core Equity ETF",
        accountId: "tfsa",
        units: 100,
        marketValue: 3000,
      }),
      pos({
        symbol: "XEQT",
        name: "iShares Core Equity ETF",
        accountId: "rrsp",
        units: 50,
        marketValue: 1500,
      }),
      pos({ symbol: "FNDX", accountId: "tfsa", units: 10, marketValue: 500 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: "XEQT",
      name: "iShares Core Equity ETF",
      marketValue: 4500,
      units: 150,
      accountIds: ["tfsa", "rrsp"],
    });
    expect(rows[1].symbol).toBe("FNDX");
  });

  it("merges case-insensitively and keeps first-seen casing", () => {
    const rows = groupPositionsBySymbol([
      pos({ symbol: "xeqt", accountId: "a1", marketValue: 100 }),
      pos({ symbol: "XEQT", accountId: "a2", marketValue: 200 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("xeqt");
    expect(rows[0].marketValue).toBe(300);
  });

  it("sorts largest first and returns [] for no positions", () => {
    const rows = groupPositionsBySymbol([
      pos({ symbol: "SMALL", accountId: "a1", marketValue: 10 }),
      pos({ symbol: "BIG", accountId: "a1", marketValue: 999 }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["BIG", "SMALL"]);
    expect(groupPositionsBySymbol([])).toEqual([]);
  });

  it("marks a symbol as an ETF when any of its positions is recorded as one", () => {
    const rows = groupPositionsBySymbol([
      pos({ symbol: "XEQT", accountId: "a1", marketValue: 100, assetType: "Stock" }),
      pos({ symbol: "XEQT", accountId: "a2", marketValue: 200, assetType: "ETF" }),
      pos({ symbol: "RY.TO", accountId: "a1", marketValue: 50, assetType: "Stock" }),
    ]);
    expect(rows.find((r) => r.symbol === "XEQT")?.isEtf).toBe(true);
    expect(rows.find((r) => r.symbol === "RY.TO")?.isEtf).toBe(false);
  });
});

describe("buildBreakdownRows", () => {
  const symbols: SymbolBreakdownRow[] = [
    {
      symbol: "XEQT",
      name: "iShares Core Equity ETF",
      marketValue: 9000,
      units: 300,
      accountIds: ["tfsa"],
    },
    { symbol: "FNDX", name: "", marketValue: 1000, units: 25, accountIds: ["tfsa", "rrsp"] },
  ];

  it("percentages sum to 100 including the cash row", () => {
    const rows = buildBreakdownRows(symbols, 1000);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ id: "cash", label: "Cash", marketValue: 1000 });
    const totalPct = rows.reduce((s, r) => s + r.pct, 0);
    expect(totalPct).toBeCloseTo(100, 9);
    expect(rows[0].pct).toBeCloseTo(81.82, 2);
  });

  it("omits the cash row when cash is zero or negative", () => {
    expect(buildBreakdownRows(symbols, 0).map((r) => r.id)).toEqual(["symbol:XEQT", "symbol:FNDX"]);
    expect(buildBreakdownRows(symbols, -50).map((r) => r.id)).toEqual([
      "symbol:XEQT",
      "symbol:FNDX",
    ]);
  });

  it("handles cash-only and empty selections", () => {
    const cashOnly = buildBreakdownRows([], 250);
    expect(cashOnly).toHaveLength(1);
    expect(cashOnly[0].pct).toBe(100);
    expect(buildBreakdownRows([], 0)).toEqual([]);
  });

  it("gives 0% everywhere when the total is zero", () => {
    const rows = buildBreakdownRows(
      [{ symbol: "DEAD", name: "", marketValue: 0, units: 10, accountIds: ["a1"] }],
      0,
    );
    expect(rows[0].pct).toBe(0);
  });

  it("notes multi-account symbols in the detail line", () => {
    const rows = buildBreakdownRows(symbols, 0);
    expect(rows[0].detail).toBe("iShares Core Equity ETF");
    expect(rows[1].detail).toBe("2 accounts");
  });
});

describe("formatShare", () => {
  it("formats without a +/- sign", () => {
    expect(formatShare(12.3456)).toBe("12.35%");
    expect(formatShare(0)).toBe("0.00%");
    expect(formatShare(100)).toBe("100.00%");
    expect(formatShare(NaN)).toBe("—");
  });
});

describe("groupAccountsByType", () => {
  it("orders known types canonically, then unknown types alphabetically", () => {
    const groups = groupAccountsByType([
      account("c1", "Corporate", "Corp"),
      account("r1", "RRIF", "RRIF 1"),
      account("n1", "Non-Registered", "Non-reg"),
      account("t1", "TFSA", "TFSA 1"),
      account("l1", "LIF", "LIF 1"),
      account("t2", "TFSA", "TFSA 2"),
    ]);
    expect(groups.map((g) => g.type)).toEqual([
      "TFSA",
      "Non-Registered",
      "Corporate",
      "LIF",
      "RRIF",
    ]);
    expect(groups[0].accounts.map((a) => a.id)).toEqual(["t1", "t2"]);
  });

  it("buckets blank types as Other", () => {
    const groups = groupAccountsByType([account("x1", "  ")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("Other");
  });
});

describe("sanitizeSelection", () => {
  const available = ["a1", "a2", "a3"];

  it("defaults to everything when nothing was stored", () => {
    expect(sanitizeSelection(null, available)).toEqual(available);
  });

  it("stays empty when the user unchecked every account", () => {
    expect(sanitizeSelection([], available)).toEqual([]);
  });

  it("keeps the stored overlap in view order and drops unknown ids", () => {
    expect(sanitizeSelection(["a3", "gone", "a1"], available)).toEqual(["a1", "a3"]);
  });

  it("falls back to everything when the stored ids match nothing in view", () => {
    expect(sanitizeSelection(["old1", "old2"], available)).toEqual(available);
  });
});

describe("toggleAccountId / toggleAccountType", () => {
  it("adds and removes a single account", () => {
    expect(toggleAccountId(["a1"], "a2")).toEqual(["a1", "a2"]);
    expect(toggleAccountId(["a1", "a2"], "a1")).toEqual(["a2"]);
  });

  it("toggles a whole type group", () => {
    expect(toggleAccountType(["a1"], ["a2", "a3"])).toEqual(["a1", "a2", "a3"]);
    expect(toggleAccountType(["a1", "a2", "a3"], ["a2", "a3"])).toEqual(["a1"]);
    expect(toggleAccountType(["a1"], [])).toEqual(["a1"]);
  });
});
