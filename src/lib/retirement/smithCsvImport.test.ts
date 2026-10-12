import { describe, expect, it } from "vitest";
import {
  inferProposals,
  parseSmithCsv,
  proposalCategory,
  type ProposedOutflow,
  type ProposedTranche,
} from "./smithCsvImport";

describe("parseSmithCsv", () => {
  it("parses a standard header layout", () => {
    const csv = `Date,Type,Symbol,Quantity,Price,Amount
2021-03-15,Buy,XEQT,100,25.50,2550.00
2021-04-01,Deposit,,,,"1,000.00"`;
    const { rows, skipped } = parseSmithCsv(csv);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2021-03-15",
      symbol: "XEQT",
      quantity: 100,
      price: 25.5,
      amount: 2550,
    });
    expect(rows[1]).toMatchObject({ date: "2021-04-01", amount: 1000, symbol: null });
  });

  it("tolerates alternate header names and column order", () => {
    const csv = `Trade Date,Action,Ticker,Shares,Total
2022-01-10,Bought,VFV,10,950`;
    const { rows } = parseSmithCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2022-01-10", symbol: "VFV", amount: 950 });
  });

  it("derives amount from quantity x price when amount is missing", () => {
    const csv = `Date,Type,Symbol,Quantity,Price
2022-06-01,Buy,VDY,20,40`;
    const { rows } = parseSmithCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(800);
  });

  it("skips rows with missing date or amount and reports them", () => {
    const csv = `Date,Type,Amount
2022-01-01,Buy,500
,Buy,500
2022-02-01,Buy,`;
    const { rows, skipped, warnings } = parseSmithCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(warnings.join(" ")).toMatch(/2 row\(s\) skipped/);
  });

  it("sorts rows by date ascending", () => {
    const csv = `Date,Type,Amount
2022-03-01,Deposit,300
2022-01-01,Deposit,100`;
    const { rows } = parseSmithCsv(csv);
    expect(rows[0].date).toBe("2022-01-01");
    expect(rows[1].date).toBe("2022-03-01");
  });

  it("returns a warning when no date column exists", () => {
    const { rows, warnings } = parseSmithCsv(`Foo,Bar\n1,2`);
    expect(rows).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/date/i);
  });
});

describe("inferProposals", () => {
  it("proposes a tranche for a stock purchase", () => {
    const items = inferProposals([
      { date: "2021-03-15", rawType: "Buy", symbol: "XEQT", quantity: 100, price: 25.5, amount: 2550 },
    ]);
    expect(items).toHaveLength(1);
    const t = items[0] as ProposedTranche;
    expect(t.kind).toBe("tranche");
    expect(t.date).toBe("2021-03-15");
    expect(t.amount).toBe(2550);
    expect(t.symbol).toBe("XEQT");
  });

  it("proposes a tranche for cash in without a symbol", () => {
    const items = inferProposals([
      { date: "2021-04-01", rawType: "Deposit", symbol: null, quantity: null, price: null, amount: 1000 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tranche");
    expect((items[0] as ProposedTranche).note).toMatch(/HELOC/i);
  });

  it("flags cash out as an outflow needing review — never a tranche", () => {
    const items = inferProposals([
      { date: "2022-05-01", rawType: "Withdrawal", symbol: null, quantity: null, price: null, amount: 2000 },
    ]);
    expect(items).toHaveLength(1);
    const o = items[0] as ProposedOutflow;
    expect(o.kind).toBe("outflow");
    expect(o.classification).toBeNull();
    expect(o.note).toMatch(/do not assume mortgage prepayment/i);
  });

  it("flags sells as outflows for review", () => {
    const items = inferProposals([
      { date: "2022-06-01", rawType: "Sell", symbol: "VFV", quantity: 10, price: 95, amount: 950 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("outflow");
    expect((items[0] as ProposedOutflow).note).toMatch(/confirm where the money went/i);
  });

  it("silently skips dividends (tracked separately)", () => {
    const items = inferProposals([
      { date: "2022-07-01", rawType: "Dividend", symbol: "XEQT", quantity: null, price: null, amount: 45 },
    ]);
    expect(items).toHaveLength(0);
  });

  it("flags unrecognized activity for manual classification instead of guessing", () => {
    const items = inferProposals([
      { date: "2022-08-01", rawType: "Journal", symbol: null, quantity: null, price: null, amount: 300 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("outflow");
    expect((items[0] as ProposedOutflow).classification).toBeNull();
  });
});

describe("proposalCategory", () => {
  it("buckets raw types for review filtering", () => {
    expect(proposalCategory("BUY")).toBe("Buy");
    expect(proposalCategory("Bought")).toBe("Buy");
    expect(proposalCategory("SELL")).toBe("Sell");
    expect(proposalCategory("Deposit")).toBe("Deposit");
    expect(proposalCategory("Transfer In")).toBe("Deposit");
    expect(proposalCategory("Withdrawal")).toBe("Withdrawal");
    // Note: "EFT out" matches the cash-in pattern first (same order as inferProposals),
    // so it is consistently categorized as a deposit, not a withdrawal.
    expect(proposalCategory("EFT out")).toBe("Deposit");
    expect(proposalCategory("Dividend")).toBe("Distribution");
    expect(proposalCategory("Journal")).toBe("Other");
    expect(proposalCategory("")).toBe("Other");
  });

  it("threads rawType through inferred proposals", () => {
    const items = inferProposals([
      { date: "2022-01-01", rawType: "BUY", symbol: "VFV", quantity: 10, price: 100, amount: 1000 },
      { date: "2022-02-01", rawType: "Withdrawal", symbol: null, quantity: null, price: null, amount: 500 },
    ]);
    expect(items[0].rawType).toBe("BUY");
    expect(items[1].rawType).toBe("Withdrawal");
  });
});
