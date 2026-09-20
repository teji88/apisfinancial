/**
 * The ticker universe most Canadian retail portfolios are built from.
 *
 * Canadian listings are stored with the `.TO` suffix (how our market data
 * sources identify TSX listings). US listings carry no suffix.
 *
 * Used for two things:
 *  1. Symbol suggestions and suffix help when someone types a ticker.
 *  2. A slow background seed of the shared price-history library so the
 *     prices are already in our database before anyone asks for them.
 */

/** TSX-listed symbols, written WITHOUT the .TO suffix. */
const CANADIAN_BASE = [
  // All-in-one asset allocation
  "XEQT", "VEQT", "VGRO", "XGRO", "ZGRO", "VBAL", "XBAL", "ZBAL", "VCNS", "XCNS",
  // Broad market ETFs
  "VFV", "ZSP", "XUS", "XSP", "VSP", "ZQQ", "XQQ", "HXQ", "TEC", "VCN", "XIC", "ZCN",
  "XIU", "HXU", "HXT", "VUN", "XUU", "VIU", "XEF", "VEE", "XEC", "XAW", "VXC",
  // Dividend, covered call, specialty
  "VDY", "XEI", "ZWC", "ZWE", "ZWU", "ZWH", "CDZ", "HAL", "ZEB", "HCAL", "XFN", "ZRE",
  "XRE", "VRE", "HURA", "XEG", "ZEO", "XUT",
  // Cash and fixed income
  "CASH", "CBIL", "CSAV", "PSA", "ZAG", "XBB", "VAB", "ZPR", "XTR", "XSB", "VSB", "FLI",
  // TSX 60 — financials
  "RY", "TD", "BMO", "BNS", "CM", "NA", "SLF", "MFC", "POW", "IGM", "IFC", "BAM", "BN", "GWO",
  // Energy
  "ENB", "CNQ", "SU", "TOU", "CVE", "TRP", "IMO", "PPL",
  // Telecom and media
  "BCE", "T", "RCI.B", "QBR.B", "TRI",
  // Rail and industrials
  "CP", "CNR", "WSP", "TFII", "CAE", "CJT",
  // Retail and consumer
  "ATD", "L", "WN", "MRU", "EMP.A", "CTC.A", "DOL",
  // Materials and mining
  "AEM", "ABX", "WPM", "K", "FNV", "TECK.B", "CCL.B",
  // Utilities
  "FTS", "EMA", "H", "AQN", "BIP.UN", "BEP.UN",
  // Technology
  "SHOP", "CSU", "GIB.A", "OTEX", "SAP",
  // Oil, gas and uranium
  "ATH", "BTE", "CPG", "ERF", "HWX", "MEG", "NVA", "PEY", "PRQ", "SGY", "VII", "WCP",
  "FRU", "TPZ", "ARX", "KEL", "TWM", "CCO", "DML", "NXE", "FCU", "GLO",
  // Mining
  "CS", "FM", "LUN", "HBM", "ERO", "IVN", "CMMC", "WDO", "DPM", "ELD", "KRR", "OGC",
  "PAAS", "AG", "MAG", "SIL", "FR", "LUG", "CG", "LIPO", "STND", "CEU", "OR", "MNT",
  // REITs
  "CAR.UN", "DIR.UN", "GRT.UN", "SRU.UN", "REI.UN", "HR.UN", "AP.UN", "KMP.UN", "CRT.UN",
  "CHP.UN", "FCR.UN", "SMU.UN", "NWH.UN", "ARE", "IIP.UN", "SVI", "CSH.UN",
  // Mid-cap financials
  "EQB", "CWB", "LB", "MIC", "FN", "FC", "TCN", "FSV", "CIGI", "X",
  // Industrials, consumer, tech
  "STN", "BDT", "MAL", "LNR", "MG", "MTA", "NFI", "RUS", "ATZ", "GOOS", "GUD", "PBH",
  "PZA", "MTY", "AWF", "TIH", "EIF", "NVEI", "LSPD", "DND", "DCBO", "PRN", "ENGH", "KXS",
];

