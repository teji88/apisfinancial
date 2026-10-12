import { describe, expect, it } from "vitest";
import { ledgerTransactionsToSmithRows, parsedStatementToSmithRows } from "./smithLedgerImport";
import { inferProposals } from "./smithCsvImport";
import type { Transaction } from "../finance";
import type { ParsedTransaction } from "../gemini-parse";

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    account_id: "a1",
    holding_id: null,
    transaction_type: "BUY",
    units: 0,
    price_per_unit: 0,
    amount: null,
    currency: "CAD",
    fx_rate: 1,
    fee: 0,
    transaction_date: "2024-01-15",
    ...over,
  };
}

const symbols = new Map([["h1", "VFV"]]);

describe("ledgerTransactionsToSmithRows", () => {
  it("maps buys/deposits to rows the inference treats as tranches", () => {
    const rows = ledgerTransactionsToSmithRows(
      [
        tx({ id: "b1", transaction_type: "BUY", holding_id: "h1", units: 10, price_per_unit: 100, transaction_date: "2024-02-01" }),
        tx({ id: "d1", transaction_type: "DEPOSIT", amount: 5000, transaction_date: "2024-01-10" }),
      ],
      symbols,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.date).toBe("2024-01-10"); // sorted by date
    expect(rows[1]!.symbol).toBe("VFV");
    expect(rows[1]!.amount).toBe(1000);
    const items = inferProposals(rows);
    expect(items.filter((i) => i.kind === "tranche")).toHaveLength(2);
  });

  it("maps sells/withdrawals to review outflows", () => {
    const rows = ledgerTransactionsToSmithRows(
      [
        tx({ transaction_type: "SELL", holding_id: "h1", units: 5, price_per_unit: 110, transaction_date: "2024-03-01" }),
        tx({ transaction_type: "WITHDRAWAL", amount: 2000, transaction_date: "2024-03-05" }),
      ],
      symbols,
    );
    const items = inferProposals(rows);
    expect(items.filter((i) => i.kind === "outflow")).toHaveLength(2);
  });

  it("drops fees and splits; treats DRIP as a distribution", () => {
    const rows = ledgerTransactionsToSmithRows(
      [
        tx({ transaction_type: "FEE", amount: 10, transaction_date: "2024-01-20" }),
        tx({ transaction_type: "SPLIT", units: 2, transaction_date: "2024-01-21" }),
        tx({ transaction_type: "DRIP", holding_id: "h1", amount: 50, transaction_date: "2024-01-22" }),
        tx({ transaction_type: "DIVIDEND", holding_id: "h1", amount: 60, transaction_date: "2024-01-23" }),
      ],
      symbols,
    );
    // FEE + SPLIT dropped; DRIP/DIVIDEND become rows the inference skips.
    expect(rows).toHaveLength(2);
    expect(inferProposals(rows)).toHaveLength(0);
  });

  it("converts USD amounts to CAD with the stored fx rate", () => {
    const rows = ledgerTransactionsToSmithRows(
      [tx({ transaction_type: "BUY", holding_id: "h1", currency: "USD", fx_rate: 1.35, units: 10, price_per_unit: 100 })],
      symbols,
    );
    expect(rows[0]!.amount).toBe(1350);
  });

  it("skips rows with bad dates or no usable amount", () => {
    const rows = ledgerTransactionsToSmithRows(
      [
        tx({ transaction_type: "BUY", transaction_date: "not-a-date", units: 1, price_per_unit: 1 }),
        tx({ transaction_type: "BUY", transaction_date: "2024-01-15", units: 0, price_per_unit: 0 }),
      ],
      symbols,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("parsedStatementToSmithRows", () => {
  const pt = (over: Partial<ParsedTransaction>): ParsedTransaction => ({
    date: "2024-02-10",
    type: "DEPOSIT",
    symbol: null,
    name: null,
    quantity: null,
    price: null,
    amount: 25000,
    currency: "CAD",
    account_type: "Non-Registered",
    account_hint: null,
    fee: 0,
    confidence: 0.95,
    note: null,
    ...over,
  });

  it("maps draws to tranche proposals and payments to outflows", () => {
    const rows = parsedStatementToSmithRows([
      pt({ type: "DEPOSIT", amount: 25000, date: "2024-02-10" }),
      pt({ type: "WITHDRAWAL", amount: 5000, date: "2024-05-01" }),
    ]);
    expect(rows).toHaveLength(2);
    const items = inferProposals(rows);
    expect(items.filter((i) => i.kind === "tranche")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "outflow")).toHaveLength(1);
  });

  it("drops fees and rows without usable date/amount", () => {
    const rows = parsedStatementToSmithRows([
      pt({ type: "FEE", amount: 120, date: "2024-03-01" }),
      pt({ type: "DEPOSIT", amount: null, date: "2024-03-02" }),
      pt({ type: "DEPOSIT", amount: 1000, date: "bad-date" }),
      pt({ type: null, amount: 1000, date: "2024-03-03" }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("derives amount from quantity x price when amount is missing", () => {
    const rows = parsedStatementToSmithRows([
      pt({ type: "DEPOSIT", amount: null, quantity: 100, price: 25.5 }),
    ]);
    expect(rows[0]!.amount).toBe(2550);
  });
});
