/**
 * Asset-location optimizer — deterministic scoring of which account should
 * hold each investment (TFSA vs RRSP/RRIF vs non-registered).
 *
 * Tax rules verified against primary sources (ITA, Canada-US treaty, CRA
 * folios) in the October 2026 research pass — see
 * ~/workspace/user/files/asset-location-tax-rules.txt. Key results encoded:
 * - Interest / REIT "other income" → registered first (fully taxable).
 * - Eligible dividends: TFSA (0) > non-reg (DTC) > RRSP (DTC destroyed).
 * - US direct holdings: RRSP 0% via treaty Art XXI(2); TFSA 15% unrecoverable.
 * - VFV-style Canadian-listed US ETFs: 15% withheld at the FUND level,
 *   unrecoverable even in RRSP — only direct holdings get XXI(2).
 * - Swap ETFs: the deferral benefit exists ONLY in non-registered.
 * - Capital-gains inclusion 50% (ITA 38(a)); the 2/3 proposal was cancelled.
 *
 * "Annual tax drag" = Canadian tax payable for the year + unrecoverable
 * foreign withholding. RRSP figures are CURRENT-YEAR drag — tax is deferred,
 * not forgiven (withdrawals fully taxable per ITA 146(5)).
 *
 * Out of scope for v1: contribution-room bin-packing, ACB tracking,
 * US estate-tax exposure (flagged in research, not scored).
 */

export type HoldingTaxType =
  | "interest"
  | "eligibleDividend"
  | "canadianReit"
  | "usDirect"
  | "canadianListedUS"
  | "foreignNonUS"
  | "usReit"
  | "growthEquity"
  | "swapBased";

export type LocAccount = "TFSA" | "RRSP" | "NON_REGISTERED";

export interface LocatedHolding {
  id: string;
  name: string;
  taxType: HoldingTaxType;
  /** Current market value ($). */
  value: number;
  /** Annual distribution yield as a decimal (e.g. 0.035). Gross of withholding. */
  yield: number;
  /** Where it sits today. */
  account: LocAccount;
}

export interface LocationInputs {
  holdings: LocatedHolding[];
  /** Marginal tax rate as a decimal (e.g. 0.435). */
  marginalRate: number;
  /** Provincial DTC as % of grossed-up dividends (Alberta 2026 ≈ 0.08117). */
  provincialDtcRate?: number;
}

export interface HoldingScore {
  holdingId: string;
  name: string;
  currentAccount: LocAccount;
  /** Annual tax drag ($) per account. */
  dragByAccount: Record<LocAccount, number>;
  /** Accounts ranked best-first per the verified rules. */
  ranking: LocAccount[];
  bestAccount: LocAccount;
  /** Annual $ saved by moving to the best account (0 if already optimal). */
  annualSavingsIfMoved: number;
  /** Factual "why" text for the info/eye button — tax treatment, not advice. */
  explainer: string;
}

export interface LocationResult {
  scores: HoldingScore[];
  /** Suggested moves, highest savings first. */
  moves: Array<{
    holdingId: string;
    name: string;
    from: LocAccount;
    to: LocAccount;
    annualSavings: number;
  }>;
  totalAnnualSavings: number;
  warnings: string[];
  /** The UI must display this wherever results are shown. */
  disclaimer: string;
}

export const LOCATION_DISCLAIMER =
  "Tax-drag estimates based on current Canadian tax law and the assumptions shown. " +
  "For information only — not financial, tax, or investment advice. " +
  "Consider your full situation and consult a qualified professional.";

/**
 * Factual explainer per holding type, written for the info/eye button.
 * Describes tax treatment only — never a recommendation.
 */
