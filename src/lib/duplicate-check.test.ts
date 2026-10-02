import { describe, expect, it } from "vitest";
import { findDuplicateRows, type LedgerTransactionLike } from "./duplicate-check";

const HOLDINGS = new Map([
  ["h1", "AAPL"],
  ["h2", "XEQT.TO"],
]);

function ledger(over: Partial<LedgerTransactionLike> = {}): LedgerTransactionLike {
  return {
    account_id: "acct-1",
    holding_id: "h1",
    transaction_type: "BUY",
    units: 10,
    price_per_unit: 150,
    amount: null,
    transaction_date: "2026-01-05",
    ...over,
  };
}

describe("findDuplicateRows", () => {
  it("flags an identical trade by units and price", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-01-05",
          type: "BUY",
          symbol: "AAPL",
          quantity: 10,
          price: 150,
          amount: null,
        },
      ],
      [ledger()],
      HOLDINGS,
    );
    expect(dupes.has(0)).toBe(true);
  });

  it("flags a cash transaction by amount", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-02-01",
          type: "DEPOSIT",
          symbol: null,
          quantity: null,
          price: null,
          amount: 1000,
        },
      ],
      [ledger({ holding_id: null, transaction_type: "DEPOSIT", units: 0, price_per_unit: 0, amount: 1000, transaction_date: "2026-02-01" })],
      HOLDINGS,
    );
    expect(dupes.has(0)).toBe(true);
  });

  it("flags via derived amount when the ledger stored a cash total", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-01-05",
          type: "BUY",
          symbol: "AAPL",
          quantity: 10,
          price: 150,
          amount: null,
        },
      ],
      [ledger({ amount: 1500 })],
      HOLDINGS,
    );
    expect(dupes.has(0)).toBe(true);
  });

  it("does not flag when the symbol differs", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-01-05",
          type: "BUY",
          symbol: "MSFT",
          quantity: 10,
          price: 150,
          amount: null,
        },
      ],
      [ledger()],
      HOLDINGS,
    );
    expect(dupes.size).toBe(0);
  });

  it("does not flag when the date, account or type differs", () => {
    const row = {
      accountId: "acct-1",
      date: "2026-01-05",
      type: "BUY",
      symbol: "AAPL",
      quantity: 10,
      price: 150,
      amount: null,
    };
    expect(findDuplicateRows([{ ...row, date: "2026-01-06" }], [ledger()], HOLDINGS).size).toBe(0);
    expect(findDuplicateRows([{ ...row, accountId: "acct-2" }], [ledger()], HOLDINGS).size).toBe(0);
    expect(findDuplicateRows([{ ...row, type: "SELL" }], [ledger()], HOLDINGS).size).toBe(0);
  });

  it("does not flag when the value differs", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-01-05",
          type: "BUY",
          symbol: "AAPL",
          quantity: 20,
          price: 150,
          amount: null,
        },
      ],
      [ledger()],
      HOLDINGS,
    );
    expect(dupes.size).toBe(0);
  });

  it("never flags rows missing account, date or type", () => {
    const rows = [
      { accountId: "", date: "2026-01-05", type: "BUY", symbol: "AAPL", quantity: 10, price: 150, amount: null },
      { accountId: "acct-1", date: null, type: "BUY", symbol: "AAPL", quantity: 10, price: 150, amount: null },
      { accountId: "acct-1", date: "2026-01-05", type: null, symbol: "AAPL", quantity: 10, price: 150, amount: null },
    ];
    expect(findDuplicateRows(rows, [ledger()], HOLDINGS).size).toBe(0);
  });

  it("tolerates tiny float differences", () => {
    const dupes = findDuplicateRows(
      [
        {
          accountId: "acct-1",
          date: "2026-01-05",
          type: "BUY",
          symbol: "aapl",
          quantity: 10.0000001,
          price: 149.9999,
          amount: null,
        },
      ],
      [ledger()],
      HOLDINGS,
    );
    expect(dupes.has(0)).toBe(true);
  });
});
