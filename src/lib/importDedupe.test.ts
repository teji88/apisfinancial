import { describe, expect, it } from "vitest";
import {
  filterNewRows,
  importRowKey,
  ledgerTransactionKey,
  type KeyableImportRow,
  type KeyableLedgerTransaction,
} from "./importDedupe";

const ledgerRow: KeyableLedgerTransaction = {
  account_id: "acc-1",
  transaction_date: "2026-01-15",
  transaction_type: "BUY",
  symbol: "XEQT",
  units: 10,
  amount: null,
  price_per_unit: 32.5,
};

const importRow: KeyableImportRow = {
  accountId: "acc-1",
  date: "2026-01-15",
  type: "BUY",
  symbol: "XEQT",
  quantity: 10,
  amount: null,
  price: 32.5,
};

describe("ledgerTransactionKey / importRowKey", () => {
  it("matches an identical row across ledger and import shapes", () => {
    expect(importRowKey(importRow)).toBe(ledgerTransactionKey(ledgerRow));
  });

  it("is case-insensitive on symbol and type", () => {
    const lower = { ...importRow, symbol: "xeqt", type: "buy" };
    expect(importRowKey(lower)).toBe(ledgerTransactionKey(ledgerRow));
  });

  it("normalizes numeric formatting (10.50 vs 10.5)", () => {
    const alt = { ...importRow, quantity: 10.5, price: 32.5 };
    const ledgerAlt = { ...ledgerRow, units: 10.5 };
    expect(importRowKey(alt)).toBe(ledgerTransactionKey(ledgerAlt));
  });

  it("does not match when the date differs", () => {
    const other = { ...importRow, date: "2026-01-16" };
    expect(importRowKey(other)).not.toBe(ledgerTransactionKey(ledgerRow));
  });

  it("does not match when the quantity differs (near miss)", () => {
    const other = { ...importRow, quantity: 11 };
    expect(importRowKey(other)).not.toBe(ledgerTransactionKey(ledgerRow));
  });

  it("does not match when the account differs", () => {
    const other = { ...importRow, accountId: "acc-2" };
    expect(importRowKey(other)).not.toBe(ledgerTransactionKey(ledgerRow));
  });

  it("does not match when the type differs", () => {
    const other = { ...importRow, type: "SELL" };
    expect(importRowKey(other)).not.toBe(ledgerTransactionKey(ledgerRow));
  });
});

describe("filterNewRows", () => {
  it("skips rows already in the ledger and keeps the rest", () => {
    const fresh: KeyableImportRow = { ...importRow, date: "2026-02-01" };
    const { fresh: kept, skipped } = filterNewRows([importRow, fresh], [ledgerRow]);
    expect(kept).toEqual([fresh]);
    expect(skipped).toBe(1);
  });

  it("returns everything fresh when the ledger is empty", () => {
    const { fresh, skipped } = filterNewRows([importRow], []);
    expect(fresh).toEqual([importRow]);
    expect(skipped).toBe(0);
  });

  it("dedupes duplicates within the same file", () => {
    const dup = { ...importRow };
    const { fresh, skipped } = filterNewRows([importRow, dup], []);
    expect(fresh).toEqual([importRow]);
    expect(skipped).toBe(1);
  });

  it("handles an empty import", () => {
    const { fresh, skipped } = filterNewRows([], [ledgerRow]);
    expect(fresh).toEqual([]);
    expect(skipped).toBe(0);
  });
});