export const HOLDING_EXPLAINERS: Record<HoldingTaxType, string> = {
  interest:
    "Interest is fully taxable as income in the year it's earned (ITA 12(1)(c)). " +
    "Inside a TFSA or RRSP no tax is payable currently, so interest-bearing holdings " +
    "face their highest annual tax drag in a non-registered account.",
  eligibleDividend:
    "Canadian eligible dividends get a gross-up and dividend tax credit in a non-registered " +
    "account, so they're taxed below your marginal rate. A TFSA pays no tax at all. In an " +
    "RRSP/RRIF the dividend character is lost — withdrawals are fully taxable as income — " +
    "so the credit is wasted there.",
  canadianReit:
    "Canadian REIT distributions are mostly 'other income' — fully taxable with no dividend " +
    "credit. That makes the non-registered account the highest-drag location; registered " +
    "accounts shelter the full amount currently. (Distribution breakdowns vary by fund.)",
  usDirect:
    "The US withholds 15% on dividends paid to Canadians. In an RRSP holding US securities " +
    "directly, the Canada-US treaty (Art. XXI(2)) reduces this to 0%. In a TFSA the 15% is " +
    "unrecoverable. In a non-registered account you can claim a foreign tax credit for it.",
  canadianListedUS:
    "When a Canadian ETF holds US stocks, the 15% US withholding happens inside the ETF " +
    "before you receive anything — and it can't be recovered, even in an RRSP. Only US " +
    "securities held directly by your RRSP get the 0% treaty rate. In a non-registered " +
    "account the foreign tax flows through to you for the credit.",
  foreignNonUS:
    "Foreign dividends generally face 15% withholding under Canada's tax treaties, " +
    "unrecoverable in TFSA/RRSP (except direct US holdings in an RRSP). In a non-registered " +
    "account the foreign tax credit offsets it — so non-registered wins only when your " +
    "marginal rate is below the withholding rate.",
  usReit:
    "US REIT dividends face 15% US withholding (treaty Art. X(7)(c)). Direct holdings in an " +
    "RRSP get 0% under Art. XXI(2); in a TFSA the 15% is unrecoverable; in a non-registered " +
    "account the foreign tax credit applies.",
  growthEquity:
    "A low-distribution equity ETF's main tax event is the eventual capital gain — 50% " +
    "inclusion, deferred until you sell. In a non-registered account you also pay tax on any " +
    "annual distributions. A TFSA shelters everything; an RRSP defers tax but converts the " +
    "gain to fully-taxable income on withdrawal.",
  swapBased:
    "Swap-based ETFs convert distributions into deferred capital gains — but that only matters " +
    "in a non-registered account. In a TFSA or RRSP the growth is already sheltered, so the " +
    "structure adds nothing there.",
};

const PROV_DTC_DEFAULT = 0.08117; // Alberta 2026, derived from published tables
const FEDERAL_DTC_GROSSUP_FACTOR = 0.38 * (6 / 11); // 0.20727

/** Effective Canadian tax rate on $1 of eligible-dividend cash. */
function eligibleDivEffRate(t: number, provDtc: number): number {
  return 1.38 * t - FEDERAL_DTC_GROSSUP_FACTOR - 1.38 * provDtc;
}

/** Annual drag ($) for one holding in one account. */
function drag(
  h: LocatedHolding,
  account: LocAccount,
  t: number,
  provDtc: number,
): number {
  const base = h.value * h.yield;
  switch (h.taxType) {
    case "interest":
      return account === "NON_REGISTERED" ? base * t : 0;
    case "eligibleDividend":
      return account === "NON_REGISTERED" ? base * eligibleDivEffRate(t, provDtc) : 0;
    case "canadianReit": {
      // Illustrative 60/15/10/15 other-income/cap-gains/eligible-div/ROC
      // breakdown — fund-specific, not statutory.
      if (account !== "NON_REGISTERED") return 0;
      return base * (0.6 * t + 0.15 * 0.5 * t + 0.1 * eligibleDivEffRate(t, provDtc));
    }
    case "usDirect":
      if (account === "RRSP") return 0; // treaty Art XXI(2), direct holdings
      if (account === "TFSA") return base * 0.15; // unrecoverable
      return base * t; // FTC via ITA 126; net drag ≈ t
    case "canadianListedUS":
    case "foreignNonUS":
      // 15% withheld at fund/source level, unrecoverable in registered.
      if (account === "NON_REGISTERED") return base * t;
      return base * 0.15;
    case "usReit":
      if (account === "RRSP") return 0; // XXI(2), direct, <10% holder
      if (account === "TFSA") return base * 0.15;
      return base * t;
    case "growthEquity":
      // Only the distribution yield drags annually; deferred gains excluded.
      return account === "NON_REGISTERED" ? base * eligibleDivEffRate(t, provDtc) : 0;
    case "swapBased":
      return 0; // no distributions; benefit is non-reg-only deferral (ranking handles it)
  }
}

