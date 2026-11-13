/**
 * Dashboard portfolio breakdown: aggregate open positions by symbol and
 * build the include/exclude account selection that drives it.
 *
 * Pure functions only — no storage or network access — so they are
 * unit-tested here and the dashboard route stays a thin wiring layer.
 * Percentages are always of the *selected* accounts: invested holdings
 * plus uninvested cash in those accounts, so the rows sum to 100%.
 */
import { ACCOUNT_TYPES, type Account, type HoldingPosition } from "./finance";

/** One symbol across the selected accounts, values summed. */
export type SymbolBreakdownRow = {
  symbol: string;
  name: string;
  marketValue: number;
  units: number;
  accountIds: string[];
};

/**
 * Merge positions by symbol (case-insensitive), summing market value and
 * units, largest first. The displayed symbol keeps the first-seen casing.
 */
export function groupPositionsBySymbol(positions: HoldingPosition[]): SymbolBreakdownRow[] {
  const bySymbol = new Map<string, SymbolBreakdownRow>();
  for (const p of positions) {
    const key = p.symbol.toUpperCase();
    const row = bySymbol.get(key);
    if (row) {
      row.marketValue += p.marketValue;
      row.units += p.units;
      if (!row.accountIds.includes(p.accountId)) row.accountIds.push(p.accountId);
      if (!row.name && p.name) row.name = p.name;
    } else {
      bySymbol.set(key, {
        symbol: p.symbol,
        name: p.name ?? "",
        marketValue: p.marketValue,
        units: p.units,
        accountIds: [p.accountId],
      });
    }
  }
  return [...bySymbol.values()].sort((a, b) => b.marketValue - a.marketValue);
}

export type BreakdownRow = {
  id: string;
  label: string;
  detail: string;
  marketValue: number;
  /** Share of the selected accounts' invested + cash total, 0–100. */
  pct: number;
  /** Summed units; null for the cash row. */
  units: number | null;
};

/**
 * Turn grouped symbol rows plus the selected accounts' uninvested cash
 * into display rows with percentages. The cash row is included only when
 * cash is positive; with a zero total every percentage is 0.
 */
export function buildBreakdownRows(symbolRows: SymbolBreakdownRow[], cash: number): BreakdownRow[] {
  const invested = symbolRows.reduce((s, r) => s + r.marketValue, 0);
  const cashValue = cash > 0 ? cash : 0;
  const total = invested + cashValue;
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const rows: BreakdownRow[] = symbolRows.map((r) => {
    const detailParts = [
      r.name,
      r.accountIds.length > 1 ? `${r.accountIds.length} accounts` : null,
    ].filter((part): part is string => Boolean(part));
    return {
      id: `symbol:${r.symbol.toUpperCase()}`,
      label: r.symbol,
      detail: detailParts.join(" · "),
      marketValue: r.marketValue,
      pct: pct(r.marketValue),
      units: r.units,
    };
  });
  if (cashValue > 0) {
    rows.push({
      id: "cash",
      label: "Cash",
      detail: "Uninvested cash in selected accounts",
      marketValue: cashValue,
      pct: pct(cashValue),
      units: null,
    });
  }
  return rows;
}

/** A share-of-portfolio percentage, e.g. 12.34% (no +/- sign). */
export function formatShare(pct: number): string {
  if (!isFinite(pct)) return "—";
  return `${pct.toFixed(2)}%`;
}

/** Only the account fields the picker needs. */
export type AccountPick = Pick<Account, "id" | "account_name" | "account_type">;

export type AccountTypeGroup = {
  type: string;
  accounts: AccountPick[];
};

/**
 * Group accounts by type for the picker, in the canonical ACCOUNT_TYPES
 * order first (TFSA, RRSP, …, Non-Registered), then any other types
 * alphabetically (e.g. RRIF, LIF).
 */
export function groupAccountsByType(accounts: AccountPick[]): AccountTypeGroup[] {
  const order = new Map<string, number>(ACCOUNT_TYPES.map((t, i) => [t, i]));
  const groups = new Map<string, AccountPick[]>();
  for (const a of accounts) {
    const type = (a.account_type ?? "").trim() || "Other";
    const list = groups.get(type);
    if (list) list.push(a);
    else groups.set(type, [a]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const oa = order.get(a);
      const ob = order.get(b);
      if (oa !== undefined && ob !== undefined) return oa - ob;
      if (oa !== undefined) return -1;
      if (ob !== undefined) return 1;
      return a.localeCompare(b);
    })
    .map(([type, list]) => ({ type, accounts: list }));
}

/**
 * Reconcile a stored selection against the accounts in the current view.
 * - Nothing stored yet (first visit): everything.
 * - Stored selection with no overlap (e.g. the family view changed):
 *   everything in the new view.
 * - Stored empty array (the user unchecked every account): stays empty.
 * Otherwise the stored ids that are still available, in view order.
 */
export function sanitizeSelection(stored: string[] | null, availableIds: string[]): string[] {
  if (stored == null) return [...availableIds];
  if (stored.length === 0) return [];
  const kept = availableIds.filter((id) => stored.includes(id));
  return kept.length > 0 ? kept : [...availableIds];
}

/** Add one account to the selection, or remove it if already selected. */
export function toggleAccountId(selected: string[], accountId: string): string[] {
  return selected.includes(accountId)
    ? selected.filter((id) => id !== accountId)
    : [...selected, accountId];
}

/**
 * Toggle a whole type group: if every account in the group is selected,
 * remove them all; otherwise add the missing ones.
 */
export function toggleAccountType(selected: string[], typeIds: string[]): string[] {
  const allSelected = typeIds.length > 0 && typeIds.every((id) => selected.includes(id));
  if (allSelected) return selected.filter((id) => !typeIds.includes(id));
  return [...selected, ...typeIds.filter((id) => !selected.includes(id))];
}
