/**
 * Smith Manoeuvre / leveraged-investing tranche tracker.
 *
 * Implements the verified CRA tracing rules (ITA s.20(1)(c), Folio S3-F6-C1):
 * each re-borrow draw is a SEPARATE tranche (Singleton); deductibility turns
 * on the CURRENT DIRECT USE of the borrowed money, not the collateral
 * (para 1.92); the purpose test is objective at acquisition (Ludco, para 1.26).
 *
 * Per-tranche outputs: deductible interest for T1 line 22100, eligibility
 * status, and tracing-risk warnings. Informational only — not tax advice.
 */

export interface SmithTrancheInput {
  id: string;
  facility: string;
  drawDate: string;
  principal: number;
  rate: number;
  useOfFunds: string;
  eligible: boolean;
  purposeEvidence: string;
  interestPaidYtd: number;
  repayments: Array<{ date: string; amount: number }>;
  personalUse: boolean;
  personalUseDate: string | null;
  commingled: boolean;
  disposition: {
    date: string;
    proceeds: number;
    destination: "reinvested" | "personal" | "loan_repayment";
  } | null;
  s201Deemed: number;
  documents: string;
  /** AssetHoldingInput id this tranche's money bought (null = not linked). */
  holdingId?: string | null;
  /** Distributions the investments paid out (amount/date/destination). */
  distributions?: Array<{
    date: string;
    amount: number;
    destination: "mortgage" | "reinvested" | "personal";
  }>;
}

export interface TrancheAssessment {
  trancheId: string;
  facility: string;
  /** Outstanding balance ($). */
  outstanding: number;
  /** Whether interest remains deductible. */
  deductible: boolean;
  /** Deductible interest YTD for T1 line 22100. */
  deductibleInterestYtd: number;
  /** Tracing health: good (clean), warning (risks flagged), bad (not deductible). */
  health: "good" | "warning" | "bad";
  /** Tracing-risk warnings for this tranche. */
  warnings: string[];
}

export interface DistributionBreakdown {
  mortgage: number;
  reinvested: number;
  personal: number;
  total: number;
}

export interface SmithLedgerResult {
  tranches: TrancheAssessment[];
  totalDeductibleInterestYtd: number;
  /** Distributions received YTD across all tranches, by destination. */
  distributions: DistributionBreakdown;
  warnings: string[];
  disclaimer: string;
}

export const SMITH_DISCLAIMER =
  "Tracing analysis based on CRA Folio S3-F6-C1 and ITA s.20(1)(c) as verified " +
  "2026-10-09. For information and record-keeping only — not tax advice. " +
  "The onus to trace borrowed funds is on the taxpayer; keep source documents " +
  "and consider consulting a qualified tax professional.";

export const CRA_FILING_DISCLAIMER =
  "Apis Financial is an information and record-keeping tool only. We are not " +
  "liable for any errors, omissions, interest, or penalties arising from your " +
  "CRA filings. Verify every figure against your own records and consider " +
  "consulting a qualified tax professional before filing.";

const REGISTERED_RE = /\b(tfsa|rrsp|resp|rdsp|fhsa|dpsp)\b/i;
const NO_DIVIDEND_RE = /no\s*dividend|will not pay|does not pay/i;

export function assessSmithLedger(tranches: SmithTrancheInput[]): SmithLedgerResult {
  const assessments: TrancheAssessment[] = [];
  const ledgerWarnings: string[] = [];

  for (const t of tranches) {
    const warnings: string[] = [];
    const repaid = t.repayments.reduce((s, r) => s + Math.max(0, r.amount), 0);
    const outstanding = Math.max(0, t.principal - repaid);
    let deductible = true;

    // Q6: borrowing to fund registered accounts — never deductible.
    if (REGISTERED_RE.test(t.useOfFunds)) {
      deductible = false;
      warnings.push(
        "Destination is a registered account (TFSA/RRSP/RESP) — interest on money " +
          "borrowed to fund it is not deductible (CRA Line 22100).",
      );
    }

    // Purpose test at acquisition (Ludco/Cassan).
    if (!t.eligible) {
      deductible = false;
      warnings.push(
        "Destination is not classified as income-earning — fails the s.20(1)(c) use test.",
      );
    } else if (NO_DIVIDEND_RE.test(t.purposeEvidence)) {
      warnings.push(
        "Purpose evidence suggests no dividend/distribution policy — may fail the " +
          "purpose test (Folio para 1.70, Cassan).",
      );
    }

    // Current-use rule: personal use kills deductibility (para 1.35).
    if (t.personalUse) {
      deductible = false;
      warnings.push(
        `Personal use${t.personalUseDate ? ` on ${t.personalUseDate}` : ""} — ` +
          "deductibility ended under the current-use rule (para 1.35).",
      );
    }

    // Dispositions (Tennant / paras 1.36-1.41).
    if (t.disposition) {
      if (t.disposition.destination === "personal") {
        deductible = false;
        warnings.push(
          `Investment disposed ${t.disposition.date} with $${t.disposition.proceeds.toLocaleString()} ` +
            "used personally — deductibility ended (para 1.40).",
        );
      } else if (t.disposition.destination === "reinvested") {
        warnings.push(
          `Investment disposed ${t.disposition.date} — deductibility preserved only to the ` +
            "extent the borrowing is reflected in the replacement property (Tennant).",
        );
      }
    }

    // Commingling → apportionment regime (paras 1.42/1.43).
    if (t.commingled) {
      warnings.push(
        "Funds passed through an account with other cash — CRA applies flexible tracing " +
          "with timing constraints (para 1.42); in a mixed-use single account, repayments " +
          "reduce eligible and ineligible portions pro rata (para 1.43).",
      );
    }

    // s.20.1 deemed use after a loss disposition.
    if (t.s201Deemed > 0) {
      warnings.push(
        `s.20.1 deemed eligible balance of $${t.s201Deemed.toLocaleString()} tracked separately — ` +
          "confirm the deeming conditions are met (para 1.41).",
      );
    }

    if (!t.documents.trim()) {
      warnings.push(
        "No source-document pointers recorded — the onus to trace is on the taxpayer (para 1.32).",
      );
    }

    const isDeductible = deductible && outstanding > 0;
    assessments.push({
      trancheId: t.id,
      facility: t.facility,
      outstanding,
      deductible: isDeductible,
      deductibleInterestYtd: deductible ? Math.max(0, t.interestPaidYtd) : 0,
      health: !isDeductible ? "bad" : warnings.length > 0 ? "warning" : "good",
      warnings,
    });
  }

  const totalDeductibleInterestYtd = assessments.reduce((s, a) => s + a.deductibleInterestYtd, 0);

  const distributions: DistributionBreakdown = { mortgage: 0, reinvested: 0, personal: 0, total: 0 };
  for (const t of tranches) {
    for (const d of t.distributions ?? []) {
      const amt = Math.max(0, d.amount);
      distributions[d.destination] += amt;
      distributions.total += amt;
    }
  }

  if (tranches.length === 0) {
    ledgerWarnings.push("No tranches recorded yet.");
  }

  return { tranches: assessments, totalDeductibleInterestYtd, distributions, warnings: ledgerWarnings, disclaimer: SMITH_DISCLAIMER };
}
