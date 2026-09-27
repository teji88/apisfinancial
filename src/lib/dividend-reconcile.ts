/**
 * Dividend reconciliation: compares every historical dividend a holding paid
 * (since it was first bought) against what is recorded in the ledger.
 *
 * Withholding rules (Canada–US treaty, Article XXI):
 * - US-listed securities in RRSP / Spousal RRSP / LIRA / LRSP / RRIF / LIF: 0% withheld.
 * - US-listed securities in TFSA / RESP / RDSP / FHSA / non-registered: 15% withheld.
 * - Canadian-listed securities: no withholding in any account.
 */

import { isDividendType } from "./dividends";
import { splitRatio, type Account, type Holding, type Transaction } from "./finance";

export type DividendEvent = {
  exDate: string;
  payDate: string | null;
  amount: number;
  currency: string;
};

export const MATCH_WINDOW_DAYS = 25;
export const AMOUNT_TOLERANCE = 0.2;
const US_WHT = 0.15;

const TREATY_EXEMPT = ["RRSP", "SPOUSAL RRSP", "LIRA", "LRSP", "RRIF", "LIF", "PRIF", "RLIF"];

export function isUsListed(holding: Holding, event?: DividendEvent): boolean {
  const s = holding.symbol.toUpperCase();
  if (/\.(TO|V|NE|CN)$/.test(s) || /^(TSX|TSE|TOR|CVE|TSXV):/.test(s)) return false;
  if (event) return event.currency === "USD";
  return holding.currency === "USD";
}

/** Expected foreign withholding rate for a holding in this account. */
export function withholdingRate(account: Account | undefined, holding: Holding, event?: DividendEvent) {
  if (!isUsListed(holding, event)) return 0;
  const type = (account?.account_type ?? "").toUpperCase();
  if (TREATY_EXEMPT.includes(type)) return 0;
  return US_WHT;
}

