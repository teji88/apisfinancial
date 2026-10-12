/**
 * Import dedupe: natural-key matching so re-uploading a file after an
 * interrupted save never creates duplicates.
 *
 * The natural key is: accountId | date | type | symbol | quantity | amount | price.
 * Symbols and types are compared case-insensitively; numbers are normalized
 * through Number() so "10.50" and "10.5" match.
 */

/** A ledger transaction in the shape needed for keying. */
export type KeyableLedgerTransaction = {
  account_id: string;
  transaction_date: string;
  transaction_type: string;
  /** Resolved symbol (via holdings), or "" when the row has no holding. */
  symbol: string;
  units: number;
  amount: number | null;
  price_per_unit: number;
};

/** An import row in the shape needed for keying. */
export type KeyableImportRow = {
  accountId: string;
  date: string | null;
  type: string | null;
  symbol: string | null;
  quantity: number | null;
  amount: number | null;
  price: number | null;
};

function normText(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

function normNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return String(Number(v));
}

export function ledgerTransactionKey(t: KeyableLedgerTransaction): string {
  return [
    t.account_id,
    (t.transaction_date ?? "").trim(),
    normText(t.transaction_type),
    normText(t.symbol),
    normNum(t.units),
    normNum(t.amount),
    normNum(t.price_per_unit),
  ].join("|");
}

export function importRowKey(r: KeyableImportRow): string {
  return [
    r.accountId,
    (r.date ?? "").trim(),
    normText(r.type),
    normText(r.symbol),
    normNum(r.quantity),
    normNum(r.amount),
    normNum(r.price),
  ].join("|");
}

/**
 * Split import rows into { fresh, skipped }: rows whose natural key already
 * exists in the ledger are skipped. Pure function — safe to unit test.
 */
export function filterNewRows<T extends KeyableImportRow>(
  rows: T[],
  ledger: KeyableLedgerTransaction[],
): { fresh: T[]; skipped: number } {
  const seen = new Set(ledger.map(ledgerTransactionKey));
  const fresh: T[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (seen.has(importRowKey(row))) {
      skipped += 1;
    } else {
      fresh.push(row);
      // Also guard against duplicates *within* the same file.
      seen.add(importRowKey(row));
    }
  }
  return { fresh, skipped };
}
