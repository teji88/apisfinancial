import { describe, expect, it } from "vitest";
import { calculateCppBenefit } from "../benefits/CppCalculator";
import { estimateGovernmentBenefits } from "../engines/BenefitEngine";
import type { PersonScenario } from "../domain/types";
import {
  CPP_BASE_MAX_2025,
  CPP_TOTAL_MAX_2026,
  CPP_ADDITIONAL_6YR_2025,
  OAS_DEFERRAL_TABLE_2026,
  OAS_PARTIAL_20YR,
  OAS_PARTIAL_27YR,
} from "./officialTestVectors";

/** Maximum earnings every year (well above YMPE/YAMPE). */
function maxHistory(fromYear: number, toYear: number) {
  const h = [];
  for (let y = fromYear; y <= toYear; y++) h.push({ year: y, earnings: 200000 });
  return h;
}

const oasPerson: PersonScenario = {
  role: "MAIN_USER",
  birthYear: 1960,
  birthMonth: 1,
  retirementAge: 65,
  cppAt65: 1000,
  cppStartAge: 65,
  oasStartAge: 65,
  oasResidenceYears: 40,
};

describe("official worked-example vectors", () => {
  it("Vector A: base CPP maximum at 65, January 2025 = $1,387.08/mo", () => {
    const result = calculateCppBenefit({
      birthYear: 1960,
      birthMonth: 1,
      earningsHistory: maxHistory(1978, 2024),
      retirementAge: 65,
      cppStartAge: 65,
      calculationYear: 2025,
    });
    // baseAnnual excludes the enhancement; /12 must hit the published max.
    expect(result.baseAnnual / 12).toBeCloseTo(CPP_BASE_MAX_2025.expected, 2);
  });

  it("Vector B: total CPP maximum at 65, January 2026 ≈ $1,507.65/mo", () => {
    const result = calculateCppBenefit({
      birthYear: 1960,
      birthMonth: 1,
      earningsHistory: maxHistory(1978, 2025),
      retirementAge: 65,
      cppStartAge: 65,
      calculationYear: 2026,
    });
    // Documented tolerance: our enhancement model is approximate (no
    // child-rearing drop-in, simplified phase-in); the engine lands within
    // ~$2.10/mo (0.14%) of the published maximum.
    expect(Math.abs(result.cppBaseMonthly - CPP_TOTAL_MAX_2026.expected)).toBeLessThan(5);
  });

  it("Vector C: 6 years of maximum additional CPP ≈ $46/mo (reference only)", () => {
    const result = calculateCppBenefit({
      birthYear: 1960,
      birthMonth: 1,
      earningsHistory: maxHistory(2019, 2024),
      retirementAge: 65,
      cppStartAge: 65,
      calculationYear: 2025,
    });
    // Loose guard: the enhancement slice is the least exact part of the model.
    // Catches gross breakage without enshrining the approximation as exact.
    const monthly = result.firstAdditionalAnnual / 12;
    expect(monthly).toBeGreaterThan(35);
    expect(monthly).toBeLessThan(55);
    expect(CPP_ADDITIONAL_6YR_2025.expected).toBe(46);
  });

  it("early/late factors: $1,507.65 at 65 → $964.90 at 60 / $2,140.86 at 70", () => {
    // DERIVED vectors: no official dollar example exists; the statutory
    // factors (0.6%/mo early, 0.7%/mo late) apply multiplicatively per
    // s.46(3.1) to the calculated age-65 pension. Tests the module via the
    // manual age-65 estimate path (no MPEA shift between start ages there).
    const base = { ...oasPerson, cppAt65: CPP_TOTAL_MAX_2026.expected };
    const opts = { inflationRate: 0, calendarYear: 2026 };
    const at60 = estimateGovernmentBenefits({ ...base, cppStartAge: 60 }, 60, 0, opts).cpp;
    const at70 = estimateGovernmentBenefits({ ...base, cppStartAge: 70 }, 70, 0, opts).cpp;
    expect(at60 / 12).toBeCloseTo(964.9, 1); // 1507.65 × 0.64 = 964.896
    expect(at70 / 12).toBeCloseTo(2140.86, 1); // 1507.65 × 1.42 = 2140.863
  });

  it("OAS deferral table: every row 65→70 matches the Service Canada example", () => {
    for (const row of OAS_DEFERRAL_TABLE_2026) {
      const oas = estimateGovernmentBenefits(
        { ...oasPerson, oasStartAge: row.startAge },
        row.startAge,
        0,
        { inflationRate: 0, calendarYear: 2026 },
      ).oas;
      expect(oas / 12).toBeCloseTo(row.expectedMonthly, 2);
    }
  });

  it("partial OAS: 20/40 and 27/40 of the full pension", () => {
    const opts = { inflationRate: 0, calendarYear: 2026 };
    const twenty = estimateGovernmentBenefits({ ...oasPerson, oasResidenceYears: 20 }, 65, 0, opts).oas;
    expect(twenty / 12).toBeCloseTo(OAS_PARTIAL_20YR.expected, 2);
    const twentySeven = estimateGovernmentBenefits({ ...oasPerson, oasResidenceYears: 27 }, 65, 0, opts).oas;
    expect(twentySeven / 12).toBeCloseTo(OAS_PARTIAL_27YR.expected, 2);
  });
});
