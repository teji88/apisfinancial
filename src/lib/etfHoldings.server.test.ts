import { describe, expect, it } from "vitest";
import {
  appFormEtfSymbol,
  bareEtfSymbol,
  normalizeUnderlyingSymbol,
  parseISharesHoldingsCsv,
  parseSchwabHoldingsHtml,
  parseVanguardHoldingsJson,
} from "./etfHoldings.server";

// Fund-of-funds fixture, modelled on iShares' published XEQT file:
// equity rows are other ETFs, cash rows carry currency tickers.
const XEQT_CSV = `iShares Core Equity ETF Portfolio
Fund Holdings as of Nov 12, 2026
Inception Date,Aug 07 2019
Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Nominal,Price,Location,Exchange,Currency,FX Rate,Market Currency
ITOT,ISHARES CORE S&P TOTAL US STOCK,Equity,Equity,"4,792,897,978.96",45.36,"4,792,897,978.96","29,776,950",160.96,United States,NYSE Arca,USD,1.4429,USD
XIC,ISHARES S&P/TSX CAPPED COMPOSITE,Equity,Equity,"2,624,801,154.68",24.84,"2,624,801,154.68","73,938,061",35.50,Canada,Toronto Stock Exchange,CAD,1.0000,CAD
XEF,ISHARES CORE MSCI EAFE IMI ETF,Equity,Equity,"2,538,206,128.84",24.02,"2,538,206,128.84","70,388,412",36.06,Canada,Toronto Stock Exchange,CAD,1.0000,CAD
XEC,ISHARES CORE MSCI EMERGING MARKETS,Equity,Equity,"531,310,210.95",5.03,"531,310,210.95","18,340,014",28.97,Canada,Toronto Stock Exchange,CAD,1.0000,CAD
CAD,CAD CASH,Cash,Cash,"40,845,984.72",0.39,"40,845,984.72","40,845,985",100.00,Canada,-,CAD,1.0000,CAD
USD,USD CASH,Cash,Cash,"37,885,081.79",0.36,"37,885,081.79","26,256,208",100.00,United States,-,USD,1.4429,USD
`;

const STOCK_CSV = `Fund Holdings as of,Nov 10 2026
Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Nominal,Price,Location,Exchange,Currency,FX Rate,Market Currency
RY,ROYAL BANK OF CANADA,Financials,Equity,"1,234,567.00",5.12,"1,234,567.00","10,000",123.45,Canada,Toronto Stock Exchange,CAD,1.0000,CAD
AAPL,APPLE INC,Information Technology,Equity,"987,654.00",4.10,"987,654.00","5,000",197.53,United States,NASDAQ,USD,1.4200,USD
`;

describe("parseISharesHoldingsCsv", () => {
  it("parses a fund-of-funds file, drops cash rows, keeps equity weights as fractions", () => {
    const parsed = parseISharesHoldingsCsv(XEQT_CSV);
    expect(parsed).not.toBeNull();
    expect(parsed!.asOf).toBe("2026-11-12");
    expect(parsed!.rows).toHaveLength(4);
    expect(parsed!.rows[0]).toEqual({
      symbol: "ITOT",
      name: "ISHARES CORE S&P TOTAL US STOCK",
      weight: 0.4536,
    });
    expect(parsed!.rows[1]).toEqual({
      symbol: "XIC.TO",
      name: "ISHARES S&P/TSX CAPPED COMPOSITE",
      weight: 0.2484,
    });
  });

  it("normalises Canadian stocks to .TO and leaves US tickers bare", () => {
    const parsed = parseISharesHoldingsCsv(STOCK_CSV);
    expect(parsed).not.toBeNull();
    expect(parsed!.asOf).toBe("2026-11-10");
    expect(parsed!.rows).toEqual([
      { symbol: "RY.TO", name: "ROYAL BANK OF CANADA", weight: 0.0512 },
      { symbol: "AAPL", name: "APPLE INC", weight: 0.041 },
    ]);
  });

  it("rejects an HTML page, a file with no header, and a file with no as-of date", () => {
    expect(parseISharesHoldingsCsv("<!DOCTYPE html><html><body>hi</body></html>")).toBeNull();
    expect(parseISharesHoldingsCsv("Ticker,Name\nAAPL,Apple\n")).toBeNull();
    const noAsOf = STOCK_CSV.replace("Fund Holdings as of,Nov 10 2026\n", "");
    expect(parseISharesHoldingsCsv(noAsOf)).toBeNull();
  });
});

