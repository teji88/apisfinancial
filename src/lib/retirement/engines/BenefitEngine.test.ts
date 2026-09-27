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
    expect(partial70).toBeCloseTo(827.17 * 12 * 0.5 * 1.36, 6);
  });

  it("uses separate partner income for couple GIS context", () => {
    const benefit = estimateGovernmentBenefits(person, 65, 0, {
      householdSize: 2,
      partnerAge: 67,
      partnerReceivesOas: true,
      previousYearIncome: 10000,
      partnerIncomeForBenefits: 10000,
      inflationRate: 0,
      calendarYear: 2026,
    });
    expect(benefit.gis).toBeGreaterThan(0);
  });

  it("caps survivor CPP at the retirement maximum while respecting the survivor rate", () => {
    const combined = estimateCppSurvivorAnnual(12000, 65, 12000, 60);
    expect(combined).toBeLessThanOrEqual(1507.65 * 12 * 1.02);
  });
});
