/**
 * Official worked-example test vectors for CPP/OAS validation.
 *
 * Sourced 2026-10-08 from government/actuarial publications only
 * (32nd CPP Actuarial Report, Service Canada, ESDC OAS Toolkit).
 * Each vector is tagged AUTHORITATIVE (published worked example) or
 * DERIVED (computed from a published rule + a published maximum —
 * legitimate for testing the module, not an official example).
 *
 * Raw research: ~/workspace/user/files/CPP_OAS_Worked_Examples.txt
 */

export interface TestVector {
  /** Human-readable description of the inputs. */
  inputs: string;
  /** Expected output. */
  expected: number;
  /** Where the vector comes from. */
  source: string;
  /** AUTHORITATIVE = published worked example; DERIVED = rule × published max. */
  provenance: "AUTHORITATIVE" | "DERIVED";
}

/** Vector A — base CPP maximum at 65, January 2025. AUTHORITATIVE.
 * 25% × (5-year average YMPE 2021–2025 = $66,580) / 12 = $1,387.08/mo. */
export const CPP_BASE_MAX_2025: TestVector = {
  inputs:
    "Maximum contributor (earnings at/above YMPE every year), pension begins at 65, January 2025",
  expected: 1387.08,
  source: "32nd Actuarial Report on the CPP (OSFI); formula per Service Canada quarterly report",
  provenance: "AUTHORITATIVE",
};

/** Vector B — total CPP maximum (base + enhancement + CPP2) at 65, January 2026.
 * AUTHORITATIVE. Our enhancement model is approximate: the engine lands
 * within ~$2.10/mo (0.14%) — see the test for the documented tolerance. */
export const CPP_TOTAL_MAX_2026: TestVector = {
  inputs:
    "Maximum contributor at/above YMPE and YAMPE, pension begins at 65, January 2026",
  expected: 1507.65,
  source: "Service Canada — How much you could receive",
  provenance: "AUTHORITATIVE",
};

/** Vector C — additional (enhanced) CPP for 6 years of maximum additional
 * contributions (2019–2024), start at 65, January 2025. AUTHORITATIVE.
 * Our enhancement slice is approximate (no child-rearing drop-in, simplified
 * phase-in); the engine lands ~$41.79/mo vs $46/mo. Reference only. */
export const CPP_ADDITIONAL_6YR_2025: TestVector = {
  inputs:
    "Start at 65, January 1 2025; 6 years of maximum additional-CPP contributions (2019–2024)",
  expected: 46,
  source: "32nd Actuarial Report, Table 34",
  provenance: "AUTHORITATIVE",
};

/** CPP early-take-up factor at 60: 0.6%/mo × 60 mo = 36% reduction (×0.64).
 * DERIVED: no official dollar example exists; the factor is statutory
 * (CPP Act s.46(3.1)) and applies multiplicatively to the calculated pension. */
export const CPP_EARLY_60_FACTOR: TestVector = {
  inputs: "Calculated age-65 pension × 0.64",
  expected: 0.64,
  source: "CPP Act s.46(3.1); Service Canada (0.6%/mo, max 36% at 60)",
  provenance: "DERIVED",
};

/** CPP late-take-up factor at 70: 0.7%/mo × 60 mo = 42% increase (×1.42).
 * DERIVED: no official dollar example exists. */
export const CPP_LATE_70_FACTOR: TestVector = {
  inputs: "Calculated age-65 pension × 1.42",
  expected: 1.42,
  source: "CPP Act s.46(3.1)/(7); Service Canada (0.7%/mo, max 42% at 70)",
  provenance: "DERIVED",
};

/** OAS deferral table — full pension, Oct–Dec 2026 maximum $762.50 at 65,
 * deferred in whole years at 0.6%/mo simple (OAS Act s.7.1). AUTHORITATIVE:
 * every row verified arithmetically exact against the Service Canada table. */
export const OAS_DEFERRAL_TABLE_2026: { startAge: number; expectedMonthly: number; uplift: string }[] = [
  { startAge: 65, expectedMonthly: 762.5, uplift: "+0%" },
  { startAge: 66, expectedMonthly: 817.4, uplift: "+7.2%" },
  { startAge: 67, expectedMonthly: 872.3, uplift: "+14.4%" },
  { startAge: 68, expectedMonthly: 927.2, uplift: "+21.6%" },
  { startAge: 69, expectedMonthly: 982.1, uplift: "+28.8%" },
  { startAge: 70, expectedMonthly: 1037.0, uplift: "+36%" },
];
export const OAS_DEFERRAL_TABLE_SOURCE =
  "Service Canada — OAS: When to start your pension (Calculation example)";

/** Partial OAS — 20 years residence after 18 → 20/40 = 50% of full.
 * AUTHORITATIVE ratio; dollars derived from the Oct–Dec 2026 max. */
export const OAS_PARTIAL_20YR: TestVector = {
  inputs: "Lives in Canada, 20 years of residence after age 18",
  expected: 381.25,
  source: "Service Canada — OAS: When to start your pension; OAS Act s.3",
  provenance: "AUTHORITATIVE",
};

/** Partial OAS — 27 years residence → 27/40ths of the full pension.
 * AUTHORITATIVE (ESDC OAS Toolkit); dollars via the Oct–Dec 2026 max. */
export const OAS_PARTIAL_27YR: TestVector = {
  inputs: "27 years of residence after age 18",
  expected: 514.69, // 27/40 × 762.50 = 514.6875
  source: "ESDC OAS Toolkit",
  provenance: "AUTHORITATIVE",
};