describe("symbol normalisation", () => {
  it("maps app-form ETF symbols to bare adapter symbols and back", () => {
    expect(bareEtfSymbol("XEQT.TO")).toBe("XEQT");
    expect(bareEtfSymbol("IVV")).toBe("IVV");
    expect(bareEtfSymbol("TSX:XEQT")).toBe("XEQT");
    expect(appFormEtfSymbol("XEQT", "ca/en")).toBe("XEQT.TO");
    expect(appFormEtfSymbol("IVV", "us")).toBe("IVV");
  });

  it("adds .TO for Canadian listings only", () => {
    expect(normalizeUnderlyingSymbol("RY", "Canada", "Toronto Stock Exchange")).toBe("RY.TO");
    expect(normalizeUnderlyingSymbol("AAPL", "United States", "NASDAQ")).toBe("AAPL");
    expect(normalizeUnderlyingSymbol("RY", "Canada", "")).toBe("RY.TO");
    expect(normalizeUnderlyingSymbol("TSX:RY", "", "")).toBe("RY.TO");
  });
});

// Schwab fixture, modelled on the live FNDX holdings page: 6-column
// table, 0-based paging, cash + futures rows to drop, "As of M/D/YY".
const FNDX_HTML = `<html><body>
<p>Schwab Fundamental U.S. Large Company ETF (FNDX)</p>
<p>As of 11/12/26</p>
<p>Displaying 1 - 100 of 732</p>
<table>
<tr><th>Fund Name</th><th>CUSIP</th><th>Symbol</th><th>Quantity</th><th>% of Assets</th><th>Market Value</th></tr>
<tr><td>APPLE INC</td><td>037833100</td><td>AAPL</td><td>4,026,104</td><td>4.96%</td><td>$1.4B</td></tr>
<tr><td>BERKSHIRE HATHAWAY INC CLASS B</td><td>084670702</td><td>BRK/B</td><td>968,368</td><td>1.98%</td><td>$571.2M</td></tr>
<tr><td>AT&amp;T INC</td><td>00206R102</td><td>T</td><td>1,000,000</td><td>1.00%</td><td>$25.0M</td></tr>
<tr><td>US DOLLAR</td><td>999USDZ92</td><td>USD</td><td>3,714,982</td><td>0.01%</td><td>$3.7M</td></tr>
<tr><td>S&amp;P500 EMINI DEC 26</td><td>ADI2VB4H9</td><td>ESZ6</td><td>5,400</td><td>0.00%</td><td>$0.0</td></tr>
</table>
</body></html>`;

describe("parseSchwabHoldingsHtml", () => {
  it("parses the holdings table, drops cash and futures rows, decodes entities", () => {
    const parsed = parseSchwabHoldingsHtml(FNDX_HTML);
    expect(parsed).not.toBeNull();
    expect(parsed!.asOf).toBe("2026-11-12");
    expect(parsed!.rows).toEqual([
      { symbol: "AAPL", name: "APPLE INC", weight: 0.0496 },
      { symbol: "BRK/B", name: "BERKSHIRE HATHAWAY INC CLASS B", weight: 0.0198 },
      { symbol: "T", name: "AT&T INC", weight: 0.01 },
    ]);
  });

  it("rejects a page with no holdings table and one with no as-of date", () => {
    expect(parseSchwabHoldingsHtml("<html><body><p>As of 11/12/26</p></body></html>")).toBeNull();
    const noAsOf = FNDX_HTML.replace("<p>As of 11/12/26</p>\n", "");
    expect(parseSchwabHoldingsHtml(noAsOf)).toBeNull();
    expect(parseSchwabHoldingsHtml("<!DOCTYPE html><html><body>hi</body></html>")).toBeNull();
  });
});

