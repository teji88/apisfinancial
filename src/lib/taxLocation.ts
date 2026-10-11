/**
 * Tax-location assessment for dashboard holdings: flags US-listed distributing
 * holdings sitting outside treaty-exempt accounts, where 15% US withholding
 * leaks every year.
 *
 * v1 scope: US withholding drag only (mechanical: yield x 15% x market value).
 * Canadian-dividend / interest placement needs the user's marginal rate and is
 * intentionally out of scope. All dollar figures are estimates.
 *
 * Informational only — never advice. The user weighs their own situation.
 */

/** US treaty withholding rate on dividends paid to Canadians. */
export const US_WITHHOLDING_RATE = 0.15;

/** Annual drag below this ($/yr) is not worth flagging. */
export const TAX_LOCATION_DRAG_THRESHOLD = 25;

/**
 * Account types where the Canada-US treaty eliminates withholding on US
 * dividends (treaty Article X). FHSA/RESP/RDSP/TFSA are NOT exempt.
 */
export const TREATY_EXEMPT_ACCOUNT_TYPES = [
  "RRSP",
  "SPOUSAL RRSP",
  "LIRA",
  "LRSP",
  "RRIF",
  "LIF",
  "PRIF",
  "RLIF",
];

export function isTreatyExemptAccountType(accountType: string | undefined | null): boolean {
  if (!accountType) return false;
  return TREATY_EXEMPT_ACCOUNT_TYPES.includes(accountType.trim().toUpperCase());
}

/** Account types where withheld tax is at least partly recoverable. */
export function isTaxableAccountType(accountType: string | undefined | null): boolean {
  if (!accountType) return false;
  const t = accountType.trim().toUpperCase();
  return t === "NON-REGISTERED" || t === "CORPORATE";
}

export type TaxLocationStatus = "ok" | "flag" | "hint" | "unknown";

export interface TaxLocationInput {
  /** Position currency, e.g. "USD" for US-listed. */
  currency: string;
  /** Market value in CAD. */
  marketValueCad: number;
  /** Distribution yield in PERCENT (as stored on quotes), or null when unknown. */
  dividendYieldPct: number | null | undefined;
  /** Account type label, e.g. "TFSA", "RRSP", "Non-Registered". */
  accountType: string | undefined | null;
  /** Whether the user holds at least one treaty-exempt account. */
  hasTreatyExemptAccount: boolean;
}

export interface TaxLocationAssessment {
  status: TaxLocationStatus;
  /** Short cell text; null for ok (green tick) and unknown (blank cell). */
  message: string | null;
  /** Tooltip explaining the math behind the cell. */
  tooltip: string;
  /** Estimated annual withholding drag in CAD. 0 when not computable. */
  annualDrag: number;
}

/**
 * Assess one position. Pure function — no I/O.
 *
 * Rules:
 * - Treaty-exempt account -> ok (no drag possible).
 * - Non-USD currency -> unknown (v1 only models US withholding).
 * - No yield data -> unknown (never guess a claim).
 * - Drag < $25/yr -> ok (materiality threshold; e.g. NVDA-type growth in TFSA).
 * - Drag >= $25/yr with a treaty-exempt account available -> flag.
 * - Drag >= $25/yr without one -> hint (softer, not actionable).
 */
export function assessTaxLocation(input: TaxLocationInput): TaxLocationAssessment {
  const accountType = input.accountType ?? "";

  if (isTreatyExemptAccountType(accountType)) {
    return {
      status: "ok",
      message: null,
      tooltip:
        "No US withholding here — this account type is exempt under the Canada-US tax treaty.",
      annualDrag: 0,
    };
  }

  if ((input.currency ?? "").trim().toUpperCase() !== "USD") {
    return {
      status: "unknown",
      message: null,
      tooltip: "Not enough data to assess tax location.",
      annualDrag: 0,
    };
  }

  const yieldPct = input.dividendYieldPct;
  if (yieldPct == null || Number.isNaN(yieldPct)) {
    return {
      status: "unknown",
      message: null,
      tooltip: "Not enough data to assess tax location.",
      annualDrag: 0,
    };
  }

  const annualDrag =
    (Math.max(0, yieldPct) / 100) * US_WITHHOLDING_RATE * Math.max(0, input.marketValueCad);

  if (annualDrag < TAX_LOCATION_DRAG_THRESHOLD) {
    const dragText = `~$${annualDrag.toFixed(2)}/yr`;
    const isTfsa = accountType.trim().toUpperCase() === "TFSA";
    return {
      status: "ok",
      message: null,
      tooltip: isTfsa
        ? `US withholding costs ${dragText} here, but your growth stays tax-free — TFSA is the right home for this.`
        : `Estimated US withholding drag is ${dragText} — too small to act on.`,
      annualDrag,
    };
  }

  const dragText = `~$${Math.round(annualDrag).toLocaleString("en-CA")}/yr`;
  const recoverability = isTaxableAccountType(accountType)
    ? "The 15% is withheld, but it is partly recoverable through the foreign tax credit at tax time."
    : "The 15% US withholding is unrecoverable in this account type.";

  if (input.hasTreatyExemptAccount) {
    return {
      status: "flag",
      message: `Better in RRSP — losing ${dragText}`,
      tooltip: `Estimated ${dragText} lost to 15% US withholding. ${recoverability} Estimate for information only — consider your full situation.`,
      annualDrag,
    };
  }

  return {
    status: "hint",
    message: "Consider an RRSP for future US purchases",
    tooltip: `Estimated ${dragText} lost to 15% US withholding. ${recoverability} You don't hold a treaty-exempt account, so there is nowhere better to put this today. Estimate for information only — consider your full situation.`,
    annualDrag,
  };
}

/** Sum of actionable (flagged) drags only — hints and unknowns never count. */
export function totalActionableDrag(assessments: TaxLocationAssessment[]): number {
  return assessments
    .filter((a) => a.status === "flag")
    .reduce((sum, a) => sum + a.annualDrag, 0);
}
