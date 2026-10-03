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
    expect(full65).toBeCloseTo(751.97 * 12, 6);
    expect(partial70).toBeCloseTo(751.97 * 12 * 0.5 * 1.36, 6);
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

  it("applies no OAS clawback below the threshold", () => {
    const result = estimateGovernmentBenefits(person, 65, 50_000, {
      previousYearIncome: 50_000,
      inflationRate: 0,
      calendarYear: 2026,
    });
    expect(result.oasClawback).toBe(0);
    expect(result.oas).toBeCloseTo(751.97 * 12, 2);
  });

  it("claws back OAS at 15% above the threshold", () => {
    // $120,000 income vs $95,323 threshold = $24,677 excess × 15% = $3,701.55
    const result = estimateGovernmentBenefits(person, 65, 120_000, {
      previousYearIncome: 120_000,
      inflationRate: 0,
      calendarYear: 2026,
    });
    const grossOas = 751.97 * 12;
    const expectedClawback = Math.min(grossOas, 0.15 * (120_000 + grossOas - 95_323));
    expect(result.oasClawback).toBeCloseTo(expectedClawback, 2);
    expect(result.oas).toBeCloseTo(grossOas - expectedClawback, 2);
  });

  it("fully claws back OAS at very high income", () => {
    const result = estimateGovernmentBenefits(person, 65, 500_000, {
      previousYearIncome: 500_000,
      inflationRate: 0,
      calendarYear: 2026,
    });
    const grossOas = 751.97 * 12;
    expect(result.oasClawback).toBeCloseTo(grossOas, 2);
    expect(result.oas).toBe(0);
  });
});
