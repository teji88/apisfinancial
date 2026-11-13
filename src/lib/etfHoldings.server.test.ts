import { describe, expect, it } from "vitest";
import {
  appFormEtfSymbol,
  bareEtfSymbol,
  normalizeUnderlyingSymbol,
  parseISharesHoldingsCsv,
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
