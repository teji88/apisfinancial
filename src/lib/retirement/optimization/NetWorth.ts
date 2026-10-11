/**
 * Net-worth tracking: liquid (investments + cash) vs illiquid (property),
 * minus the shared debt inventory.
 *
 * Liquid = investments + cash only (per the durable spec — "Total value"
 * elsewhere in the app is investments + cash; property is illiquid).
 */

export interface NetWorthInputs {
  homeValue: number;
  otherPropertyValue: number;
  cash: number;
  /** Investments: TFSA + RRSP + LIRA + non-registered. */
  investments: number;
  debts: Array<{ balance: number }>;
}

export interface NetWorthResult {
  liquidAssets: number;
  illiquidAssets: number;
  totalAssets: number;
  totalDebts: number;
  netWorth: number;
}

export function computeNetWorth(inputs: NetWorthInputs): NetWorthResult {
  const liquidAssets = Math.max(0, inputs.cash) + Math.max(0, inputs.investments);
  const illiquidAssets = Math.max(0, inputs.homeValue) + Math.max(0, inputs.otherPropertyValue);
  const totalAssets = liquidAssets + illiquidAssets;
  const totalDebts = inputs.debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
  return {
    liquidAssets,
    illiquidAssets,
    totalAssets,
    totalDebts,
    netWorth: totalAssets - totalDebts,
  };
}

export type DebtOwner = "self" | "partner" | "joint";

export interface OwnedDebt {
  balance: number;
  owner?: DebtOwner;
}

/**
 * Split debts into self / partner buckets for individual net-worth figures.
 * Untagged debts default to "self". Joint debts split 50/50. Household total
 * always equals self + partner (joint counted fully, not doubled).
 */
export function splitDebtsByOwner(debts: OwnedDebt[]): {
  selfDebts: number;
  partnerDebts: number;
  totalDebts: number;
} {
  let selfDebts = 0;
  let partnerDebts = 0;
  for (const d of debts) {
    const balance = Math.max(0, d.balance);
    const owner: DebtOwner = d.owner ?? "self";
    if (owner === "joint") {
      selfDebts += balance / 2;
      partnerDebts += balance / 2;
    } else if (owner === "partner") {
      partnerDebts += balance;
    } else {
      selfDebts += balance;
    }
  }
  return { selfDebts, partnerDebts, totalDebts: selfDebts + partnerDebts };
}
