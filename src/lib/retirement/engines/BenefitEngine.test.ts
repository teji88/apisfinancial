import { describe, expect, it } from "vitest";
import { estimateGovernmentBenefits, estimateCppSurvivorAnnual } from "./BenefitEngine";
import type { PersonScenario } from "../domain/types";

const person: PersonScenario = {
  role: "MAIN_USER",
  birthYear: 1960,
  birthMonth: 1,
  retirementAge: 65,
  cppAt65: 1000,
  cppStartAge: 65,
  oasStartAge: 65,
  oasResidenceYears: 40,
};

describe("BenefitEngine", () => {
  it("applies CPP timing adjustments", () => {
    const at60 = estimateGovernmentBenefits({ ...person, cppStartAge: 60 }, 60, 0, { inflationRate: 0, calendarYear: 2026 }).cpp;
    const at65 = estimateGovernmentBenefits({ ...person, cppStartAge: 65 }, 65, 0, { inflationRate: 0, calendarYear: 2026 }).cpp;
    const at70 = estimateGovernmentBenefits({ ...person, cppStartAge: 70 }, 70, 0, { inflationRate: 0, calendarYear: 2026 }).cpp;
    expect(at60).toBeCloseTo(12000 * 0.64, 6);
    expect(at65).toBeCloseTo(12000, 6);
    expect(at70).toBeCloseTo(12000 * 1.42, 6);
  });

  it("applies OAS residence and deferral factors", () => {
    const full65 = estimateGovernmentBenefits(person, 65, 0, { inflationRate: 0, calendarYear: 2026 }).oas;
    const partial70 = estimateGovernmentBenefits({ ...person, oasStartAge: 70, oasResidenceYears: 20 }, 70, 0, { inflationRate: 0, calendarYear: 2026 }).oas;
    expect(full65).toBeCloseTo(762.50 * 12, 6);
    expect(partial70).toBeCloseTo(762.50 * 12 * 0.5 * 1.36, 6);
  });

  it("s.7.1(3): recalculated fraction beats frozen-plus-boost for low fractions", () => {
    // 10/40 deferring one year: (b) frozen-plus-boost = 0.25 × 1.072 = 0.268
    // vs (c) fresh fraction = 11/40 = 0.275 — (c) wins.
    const oas = estimateGovernmentBenefits(
      { ...person, oasResidenceYears: 10, oasStartAge: 66 }, 66, 0,
      { inflationRate: 0, calendarYear: 2026 },
    ).oas;
    expect(oas).toBeCloseTo(762.50 * 12 * 0.275, 6);
  });

  it("s.7.1(3): frozen-plus-boost wins for high fractions and is not capped at the full pension", () => {
    // 30/40 deferring to 70: (b) = 0.75 × 1.36 = 1.02 vs (c) = 35/40 = 0.875.
    // (b) wins and legally exceeds 100% of the base full pension.
    const oas = estimateGovernmentBenefits(
      { ...person, oasResidenceYears: 30, oasStartAge: 70 }, 70, 0,
      { inflationRate: 0, calendarYear: 2026 },
    ).oas;
    expect(oas).toBeCloseTo(762.50 * 12 * 1.02, 6);
    expect(oas).toBeGreaterThan(762.50 * 12);
  });

  it("floors partial OAS residence to whole years (OAS Act s.3(4))", () => {
    // 20.9 years → only 20 completed years count; 9.9 years → 9, below the
    // 10-year minimum, so no OAS at all.
    const partial = estimateGovernmentBenefits({ ...person, oasResidenceYears: 20.9 }, 65, 0, { inflationRate: 0, calendarYear: 2026 }).oas;
    expect(partial).toBeCloseTo(762.50 * 12 * 0.5, 6);
    const ineligible = estimateGovernmentBenefits({ ...person, oasResidenceYears: 9.9 }, 65, 0, { inflationRate: 0, calendarYear: 2026 }).oas;
    expect(ineligible).toBe(0);
  });

  it("excludes OAS and applies the GIS employment earnings exemption", () => {
    const noEmployment = estimateGovernmentBenefits(person, 65, 10_000, {
      previousYearIncome: 10_000,
      inflationRate: 0,
      calendarYear: 2026,
    }).gis;
    const fiveThousandEmployment = estimateGovernmentBenefits(person, 65, 10_000, {
      previousYearIncome: 10_000,
      previousYearEmploymentIncome: 5_000,
      inflationRate: 0,
      calendarYear: 2026,
    }).gis;
    const tenThousandEmployment = estimateGovernmentBenefits(person, 65, 10_000, {
      previousYearIncome: 10_000,
      previousYearEmploymentIncome: 10_000,
      inflationRate: 0,
      calendarYear: 2026,
    }).gis;
    expect(fiveThousandEmployment).toBeGreaterThan(noEmployment);
    expect(tenThousandEmployment).toBeGreaterThan(fiveThousandEmployment);
    expect(estimateGovernmentBenefits(person, 65, 10_000, {
      previousYearIncome: 10_000,
      previousYearEmploymentIncome: 0,
      inflationRate: 0,
      calendarYear: 2026,
    }).gis).toBe(noEmployment);
  });

  it("uses separate partner income for couple GIS context", () => {
    const benefit = estimateGovernmentBenefits(person, 65, 0, {
      householdSize: 2,
      partnerAge: 67,
      partnerReceivesOas: true,
      previousYearIncome: 3000,
      partnerIncomeForBenefits: 3000,
      partnerPreviousYearEmploymentIncome: 3000,
      inflationRate: 0,
      calendarYear: 2026,
    });
    expect(benefit.gis).toBeGreaterThan(0);
  });

  it("uses the published July 2026 GIS income tables and residence eligibility", () => {
    const single = estimateGovernmentBenefits(person, 65, 10_000, {
      previousYearIncome: 10_000, inflationRate: 0, calendarYear: 2026,
    });
    const spouseOnOas = estimateGovernmentBenefits(person, 65, 10_000, {
      householdSize: 2, partnerAge: 67, partnerReceivesOas: true,
      previousYearIncome: 5_000, partnerIncomeForBenefits: 5_000,
      inflationRate: 0, calendarYear: 2026,
    });
    const spouseNotOnOas = estimateGovernmentBenefits(person, 65, 10_000, {
      householdSize: 2, partnerAge: 62, partnerOasResidenceYears: 8,
      previousYearIncome: 5_000, partnerIncomeForBenefits: 5_000,
      inflationRate: 0, calendarYear: 2026,
    });
    expect(single.gis).toBeCloseTo(541.17 * 12, 2);
    expect(spouseOnOas.gis).toBeCloseTo(418.79 * 12, 2);
    expect(spouseNotOnOas.gis).toBeCloseTo(1041.17 * 12, 2);
    expect(estimateGovernmentBenefits({ ...person, oasResidenceYears: 9 }, 65, 0, {
      previousYearIncome: 0, inflationRate: 0, calendarYear: 2026,
    }).gis).toBe(0);
  });

  it("estimates the 60-to-64 Allowance from the published couple table", () => {
    const allowance = estimateGovernmentBenefits({ ...person, oasResidenceYears: 40 }, 62, 0, {
      householdSize: 2, partnerAge: 68, partnerReceivesOas: true, partnerOasResidenceYears: 40,
      previousYearIncome: 7_500, partnerIncomeForBenefits: 7_500,
      inflationRate: 0, calendarYear: 2026,
    });
    expect(allowance.allowance).toBeCloseTo(565.79 * 12, 2);
    expect(allowance.gis).toBe(0);
  });

  it("uses the separate published Allowance for the Survivor schedule", () => {
    const allowance = estimateGovernmentBenefits({ ...person, oasResidenceYears: 40 }, 62, 10_000, {
      householdSize: 1, previousYearIncome: 10_000, survivor: true,
      inflationRate: 0, calendarYear: 2026,
    });
    expect(allowance.allowance).toBeCloseTo(912.34 * 12, 2);
  });

  it("caps survivor CPP at the retirement maximum while respecting the survivor rate", () => {
    const combined = estimateCppSurvivorAnnual(12000, 65, 12000, 60);
    expect(combined).toBeLessThanOrEqual(1507.65 * 12 * 1.02);
  });
});