/** US-listed symbols (NYSE / Nasdaq), no suffix. */
const US_SYMBOLS = [
  // Mega-cap and AI
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AVGO", "AMD", "TSM",
  "ASML", "INTC", "QCOM", "AMAT", "MU", "ARM", "SMCI",
  // Software, cloud, cyber
  "CRM", "ORCL", "ADBE", "NOW", "SNOW", "PLTR", "CRWD", "PANW", "FTNT", "DDOG", "NET",
  "ZS", "MDB", "HUBS", "TEAM", "WDAY", "SQ", "PYPL",
  // Internet, social, media
  "NFLX", "SPOT", "UBER", "ABNB", "DASH", "PINS", "SNAP", "ROKU", "ZM", "MTCH", "DIS",
  "WBD", "CMCSA",
  // Semis and hardware
  "TXN", "ADI", "NXPI", "KLAC", "LRCX", "HPE", "DELL", "HPQ", "STX", "WDC", "MCHP",
  // Financials
  "JPM", "BAC", "WFC", "C", "MS", "GS", "V", "MA", "AXP", "SCHW", "BLK", "CME", "SPGI",
  "MCO", "BK", "CB", "AON", "MMC", "PGR", "TRV",
  // Healthcare
  "UNH", "LLY", "JNJ", "ABBV", "MRK", "TMO", "PFE", "DHR", "ABT", "AMGN", "ISRG", "SYK",
  "MDT", "VRTX", "REGN", "BIIB", "GILD", "CVS", "CI", "HUM", "BDX", "BSX",
  // Consumer staples
  "PG", "KO", "PEP", "WMT", "COST", "PM", "MO", "TGT", "HSY", "GIS", "KHC", "MNST",
  "CHD", "CL", "KMB", "EL", "SYY", "K", "CPB", "KR",
  // Consumer discretionary
  "HD", "LOW", "SBUX", "NKE", "MCD", "BKNG", "MAR", "HLT", "YUM", "DRI", "TSCO", "F",
  "GM", "ROST", "TJX", "ULTA", "ORLY",
  // Industrials and defense
  "CAT", "DE", "HON", "RTX", "LMT", "BA", "GE", "UNP", "UPS", "FDX", "EMR", "ETN", "CMI",
  "ITW", "GD", "NOC", "CSX", "NSC", "WM", "RSG",
  // Energy and utilities
  "XOM", "CVX", "COP", "EOG", "SLB", "HAL", "MPC", "PSX", "VLO", "OXY", "HES", "NEE",
  "D", "EXC", "SO", "AEP", "SRE", "DUK", "ED", "PEG",
  // US-listed ETFs
  "VTI", "VOO", "SPY", "QQQ", "SCHD", "JEPI", "JEPQ", "DIA", "IWM", "VT", "VXUS", "ARKK",
  "ARKG", "SMH", "SOXX", "XLF", "XLV", "XLE", "XLU", "XLY", "XLP", "VNQ", "TLT", "BND",
  // Retail favourites
  "GME", "AMC", "HOOD", "COIN", "MSTR", "MARA", "RIOT", "CVNA", "UPST", "AFRM", "SOFI",
  "LCID", "NKLA", "RIVN", "WBA", "CHWY", "BYND", "PTON", "TLRY", "CGC", "PLUG", "FCEL",
  "SPCE", "BITO", "IBIT", "FBTC",
  // Global ADRs
  "BABA", "BBD", "BIDU", "JD", "PDD", "MELI", "SE", "TTE", "SHEL", "BP", "RIO", "BHP",
  "VALE", "AZN", "NVO", "TM", "HMC", "SNY", "GSK", "ABB",
];

/** Every Canadian symbol in the form our price sources use, e.g. "RY.TO". */
export const CANADIAN_TICKERS: string[] = Array.from(
  new Set(CANADIAN_BASE.map((s) => `${s.toUpperCase()}.TO`)),
);

export const US_TICKERS: string[] = Array.from(new Set(US_SYMBOLS.map((s) => s.toUpperCase())));

/** The full universe, Canadian listings first (they carry the deepest history). */
export const TICKER_UNIVERSE: string[] = [...CANADIAN_TICKERS, ...US_TICKERS];

/** Base symbols (no suffix) that are known TSX listings. */
export const CANADIAN_BASE_SET: ReadonlySet<string> = new Set(
  CANADIAN_BASE.map((s) => s.toUpperCase()),
);

const US_SET: ReadonlySet<string> = new Set(US_TICKERS);

/**
 * Tidy up what a person typed: uppercase, strip spaces, turn a "-" or ":"
 * Canadian suffix into ".TO", and add ".TO" when the bare symbol is a TSX
 * listing we know and is not also a US listing.
 */
export function normalizeTicker(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "";
  s = s.replace(/[-:](TO|TSX|CA)$/, ".TO");
  if (s.endsWith(".TO")) return s;
  if (CANADIAN_BASE_SET.has(s) && !US_SET.has(s)) return `${s}.TO`;
  return s;
}

/**
 * When a bare symbol could be either market, this is the Canadian spelling to
 * try as a fallback (e.g. "T" → "T.TO"), otherwise null.
 */
export function canadianAlternative(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!s || s.endsWith(".TO")) return null;
  return CANADIAN_BASE_SET.has(s) ? `${s}.TO` : null;
}

/** Up to `limit` universe tickers matching what has been typed so far. */
export function suggestTickers(query: string, limit = 8): string[] {
  const q = query.trim().toUpperCase().replace(/\s+/g, "");
  if (q.length < 1) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const t of TICKER_UNIVERSE) {
    if (t.startsWith(q)) starts.push(t);
    else if (t.includes(q)) contains.push(t);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The one-line rule we show people wherever a ticker is typed. */
export const TICKER_HINT =
  "Canadian listings end in .TO (RY.TO, XEQT.TO, BIP.UN.TO). US listings are the plain ticker (AAPL, VOO).";
