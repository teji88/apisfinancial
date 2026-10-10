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
