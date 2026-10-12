/**
 * HELOC tracker: reconstruct proposed tranches from an already-imported
 * linked investment account — no CSV upload needed.
 *
 * Converts ledger transactions into SmithCsvRow shapes so the exact same
 * inference rules (inferProposals) and review UI apply. Every output is a
 * PROPOSAL — nothing becomes a financial record until the user reviews and
 * confirms each item.
 *
 * Mapping notes:
 * - Ledger transaction types are canonical already ("BUY", "DEPOSIT", …) and
 *   match the inference keyword patterns case-insensitively.
 * - DRIP is treated as a dividend (tracked separately, not a draw).
 * - FEE and SPLIT rows are dropped (neither draws nor outflows).
 * - USD amounts are converted with the stored fx_rate so tranche principals
 *   are in CAD like the rest of the tracker.
 *
 * Also covers AI-read bank/HELOC statements (parsedStatementToSmithRows):
 * draws -> DEPOSIT (proposed tranche), payments -> WITHDRAWAL (outflow for
 * review), interest/fees -> dropped.
 */
import type { Transaction } from "../finance";
import type { ParsedTransaction } from "../gemini-parse";
import type { SmithCsvRow } from "./smithCsvImport";

const SKIP_TYPES = new Set(["FEE", "SPLIT"]);

export function ledgerTransactionsToSmithRows(
  transactions: Transaction[],
  symbolByHoldingId: Map<string, string>,
): SmithCsvRow[] {
  const rows: SmithCsvRow[] = [];
  for (const t of transactions) {
    const type = t.transaction_type;
    if (SKIP_TYPES.has(type)) continue;
    const date = t.transaction_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    let amount = t.amount ?? (t.units != null && t.price_per_unit != null ? Math.abs(t.units * t.price_per_unit) : null);
    if (amount == null || amount <= 0) continue;
    // Tranche principals are CAD; convert USD ledger amounts with the stored rate.
    if (t.currency === "USD" && t.fx_rate != null && t.fx_rate > 0) {
      amount = Math.round(amount * t.fx_rate * 100) / 100;
    }

    const symbolRaw = (t.holding_id ? symbolByHoldingId.get(t.holding_id) : undefined) ?? "";
    const symbol = symbolRaw.trim().toUpperCase();
    rows.push({
      date,
      rawType: type === "DRIP" ? "Dividend" : type,
      symbol: symbol && symbol !== "CASH" && symbol !== "-" ? symbol : null,
      quantity: t.units,
      price: t.price_per_unit,
      amount: Math.abs(amount),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

/**
 * Convert AI-read statement transactions (bank/HELOC statements via the
 * bank prompt, or brokerage statements) into SmithCsvRow shapes.
 * FEE rows and rows without a usable date/amount are dropped; low-confidence
 * rows are kept — the review UI shows them and the user decides.
 */
export function parsedStatementToSmithRows(transactions: ParsedTransaction[]): SmithCsvRow[] {
  const rows: SmithCsvRow[] = [];
  for (const t of transactions) {
    if (!t.type || t.type === "FEE") continue;
    if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) continue;
    const amount = t.amount ?? (t.quantity != null && t.price != null ? Math.abs(t.quantity * t.price) : null);
    if (amount == null || amount <= 0) continue;
    const symbol = (t.symbol ?? "").trim().toUpperCase();
    rows.push({
      date: t.date,
      rawType: t.type,
      symbol: symbol && symbol !== "CASH" && symbol !== "-" ? symbol : null,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      amount: Math.abs(amount),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}
