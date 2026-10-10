import { describe, expect, it } from "vitest";
import { optimizeCppOasTiming, type TimingOptimizerInputs } from "./CppOasTiming";
import {
  defaultMortalityTable,
  survivalProbability,
  tableFromQxVectors,
} from "./mortality";
import type { PersonScenario } from "../domain/types";

function makePerson(overrides: Partial<PersonScenario> = {}): PersonScenario {
  return {
    role: "MAIN_USER",
    birthYear: 1966,
    birthMonth: 1,
    retirementAge: 65,
    cppAt65: 1000, // monthly → $12,000/yr
    cppStartAge: 65,
    oasStartAge: 65,
    oasResidenceYears: 40,
    ...overrides,
  };
}

function baseInputs(overrides: Partial<TimingOptimizerInputs> = {}): TimingOptimizerInputs {
  return {
    person: makePerson(),
    currentAge: 60,
    sex: "M",
    province: "AB",
    ...overrides,
  };
}

describe("mortality", () => {
  it("survival probability is 1 at the starting age and decreases", () => {
    const table = defaultMortalityTable();
    expect(survivalProbability(table, 60, 60, "M")).toBe(1);
    const s70 = survivalProbability(table, 60, 70, "M");
    const s90 = survivalProbability(table, 60, 90, "M");
    expect(s70).toBeGreaterThan(s90);
    expect(s70).toBeGreaterThan(0.5);
    expect(s90).toBeLessThan(0.5);
  });

  it("Gompertz default reproduces StatCan 2023 life expectancy at 65", () => {
    const table = defaultMortalityTable();
    // e65 = Σ_{t>=0} S(65 → 65+t+1)
    let eM = 0;
    let eF = 0;
    for (let t = 0; t < 55; t++) {
      eM += survivalProbability(table, 65, 66 + t, "M");
      eF += survivalProbability(table, 65, 66 + t, "F");
    }
    expect(eM).toBeCloseTo(19.7, 0);
    expect(eF).toBeCloseTo(22.3, 0);
  });

  it("accepts explicit qx vectors", () => {
    const male: Record<number, number> = {};
    const female: Record<number, number> = {};
    for (let x = 50; x <= 110; x++) {
      male[x] = 0.01;
      female[x] = 0.008;
    }
    const table = tableFromQxVectors(male, female, "flat test");
    expect(table.qx(60, "M")).toBe(0.01);
    expect(table.qx(60, "F")).toBe(0.008);
    expect(survivalProbability(table, 60, 70, "M")).toBeCloseTo(Math.pow(0.99, 10), 6);
  });
});

describe("optimizeCppOasTiming", () => {
  it("evaluates the full 66-combo grid for a 60-year-old", () => {
    const result = optimizeCppOasTiming(baseInputs());
    expect(result.combos.length).toBe(66); // 11 CPP ages × 6 OAS ages
    // Sorted by expected PV descending.
    for (let i = 1; i < result.combos.length; i++) {
      expect(result.combos[i - 1]!.expectedPV).toBeGreaterThanOrEqual(
        result.combos[i]!.expectedPV,
      );
    }
  });

  it("is deterministic", () => {
    const a = optimizeCppOasTiming(baseInputs());
    const b = optimizeCppOasTiming(baseInputs());
    expect(a.recommended).toEqual(b.recommended);
  });

  it("recommends late CPP for a healthy 60-year-old male with no clawback exposure", () => {
    const result = optimizeCppOasTiming(
      baseInputs({ person: makePerson({ cppAt65: 3000 }) }), // $36k/yr, no GIS
    );
    expect(result.recommended.cppStartAge).toBe(70);
    expect(result.recommended.feasible).toBe(true);
    expect(result.recommended.expectedPV).toBeGreaterThan(result.baseline.expectedPV);
  });

  it("recommends OAS at 65 (not deferral) for a GIS-regime person", () => {
    // $12k/yr CPP → GIS-eligible → OAS deferral forfeits GIS.
    const result = optimizeCppOasTiming(baseInputs());
    expect(result.recommended.oasStartAge).toBe(65);
    expect(result.recommended.cppStartAge).toBeGreaterThanOrEqual(68);
  });

  it("blocks OAS deferral for a GIS-eligible person", () => {
    const result = optimizeCppOasTiming(
      baseInputs({
        person: makePerson({ cppAt65: 0, otherIncome: 0, oasResidenceYears: 40 }),
      }),
    );
    const deferred = result.combos.filter((c) => c.oasStartAge > 65);
    expect(deferred.length).toBeGreaterThan(0);
    for (const c of deferred) {
      expect(c.violations).toContain("oasDeferralForfeitsGis");
      expect(c.feasible).toBe(false);
    }
    expect(result.recommended.oasStartAge).toBe(65);
  });

  it("reports bridge funding needs and enforces the constraint", () => {
    const noConstraint = optimizeCppOasTiming(baseInputs());
    expect(noConstraint.recommended.requiredBridgeFunds).toBeGreaterThan(0);
    const constrained = optimizeCppOasTiming(
      baseInputs({ bridgeFundsAvailable: 1 }),
    );
    // $1 of bridge funds can't cover delaying to 70 → those combos infeasible.
    const delayed = constrained.combos.filter(
      (c) => c.cppStartAge === 70 && c.oasStartAge === 70,
    );
    expect(delayed[0]!.violations).toContain("insufficientBridgeFunds");
  });

  it("computes a plausible discounted break-even age (explain-only)", () => {
    const result = optimizeCppOasTiming(
      baseInputs({ person: makePerson({ cppAt65: 3000 }) }),
    );
    const be = result.recommended.breakEvenVs65;
    // Discounted break-even for 65-vs-70 sits ~79-81 per CIA/SOA.
    expect(be).not.toBeNull();
    expect(be!).toBeGreaterThan(70);
    expect(be!).toBeLessThan(95);
  });

  it("runs the sensitivity analysis and flags flips honestly", () => {
    const result = optimizeCppOasTiming(baseInputs());
    expect(result.sensitivity.atZeroDiscount).toBeDefined();
    expect(result.sensitivity.atThreeDiscount).toBeDefined();
    expect(typeof result.sensitivity.discountFlips).toBe("boolean");
    expect(typeof result.sensitivity.longevityFlips).toBe("boolean");
    expect(result.mortalityLabel).toContain("Gompertz");
  });

  it("handles someone already past 65 (collapsed grid)", () => {
    const result = optimizeCppOasTiming(baseInputs({ currentAge: 68 }));
    // CPP 68..70 × OAS 68..70 = 9 combos.
    expect(result.combos.length).toBe(9);
    expect(result.recommended).toBeDefined();
  });
});