function dayDiff(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** Units held at the close of the day before `exDate`. */
export function unitsBefore(txns: Transaction[], exDate: string): number {
  let units = 0;
  for (const t of txns) {
    if (t.transaction_date >= exDate) break;
    const type = t.transaction_type;
    if (type === "BUY" || type === "DRIP") units += t.units || 0;
    else if (type === "SELL") units = Math.max(0, units - (t.units || 0));
    else if (type === "SPLIT") units *= splitRatio(t);
  }
  return units;
}

/** Recorded dividend expressed in the listing currency. */
function recordedInListing(t: Transaction, listingCurrency: string): number {
  const raw = t.amount != null && t.amount !== 0 ? t.amount : (t.units || 0) * (t.price_per_unit || 0);
  if (t.currency === listingCurrency) return raw;
  const fx = t.fx_rate || 1;
  // Recorded in CAD for a USD listing (or vice-versa): convert with the stored rate.
  if (listingCurrency === "USD" && t.currency === "CAD") return fx > 0 ? raw / fx : raw;
  if (listingCurrency === "CAD" && t.currency === "USD") return raw * fx;
  return raw;
}

export type SuggestionKind = "missing" | "fix";

export type DividendSuggestion = {
  key: string;
  kind: SuggestionKind;
  holdingId: string;
  accountId: string;
  symbol: string;
  currency: string;
  exDate: string;
  payDate: string;
  units: number;
  perShare: number;
  gross: number;
  withholdingRate: number;
  /** Amount that should be in the ledger (net of any legitimate withholding). */
  expected: number;
  /** For fixes: the existing transaction and what it currently says. */
  transactionId?: string | undefined;
  recordedAmount?: number | undefined;
  recordedDate?: string | undefined;
  reasons: string[];
};

export function reconcileDividends(
  holdings: Holding[],
  accounts: Account[],
  transactions: Transaction[],
  eventsBySymbol: Record<string, DividendEvent[]>,
  today = new Date().toISOString().slice(0, 10),
): { suggestions: DividendSuggestion[]; covered: Set<string> } {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const byHolding = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.holding_id) continue;
    const list = byHolding.get(t.holding_id) ?? [];
    list.push(t);
    byHolding.set(t.holding_id, list);
  }

  const out: DividendSuggestion[] = [];
  const covered = new Set<string>();

  for (const h of holdings) {
    const events = eventsBySymbol[h.symbol.toUpperCase()];
    if (!events) continue;
    covered.add(h.id);
    const txns = (byHolding.get(h.id) ?? [])
      .slice()
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    const firstBuy = txns.find((t) => t.transaction_type === "BUY" || t.transaction_type === "DRIP");
    if (!firstBuy) continue;
    const recorded = txns.filter((t) => isDividendType(t.transaction_type));
    const used = new Set<string>();
    const account = accountById.get(h.account_id);

    for (const ev of events) {
      if (ev.exDate <= firstBuy.transaction_date) continue;
      const payDate = ev.payDate ?? ev.exDate;
      if (payDate > today) continue;
      const units = unitsBefore(txns, ev.exDate);
      if (units <= 1e-9) continue;

      const currency = ev.currency || h.currency;
      const gross = units * ev.amount;
      const rate = withholdingRate(account, h, ev);
      const expected = gross * (1 - rate);
      const base = {
        holdingId: h.id,
        accountId: h.account_id,
        symbol: h.symbol,
        currency,
        exDate: ev.exDate,
        payDate,
        units,
        perShare: ev.amount,
        gross,
        withholdingRate: rate,
        expected,
      };

      // Nearest unused recorded dividend within ±25 days of the pay date.
      let match: Transaction | null = null;
      let best = Infinity;
      for (const t of recorded) {
        if (used.has(t.id)) continue;
        const d = Math.abs(dayDiff(t.transaction_date, payDate));
        const dEx = Math.abs(dayDiff(t.transaction_date, ev.exDate));
        const dist = Math.min(d, dEx);
        if (dist <= MATCH_WINDOW_DAYS && dist < best) {
          best = dist;
          match = t;
        }
      }

      if (!match) {
        out.push({ ...base, key: `${h.id}|${ev.exDate}`, kind: "missing", reasons: [] });
        continue;
      }
      used.add(match.id);
      if (match.transaction_type === "DRIP") continue; // Reinvested — amount recorded as units.

      const amt = recordedInListing(match, currency);
      const reasons: string[] = [];
      const diff = expected > 0 ? (amt - expected) / expected : 0;

      if (Math.abs(diff) > 0.02) {
        const netIfWithheld = gross * (1 - US_WHT);
        const looksWithheld = Math.abs(amt - netIfWithheld) / netIfWithheld <= 0.02;
        const looksGross = Math.abs(amt - gross) / gross <= 0.02;
        if (rate === 0 && looksWithheld && isUsListed(h, ev)) {
          reasons.push(
            `${account?.account_type ?? "This account"} is exempt from US withholding under the tax treaty — the full ${gross.toFixed(2)} ${currency} should have been paid. If your broker withheld tax, ask them to reverse it.`,
          );
        } else if (rate > 0 && looksGross) {
          reasons.push(
            `Recorded the gross amount — US dividends in a ${account?.account_type ?? "this account"} have 15% withheld, so ${expected.toFixed(2)} ${currency} would have landed.`,
          );
        } else if (Math.abs(diff) <= AMOUNT_TOLERANCE) {
          reasons.push(
            `Amount is ${(diff * 100).toFixed(1)}% off the expected ${expected.toFixed(2)} ${currency} — possibly a typing error.`,
          );
        } else {
          reasons.push(
            `Amount differs by ${(diff * 100).toFixed(0)}% from the expected ${expected.toFixed(2)} ${currency}. Check the units held or whether this entry belongs to another payment.`,
          );
        }
      }
      const dateGap = dayDiff(match.transaction_date, payDate);
      if (Math.abs(dateGap) > 3) {
        reasons.push(
          `Recorded on ${match.transaction_date}, but the payment date was ${payDate} (${Math.abs(dateGap)} days ${dateGap > 0 ? "late" : "early"}).`,
        );
      }
      if (reasons.length > 0) {
        out.push({
          ...base,
          key: `${h.id}|${ev.exDate}|fix`,
          kind: "fix",
          transactionId: match.id,
          recordedAmount: amt,
          recordedDate: match.transaction_date,
          reasons,
        });
      }
    }
  }

  out.sort((a, b) => b.payDate.localeCompare(a.payDate));
  return { suggestions: out, covered };
}
