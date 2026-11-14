/**
 * ETF tickers the look-through knows, by app-form symbol (TSX listings
 * carry `.TO`). This is the Dashboard's fallback: a holding counts as an
 * ETF when its recorded asset_type says so OR its ticker is on this
 * list, so an import that defaulted asset_type to "Stock" does not hide
 * a real ETF from the look-through toggle.
 *
 * Keep in sync with the adapters in etfHoldings.server.ts
 * (ISHARES_FUNDS, SCHWAB_FUNDS, VANGUARD_PROXY_FUNDS): when a new ETF
 * adapter lands, add its app-form symbol here too. A ticker with no
 * adapter stays off the list on purpose — it cannot be looked through,
 * so the fallback must not promote it.
 */
const APP_FORM_SYMBOLS = [
  "XEQT.TO",
  "XIC.TO",
  "XEF.TO",
  "XEC.TO",
  "XTOT.TO",
  "ITOT",
  "IWR",
  "IVV",
  "FNDX",
  "VE.TO",
] as const;

const KNOWN = new Set<string>();
for (const s of APP_FORM_SYMBOLS) {
  KNOWN.add(s);
  KNOWN.add(s.replace(/\.TO$/, ""));
}

function normalizeTicker(raw: string): string {
  const s = raw.trim().toUpperCase();
  const m = /^([A-Z]{2,6}):(.+)$/.exec(s);
  return m ? m[2]! : s;
}

/** True when the symbol is a known ETF ticker, bare or app form. */
export function isKnownEtfSymbol(symbol: string): boolean {
  return KNOWN.has(normalizeTicker(symbol));
}
