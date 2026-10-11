import { describe, expect, it } from "vitest";
import {
  SAVINGS_DISCLAIMER,
  SPOUSAL_GAP_THRESHOLD,
  suggestSavingsAllocation,
  type SavingsAllocatorInputs,
} from "./SavingsAllocation";

const base: SavingsAllocatorInputs = {
  annualSavings: 20_000,
  salary: 100_000,
  currentMarginalRate: 0.4,
  retirementMarginalRate: 0.3,
  employerMatch: { offered: false, matchRate: 0, maxOfSalary: 0 },
  married: false,
};

describe("suggestSavingsAllocation", () => {
  it("captures the full employer match first", () => {
    const r = suggestSavingsAllocation({
      ...base,
      employerMatch: { offered: true, matchRate: 0.5, maxOfSalary: 0.06 },
    });
    expect(r.steps[0].bucket).toBe("employer_match");
    expect(r.steps[0].amount).toBe(6_000); // 6% of 100k salary
    expect(r.totalAllocated).toBe(20_000);
  });

  it("match is capped by available savings", () => {
    const r = suggestSavingsAllocation({
      ...base,
      annualSavings: 3_000,
      employerMatch: { offered: true, matchRate: 0.5, maxOfSalary: 0.06 },
    });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].bucket).toBe("employer_match");
    expect(r.steps[0].amount).toBe(3_000);
  });

  it("skips the match step when not offered", () => {
    const r = suggestSavingsAllocation(base);
    expect(r.steps[0].bucket).not.toBe("employer_match");
  });

  it("prefers RRSP when the retirement rate is lower", () => {
    const r = suggestSavingsAllocation({
      ...base,
      currentMarginalRate: 0.4,
      retirementMarginalRate: 0.3,
      rrspRoom: 10_000,
      tfsaRoom: 10_000,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets.indexOf("rrsp")).toBeLessThan(buckets.indexOf("tfsa"));
  });

  it("prefers TFSA when the retirement rate is higher", () => {
    const r = suggestSavingsAllocation({
      ...base,
      currentMarginalRate: 0.3,
      retirementMarginalRate: 0.4,
      rrspRoom: 10_000,
      tfsaRoom: 10_000,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets.indexOf("tfsa")).toBeLessThan(buckets.indexOf("rrsp"));
  });

  it("prefers TFSA when rates are equal (flexibility, no RRSP rate advantage)", () => {
    const r = suggestSavingsAllocation({
      ...base,
      currentMarginalRate: 0.35,
      retirementMarginalRate: 0.35,
      rrspRoom: 10_000,
      tfsaRoom: 10_000,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets.indexOf("tfsa")).toBeLessThan(buckets.indexOf("rrsp"));
  });

  it("uses spousal RRSP with a meaningful income gap and warns about attribution", () => {
    const r = suggestSavingsAllocation({
      ...base,
      married: true,
      incomeGap: 30_000,
      currentMarginalRate: 0.45,
      retirementMarginalRate: 0.3,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets).toContain("spousal_rrsp");
    expect(buckets).not.toContain("rrsp");
    expect(r.warnings.some((w) => w.toLowerCase().includes("three calendar years"))).toBe(true);
  });

  it("uses spousal RRSP on a meaningful RRSP-balance gap alone", () => {
    const r = suggestSavingsAllocation({
      ...base,
      married: true,
      incomeGap: 2_000,
      rrspBalanceGap: 80_000,
      currentMarginalRate: 0.45,
      retirementMarginalRate: 0.3,
    });
    expect(r.steps.map((s) => s.bucket)).toContain("spousal_rrsp");
  });

  it("does not use spousal RRSP when single or the gap is small", () => {
    const single = suggestSavingsAllocation({ ...base, married: false, incomeGap: 50_000 });
    expect(single.steps.map((s) => s.bucket)).not.toContain("spousal_rrsp");

    const smallGap = suggestSavingsAllocation({
      ...base,
      married: true,
      incomeGap: SPOUSAL_GAP_THRESHOLD - 1,
      rrspBalanceGap: 0,
    });
    expect(smallGap.steps.map((s) => s.bucket)).not.toContain("spousal_rrsp");
  });

  it("sends overflow to non-registered last and respects rooms", () => {
    const r = suggestSavingsAllocation({
      ...base,
      rrspRoom: 5_000,
      tfsaRoom: 5_000,
    });
    const byBucket = Object.fromEntries(r.steps.map((s) => [s.bucket, s.amount]));
    expect(byBucket["rrsp"]).toBe(5_000);
    expect(byBucket["tfsa"]).toBe(5_000);
    expect(byBucket["nonreg"]).toBe(10_000);
    expect(r.steps[r.steps.length - 1].bucket).toBe("nonreg");
    expect(r.totalAllocated).toBe(20_000);
  });

  it("warns on OAS clawback exposure", () => {
    const r = suggestSavingsAllocation({ ...base, oasClawbackExposure: true });
    expect(r.warnings.some((w) => w.includes("OAS"))).toBe(true);
  });

  it("handles zero savings gracefully", () => {
    const r = suggestSavingsAllocation({ ...base, annualSavings: 0 });
    expect(r.steps).toHaveLength(0);
    expect(r.totalAllocated).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("is informational only — disclaimer present, no prescriptive wording", () => {
    const r = suggestSavingsAllocation(base);
    expect(r.disclaimer).toBe(SAVINGS_DISCLAIMER);
    expect(r.disclaimer.toLowerCase()).toContain("not financial");
    const allText = [...r.steps.map((s) => s.reason), ...r.warnings, r.disclaimer].join(" ").toLowerCase();
    for (const phrase of ["you should", "we recommend", "move your", "i recommend"]) {
      expect(allText).not.toContain(phrase);
    }
  });

  it("slots FHSA second when eligible, capped at the $8,000 annual limit", () => {
    const r = suggestSavingsAllocation({
      ...base,
      annualSavings: 20_000,
      fhsaEligible: true,
      fhsaRoom: 20_000,
      rrspRoom: 10_000,
      tfsaRoom: 10_000,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets[0]).toBe("fhsa");
    expect(r.steps[0].amount).toBe(8_000);
    // FHSA comes before the RRSP-vs-TFSA choice.
    expect(buckets.indexOf("fhsa")).toBeLessThan(buckets.indexOf("rrsp"));
    expect(buckets.indexOf("fhsa")).toBeLessThan(buckets.indexOf("tfsa"));
    expect(r.totalAllocated).toBe(20_000);
  });

  it("skips FHSA when not eligible", () => {
    const r = suggestSavingsAllocation({ ...base, fhsaEligible: false, fhsaRoom: 10_000 });
    expect(r.steps.map((s) => s.bucket)).not.toContain("fhsa");
  });

  it("FHSA respects a smaller stated room", () => {
    const r = suggestSavingsAllocation({
      ...base,
      annualSavings: 20_000,
      fhsaEligible: true,
      fhsaRoom: 3_000,
    });
    const fhsa = r.steps.find((s) => s.bucket === "fhsa");
    expect(fhsa?.amount).toBe(3_000);
  });

  it("FHSA comes after the employer match", () => {
    const r = suggestSavingsAllocation({
      ...base,
      annualSavings: 20_000,
      employerMatch: { offered: true, matchRate: 0.5, maxOfSalary: 0.06 },
      fhsaEligible: true,
    });
    const buckets = r.steps.map((s) => s.bucket);
    expect(buckets[0]).toBe("employer_match");
    expect(buckets[1]).toBe("fhsa");
  });
});
