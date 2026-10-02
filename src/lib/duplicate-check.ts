/**
 * Duplicate detection for imports — flags rows that already exist in the
 * ledger so a twice-imported file does not double-count.
 *
 * A row is a probable duplicate when an existing ledger transaction matches
 * on account, date, type and symbol, plus the value (amount, or units × price
 * for trades). Matching is pure and side-effect free; the UI only warns, it
 * never blocks — the user still approves every row.
 */

export type LedgerTransactionLike = {
  account_id: string;
  holding_id: string | null;
  transaction_type: string;
  units: number;
  price_per_unit: number;
  amount: number | null;
  transaction_date: string;
};

export type ImportRowLike = {
  accountId: string;
  date: string | null;
  type: string | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
};

const EPS_AMOUNT = 0.01;
const EPS_UNITS = 1e-6;
const EPS_PRICE = 0.001;

function close(a: number, b: number, eps: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= eps;
}

function normSymbol(s: string | null | undefined): string | null {
  const t = (s ?? "").trim().toUpperCase();
  return t || null;
}

/**
 * Returns the indices of `rows` that probably duplicate an existing ledger
 * transaction. Rows without an account, date or type are never flagged.
 */
export function findDuplicateRows(
  rows: ImportRowLike[],
  ledger: LedgerTransactionLike[],
  holdingSymbols: Map<string, string>,
): Set<number> {
  const dupes = new Set<number>();
  // Index the ledger by account|date|type for a fast first pass.
  const byKey = new Map<string, LedgerTransactionLike[]>();
  for (const t of ledger) {
    const key = `${t.account_id}|${t.transaction_date}|${t.transaction_type}`;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }

  rows.forEach((row, i) => {
    if (!row.accountId || !row.date || !row.type) return;
    const key = `${row.accountId}|${row.date}|${row.type}`;
    const candidates = byKey.get(key);
    if (!candidates) return;
    const rowSymbol = normSymbol(row.symbol);
    for (const t of candidates) {
      const ledgerSymbol = t.holding_id ? normSymbol(holdingSymbols.get(t.holding_id)) : null;
      if (ledgerSymbol !== rowSymbol) continue;
      const amountMatch =
        row.amount != null &&
        t.amount != null &&
        close(row.amount, t.amount, EPS_AMOUNT);
      const tradeMatch =
        row.quantity != null &&
        row.price != null &&
        close(row.quantity, t.units, EPS_UNITS) &&
        close(row.price, t.price_per_unit, EPS_PRICE);
      // A derived amount (quantity × price) also counts: same trade, same total.
      const derivedMatch =
        row.quantity != null &&
        row.price != null &&
        t.amount != null &&
        close(row.quantity * row.price, t.amount, EPS_AMOUNT);
      if (amountMatch || tradeMatch || derivedMatch) {
        dupes.add(i);
        break;
      }
    }
  });
  return dupes;
}
