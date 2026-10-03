import { describe, expect, it } from "vitest";
import { calculateCppBenefit, estimateCppAt65 } from "./CppCalculator";
import { getYmpe, getAverageYmpe } from "./ympeTable";

describe("YMPE table", () => {
  it("returns known values for recent years", () => {
    expect(getYmpe(2026)).toBe(74600);
    expect(getYmpe(2025)).toBe(71300);
    expect(getYmpe(2020)).toBe(58700);
    expect(getYmpe(2000)).toBe(37600);
  });

  it("projects future years with growth", () => {
    const y2030 = getYmpe(2030);
    expect(y2030).toBeGreaterThan(74600);
    // ~2.5% annual growth for 4 years: 74600 * 1.025^4 ≈ 82300
    expect(y2030).toBeGreaterThan(80000);
    expect(y2030).toBeLessThan(85000);
  });

  it("computes 5-year average YMPE", () => {
    const avg = getAverageYmpe(2026);
    // (74600 + 71300 + 68500 + 66600 + 64900) / 5 = 69180
    expect(avg).toBeCloseTo(69180, 0);
  });
});

describe("CPP calculator", () => {
  it("calculates maximum CPP for max earnings every year", () => {
    // Someone born in 1961, turned 18 in 1979, max earnings every year until 65 (2026)
    const earningsHistory = [];
    for (let year = 1979; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 100000 }); // Above YMPE every year
    }

    const result = calculateCppBenefit({
      birthYear: 1961,
      birthMonth: 6,
      earningsHistory,
      cppStartAge: 65,
    });

    // With max earnings every year: ratio = 1.0 for all years
    // After 17% dropout: average ratio still 1.0
    // Base = 1.0 * 25% * avgYmpe(2026) / 12 = 1441.25
    // Enhancement: 8.33% pro-rated for post-2018 years
    expect(result.averageEarningsRatio).toBeCloseTo(1.0, 2);
    expect(result.cppAt65Monthly).toBeGreaterThan(1441); // Base + enhancement
    expect(result.cppAt65Monthly).toBeLessThan(1700);
    expect(result.contributoryYears).toBe(48); // 1979-2026
  });

  it("applies 17% general dropout to lowest years", () => {
    // 10 years of earnings: 5 high, 5 low
    // Use cppStartAge to limit contributory period to just these 10 years
    const earningsHistory = [
      { year: 2017, earnings: 60000 },
      { year: 2018, earnings: 60000 },
      { year: 2019, earnings: 60000 },
      { year: 2020, earnings: 60000 },
      { year: 2021, earnings: 60000 },
      { year: 2022, earnings: 10000 },
      { year: 2023, earnings: 10000 },
      { year: 2024, earnings: 10000 },
      { year: 2025, earnings: 10000 },
      { year: 2026, earnings: 10000 },
    ];

    const result = calculateCppBenefit({
      birthYear: 1999, // Turned 18 in 2017
      birthMonth: 1,
      earningsHistory,
      cppStartAge: 27, // Born 1999 + 27 = 2026, so period is 2017-2026 (10 years)
      calculationYear: 2026,
    });

    // Contributory years: 2017-2026 = 10 years
    // 17% dropout = 1 year (floor(10 * 0.17) = 1)
    expect(result.contributoryYears).toBe(10);
    expect(result.generalDropoutYears).toBe(1);
    expect(result.dropoutYears).toBe(1);
  });

  it("excludes child-rearing years from calculation", () => {
    const earningsHistory = [];
    for (let year = 2000; year <= 2020; year++) {
      earningsHistory.push({ year, earnings: 50000 });
    }

    const result = calculateCppBenefit({
      birthYear: 1982, // Turned 18 in 2000
      birthMonth: 6,
      earningsHistory,
      childRearingYears: [2005, 2006, 2007], // 3 years of child-rearing
      cppStartAge: 65,
      calculationYear: 2026,
    });

    expect(result.childRearingDropoutYears).toBe(3);
    expect(result.dropoutYears).toBeGreaterThanOrEqual(3);
  });

  it("caps earnings at YMPE", () => {
    const result = calculateCppBenefit({
      birthYear: 1990,
      birthMonth: 1,
      earningsHistory: [{ year: 2026, earnings: 200000 }], // Way above YMPE
      cppStartAge: 65,
      calculationYear: 2026,
    });

    const breakdown2026 = result.yearlyBreakdown.find((y) => y.year === 2026);
    expect(breakdown2026?.pensionableEarnings).toBe(74600); // Capped at YMPE
    expect(breakdown2026?.ratio).toBeCloseTo(1.0, 5);
  });

  it("returns zero for no earnings history", () => {
    const result = calculateCppBenefit({
      birthYear: 1990,
      birthMonth: 1,
      earningsHistory: [],
      cppStartAge: 65,
    });

    expect(result.cppAt65Monthly).toBe(0);
  });

  it("estimateCppAt65 convenience function works", () => {
    const earningsHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 70000 });
    }

    const monthly = estimateCppAt65(1972, 6, earningsHistory, 70000);
    expect(monthly).toBeGreaterThan(0);
    // For someone retiring in 2037 (1972+65), YMPE will be higher than 2026,
    // so benefit can exceed the 2026 maximum. Just check it's reasonable.
    expect(monthly).toBeLessThan(3000);
  });

  it("reduces CPP when retiring early (zero earnings after retirement age)", () => {
    const earningsHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 70000 });
    }
    const base = { birthYear: 1980, birthMonth: 6, earningsHistory, futureAnnualEarnings: 70000, cppStartAge: 65 };

    const workTo65 = calculateCppBenefit({ ...base, retirementAge: 65 });
    const retireAt50 = calculateCppBenefit({ ...base, retirementAge: 50 });

    // Retiring at 50 means 15 years of zero earnings; CPP must be lower
    expect(retireAt50.cppAt65Monthly).toBeLessThan(workTo65.cppAt65Monthly);
    // But not zero — dropout rules absorb some of the gap
    expect(retireAt50.cppAt65Monthly).toBeGreaterThan(0);
  });

  it("keeps legacy behavior when retirement age is omitted", () => {
    const earningsHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 70000 });
    }
    const base = { birthYear: 1980, birthMonth: 6, earningsHistory, futureAnnualEarnings: 70000, cppStartAge: 65 };

    const withRetirement65 = calculateCppBenefit({ ...base, retirementAge: 65 });
    const withoutRetirement = calculateCppBenefit(base);

    // Omitting retirementAge keeps future earnings until CPP start (legacy)
    expect(withoutRetirement.cppAt65Monthly).toBeGreaterThanOrEqual(withRetirement65.cppAt65Monthly);
  });

  it("includes CPP enhancement for post-2018 earnings", () => {
    const earningsHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 70000 });
    }
    // Someone with only pre-2019 earnings gets no enhancement
    const oldEarnings = [];
    for (let year = 1990; year <= 2018; year++) {
      oldEarnings.push({ year, earnings: 70000 });
    }
    const withEnhancement = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    const withoutEnhancement = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: oldEarnings, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    // The enhancement should add value for post-2018 earnings
    expect(withEnhancement.cppAt65Monthly).toBeGreaterThan(withoutEnhancement.cppAt65Monthly);
    // Breakdown should be exposed
    expect(withEnhancement.firstAdditionalAnnual).toBeGreaterThan(0);
    expect(withoutEnhancement.firstAdditionalAnnual).toBe(0);
    expect(withoutEnhancement.secondAdditionalAnnual).toBe(0);
  });

  it("applies phase-in factors to first additional (2019 < 2023)", () => {
    // Two people with identical careers except one worked 2019, the other 2023
    const base = [];
    for (let year = 1990; year <= 2018; year++) {
      base.push({ year, earnings: 60000 });
    }
    const with2019 = [...base, { year: 2019, earnings: 60000 }];
    const with2023 = [...base, { year: 2023, earnings: 60000 }];
    const r2019 = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: with2019, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    const r2023 = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: with2023, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    // 2023 (100% phase-in) should give more enhancement than 2019 (15% phase-in)
    expect(r2023.firstAdditionalAnnual).toBeGreaterThan(r2019.firstAdditionalAnnual);
    // Roughly 100/15 = 6.67x (same YMPE ratio, different phase-in)
    // Allow tolerance for YMPE differences between years
    const ratio = r2023.firstAdditionalAnnual / r2019.firstAdditionalAnnual;
    expect(ratio).toBeGreaterThan(4);
  });

  it("calculates CPP2 second additional for earnings above YMPE (2024+)", () => {
    const history = [];
    for (let year = 1990; year <= 2026; year++) {
      history.push({ year, earnings: 90000 }); // Above YMPE every year
    }
    const highEarner = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: history, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    // Should have CPP2 for 2024-2026
    expect(highEarner.secondAdditionalAnnual).toBeGreaterThan(0);

    // Someone earning below YMPE gets no CPP2
    const lowHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      lowHistory.push({ year, earnings: 50000 });
    }
    const lowEarner = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: lowHistory, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    expect(lowEarner.secondAdditionalAnnual).toBe(0);
    // But still gets first additional
    expect(lowEarner.firstAdditionalAnnual).toBeGreaterThan(0);
  });

  it("gives no CPP2 for pre-2024 earnings even if above YMPE", () => {
    const history = [];
    for (let year = 1990; year <= 2023; year++) {
      history.push({ year, earnings: 90000 });
    }
    const result = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory: history, futureAnnualEarnings: 0, cppStartAge: 65,
    });
    expect(result.secondAdditionalAnnual).toBe(0);
    // First additional still applies to 2019-2023
    expect(result.firstAdditionalAnnual).toBeGreaterThan(0);
  });

  it("calculates PRBs when working while collecting CPP", () => {
    const earningsHistory = [];
    for (let year = 1990; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 70000 });
    }
    // Retire at 68, start CPP at 65 → 3 years of PRBs
    const withPrb = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory,
      futureAnnualEarnings: 70000, retirementAge: 68, cppStartAge: 65,
    });
    expect(withPrb.prbYears).toEqual([2025, 2026, 2027]);
    expect(withPrb.prbMonthly).toBeGreaterThan(0);
    // Retire at 65, start CPP at 65 → no PRBs
    const noPrb = calculateCppBenefit({
      birthYear: 1960, birthMonth: 6, earningsHistory,
      futureAnnualEarnings: 70000, retirementAge: 65, cppStartAge: 65,
    });
    expect(noPrb.prbYears).toEqual([]);
    expect(noPrb.prbMonthly).toBe(0);
  });
});