// Vanguard fixture, modelled on the live VGK JSON payload: market values
// are the exact weights (percents are rounded); SAN collides across two
// companies; one row has no ticker; tickers carry dots and spaces.
const VGK_JSON = JSON.stringify({
  size: 1241,
  asOfDate: "2026-09-30T00:00:00-04:00",
  fund: {
    entity: [
      {
        type: "portfolioHolding",
        longName: "ASML Holding NV",
        sharesHeld: "930222",
        marketValue: 50,
        ticker: "ASML",
        isin: "NL0010273215",
        percentWeight: "50.00",
      },
      {
        type: "portfolioHolding",
        longName: "Banco Santander SA",
        sharesHeld: "1000",
        marketValue: 30,
        ticker: "SAN",
        isin: "ES0113900J37",
        percentWeight: "30.00",
      },
      {
        type: "portfolioHolding",
        longName: "Sanofi",
        sharesHeld: "1000",
        marketValue: 10,
        ticker: "SAN",
        isin: "FR0000120578",
        percentWeight: "10.00",
      },
      {
        type: "portfolioHolding",
        longName: "Air Liquide",
        sharesHeld: "1000",
        marketValue: 5,
        ticker: "",
        isin: "FR0000053951",
        percentWeight: "5.00",
      },
      {
        type: "portfolioHolding",
        longName: "Rolls-Royce Holdings PLC",
        sharesHeld: "1000",
        marketValue: 3,
        ticker: "RR.",
        isin: "GB00B63H8491",
        percentWeight: "3.00",
      },
      {
        type: "portfolioHolding",
        longName: "Novo Nordisk A/S",
        sharesHeld: "1000",
        marketValue: 2,
        ticker: "NOVO B",
        isin: "DK0060534915",
        percentWeight: "2.00",
      },
      {
        type: "portfolioHolding",
        longName: "Zero Holding",
        sharesHeld: "0",
        marketValue: 0,
        ticker: "ZERO",
        isin: "US0000000000",
        percentWeight: "0.00",
      },
    ],
  },
});

describe("parseVanguardHoldingsJson", () => {
  it("weights from market value, disambiguates a repeated ticker, keys an empty ticker by ISIN", () => {
    const parsed = parseVanguardHoldingsJson(VGK_JSON);
    expect(parsed).not.toBeNull();
    expect(parsed!.asOf).toBe("2026-09-30");
    expect(parsed!.rows).toEqual([
      { symbol: "ASML", name: "ASML Holding NV", weight: 0.5 },
      { symbol: "SAN", name: "Banco Santander SA", weight: 0.3 },
      { symbol: "SAN-FR", name: "Sanofi", weight: 0.1 },
      { symbol: "FR0000053951", name: "Air Liquide", weight: 0.05 },
      { symbol: "RR.", name: "Rolls-Royce Holdings PLC", weight: 0.03 },
      { symbol: "NOVO B", name: "Novo Nordisk A/S", weight: 0.02 },
    ]);
  });

  it("rejects garbage JSON, a missing as-of date, and an empty entity list", () => {
    expect(parseVanguardHoldingsJson("not json")).toBeNull();
    expect(parseVanguardHoldingsJson("<html><body>hi</body></html>")).toBeNull();
    const noAsOf = JSON.parse(VGK_JSON) as Record<string, unknown>;
    delete noAsOf.asOfDate;
    expect(parseVanguardHoldingsJson(JSON.stringify(noAsOf))).toBeNull();
    expect(
      parseVanguardHoldingsJson(
        JSON.stringify({ asOfDate: "2026-09-30T00:00:00-04:00", fund: { entity: [] } }),
      ),
    ).toBeNull();
  });
});