/** Best-first account ranking per the verified rules. */
function ranking(taxType: HoldingTaxType, t: number): LocAccount[] {
  switch (taxType) {
    case "interest":
    case "canadianReit":
      return ["TFSA", "RRSP", "NON_REGISTERED"];
    case "eligibleDividend":
    case "growthEquity":
      // RRSP destroys the dividend tax credit / 50% inclusion character.
      return ["TFSA", "NON_REGISTERED", "RRSP"];
    case "usDirect":
    case "usReit":
      // RRSP 0% via XXI(2); then TFSA (15%) vs non-reg (t).
      return t < 0.15
        ? ["RRSP", "NON_REGISTERED", "TFSA"]
        : ["RRSP", "TFSA", "NON_REGISTERED"];
    case "canadianListedUS":
    case "foreignNonUS":
      // 15% unrecoverable in registered; non-reg wins only if t < 15%.
      return t < 0.15
        ? ["NON_REGISTERED", "TFSA", "RRSP"]
        : ["TFSA", "RRSP", "NON_REGISTERED"];
    case "swapBased":
      // The structure's value (deferral + 50% inclusion) exists only in non-reg.
      return ["NON_REGISTERED", "TFSA", "RRSP"];
  }
}

export function scoreAssetLocation(inputs: LocationInputs): LocationResult {
  const t = inputs.marginalRate;
  const provDtc = inputs.provincialDtcRate ?? PROV_DTC_DEFAULT;
  const warnings: string[] = [
    "RRSP $0 figures are current-year drag only — withdrawals are fully taxable as income (ITA 146(5)).",
  ];
  if (inputs.holdings.some((h) => h.taxType === "canadianReit")) {
    warnings.push(
      "Canadian REIT drag uses an illustrative 60/15/10/15 distribution breakdown — actual breakdowns are fund-specific.",
    );
  }
  if (t > 0.48) {
    warnings.push(
      "Marginal rate above Alberta's 48% top combined rate — figures are hypothetical sensitivity, not an Alberta bracket.",
    );
  }

  const scores: HoldingScore[] = inputs.holdings.map((h) => {
    const dragByAccount: Record<LocAccount, number> = {
      TFSA: drag(h, "TFSA", t, provDtc),
      RRSP: drag(h, "RRSP", t, provDtc),
      NON_REGISTERED: drag(h, "NON_REGISTERED", t, provDtc),
    };
    const rank = ranking(h.taxType, t);
    const bestAccount = rank[0]!;
    const annualSavingsIfMoved = Math.max(0, dragByAccount[h.account] - dragByAccount[bestAccount]);
    return {
      holdingId: h.id,
      name: h.name,
      currentAccount: h.account,
      dragByAccount,
      ranking: rank,
      bestAccount,
      annualSavingsIfMoved,
      explainer: HOLDING_EXPLAINERS[h.taxType],
    };
  });

  const moves = scores
    .filter((s) => s.annualSavingsIfMoved > 0.005)
    .map((s) => ({
      holdingId: s.holdingId,
      name: s.name,
      from: s.currentAccount,
      to: s.bestAccount,
      annualSavings: s.annualSavingsIfMoved,
    }))
    .sort((a, b) => b.annualSavings - a.annualSavings);

  return {
    scores,
    moves,
    totalAnnualSavings: moves.reduce((sum, m) => sum + m.annualSavings, 0),
    warnings,
    disclaimer: LOCATION_DISCLAIMER,
  };
}
