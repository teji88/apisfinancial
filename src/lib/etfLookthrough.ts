/**
 * ETF look-through: true per-stock concentration, counting exposure inside
 * ETFs as well as direct holdings.
 *
 * A position in an ETF is expanded into its underlying stocks by weight
 * (value × weight), recursing one more level for funds of funds
 * (XEQT -> XIC/ITOT/... -> stocks). A stock held both directly and via
 * one or more ETFs merges into a single row. Anything that cannot be
 * mapped — an ETF with no stored holdings, or the part of a fund's
 * weights that is cash or otherwise not in the stored rows — is reported
 * as unmapped value, never silently dropped.
 *
 * Pure functions only — no storage or network access.
 *
 * How the caller marks an ETF: a direct position carries `isEtf`; an
 * underlying symbol is an ETF exactly when it has an entry in the
 * holdings map (even an empty one, meaning "known ETF, no data yet").
 * A symbol with no map entry is treated as a stock.
 */

export type EtfHoldingRow = {
  symbol: string;
  name: string;
  /** Fraction of the ETF's net assets, 0..1. */
  weight: number;
};

export type EtfHoldingsMap = Record<
  string,
  {
    /** Holdings as-of date, or null when the ETF is known but has no data. */
    asOf: string | null;
    rows: EtfHoldingRow[];
  }
>;

export type LookthroughPosition = {
  symbol: string;
  name: string;
  marketValue: number;
  isEtf: boolean;
};

export type LookthroughRow = {
  symbol: string;
  name: string;
  directValue: number;
  viaEtfValue: number;
  totalValue: number;
  /** Share of the invested total, 0–100. */
  pct: number;
  /** ETFs this stock is held through, if any. */
  viaEtfs: string[];
};

export type UnmappedEtf = {
  symbol: string;
  value: number;
  reason: string;
};

export type LookthroughResult = {
  rows: LookthroughRow[];
  /** ETF value that could not be mapped to stocks. */
  unmappedValue: number;
  unmappedEtfs: UnmappedEtf[];
  /** Newest holdings as-of date among the ETFs actually expanded. */
  asOf: string | null;
  /** Sum of the input positions' market value. */
  total: number;
};

/** Recursion depth: XEQT -> XIC -> stocks is depth 2; 3 leaves headroom. */
const MAX_DEPTH = 3;

type AccumRow = {
  symbol: string;
  name: string;
  directValue: number;
  viaEtfValue: number;
  viaEtfs: Set<string>;
};

export function buildLookthroughRows(
  positions: LookthroughPosition[],
  holdings: EtfHoldingsMap,
): LookthroughResult {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  const byKey = new Map<string, AccumRow>();
  const unmapped = new Map<string, UnmappedEtf>();
  let unmappedValue = 0;
  let newestAsOf: string | null = null;

  const keyOf = (symbol: string) => symbol.toUpperCase();

  const addUnmapped = (symbol: string, value: number, reason: string) => {
    if (value <= 0) return;
    unmappedValue += value;
    const prev = unmapped.get(keyOf(symbol));
    if (prev) {
      prev.value += value;
      if (reason === "no holdings data") prev.reason = reason;
    } else {
      unmapped.set(keyOf(symbol), { symbol, value, reason });
    }
  };

  const accumulate = (symbol: string, name: string, value: number, viaEtf: string | null) => {
    if (value <= 0) return;
    const key = keyOf(symbol);
    let row = byKey.get(key);
    if (!row) {
      row = { symbol, name, directValue: 0, viaEtfValue: 0, viaEtfs: new Set() };
      byKey.set(key, row);
    }
    if (viaEtf) {
      row.viaEtfValue += value;
      row.viaEtfs.add(viaEtf);
    } else {
      row.directValue += value;
    }
    if (!row.name && name) row.name = name;
  };

  /** Expand one ETF position into stocks, recursing into sub-ETFs. */
  const expand = (etfSymbol: string, value: number, path: string[], depth: number) => {
    const entry = holdings[etfSymbol] ?? holdings[keyOf(etfSymbol)];
    if (!entry || entry.rows.length === 0) {
      addUnmapped(etfSymbol, value, "no holdings data");
      return;
    }
    if (entry.asOf && (!newestAsOf || entry.asOf > newestAsOf)) newestAsOf = entry.asOf;
    const mappedWeight = entry.rows.reduce((s, r) => s + r.weight, 0);
    // Cash and anything else the stored rows do not cover.
    addUnmapped(
      etfSymbol,
      value * Math.max(0, 1 - mappedWeight),
      "partly unmapped (cash and other holdings)",
    );
    for (const holding of entry.rows) {
      const contribution = value * holding.weight;
      if (contribution <= 0) continue;
      const holdingKey = keyOf(holding.symbol);
      const subEntry = holdings[holding.symbol] ?? holdings[holdingKey];
      const isSubEtf = subEntry !== undefined;
      if (isSubEtf && depth < MAX_DEPTH && !path.includes(holdingKey)) {
        expand(holding.symbol, contribution, [...path, holdingKey], depth + 1);
      } else if (isSubEtf) {
        // Cycle, or deeper than the cap: keep the value visible, unmapped.
        addUnmapped(holding.symbol, contribution, "no holdings data");
      } else {
        accumulate(holding.symbol, holding.name, contribution, etfSymbol);
      }
    }
  };

  for (const p of positions) {
    if (p.marketValue <= 0) continue;
    if (!p.isEtf) {
      accumulate(p.symbol, p.name, p.marketValue, null);
      continue;
    }
    const entry = holdings[p.symbol] ?? holdings[keyOf(p.symbol)];
    if (!entry || entry.rows.length === 0) {
      addUnmapped(p.symbol, p.marketValue, "no holdings data");
      continue;
    }
    expand(p.symbol, p.marketValue, [keyOf(p.symbol)], 1);
  }

  const rows: LookthroughRow[] = [...byKey.values()]
    .map((r) => {
      const totalValue = r.directValue + r.viaEtfValue;
      return {
        symbol: r.symbol,
        name: r.name,
        directValue: r.directValue,
        viaEtfValue: r.viaEtfValue,
        totalValue,
        pct: total > 0 ? (totalValue / total) * 100 : 0,
        viaEtfs: [...r.viaEtfs].sort(),
      };
    })
    .filter((r) => r.totalValue > 0.005)
    .sort((a, b) => b.totalValue - a.totalValue || a.symbol.localeCompare(b.symbol));

  return {
    rows,
    unmappedValue,
    unmappedEtfs: [...unmapped.values()].sort((a, b) => b.value - a.value),
    asOf: newestAsOf,
    total,
  };
}
