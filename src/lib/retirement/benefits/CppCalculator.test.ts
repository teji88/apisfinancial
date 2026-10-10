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
    expect(result.cppBaseMonthly).toBeGreaterThan(1441); // Base + enhancement
    expect(result.cppBaseMonthly).toBeLessThan(1700);
    expect(result.contributoryYears).toBe(48); // 1979-2026
  });

  it("never drops the divisor below 120 months (s.48(4) floor)", () => {
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

    // Contributory period: 2017-2026 = 10 years = 120 months.
    // s.48(4): the dropout is the lesser of 17% or (months − 120) = 0 here.
    // The divisor can never be pushed below 120 months, so NOTHING is dropped
    // even though 17% × 120 = 20.4 months would otherwise qualify.
    expect(result.contributoryYears).toBe(10);
    expect(result.generalDropoutMonths).toBe(0);
    expect(result.generalDropoutYears).toBe(0);
    expect(result.divisorMonths).toBe(120);
  });

  it("uses ceiling (not floor) for the 17% dropout count (s.48(4))", () => {
    // 13-year contributory period: 8 high years, 5 low years.
    // 13 × 12 = 156 months; 17% × 156 = 26.52 → ceiling = 27 months dropped.
    // (The old code used floor on years: floor(13 × 0.17) = 2 years = 24 months.)
    const earningsHistory = [];
    for (let year = 2017; year <= 2024; year++) {
      earningsHistory.push({ year, earnings: 60000 });
    }
    for (let year = 2025; year <= 2029; year++) {
      earningsHistory.push({ year, earnings: 10000 });
    }

    const result = calculateCppBenefit({
      birthYear: 1999, // Turned 18 in 2017
      birthMonth: 1,
      earningsHistory,
      cppStartAge: 30, // 1999 + 30 = 2029 → period 2017-2029 (13 years)
      calculationYear: 2026,
    });

    expect(result.generalDropoutMonths).toBe(27);
    expect(result.divisorMonths).toBe(156 - 27);
    // All dropped months come from the low-earning years (2025-2029).
    // Lowest ratios first: later years have higher YMPE → lower ratio.
    const byYear = new Map(result.yearlyBreakdown.map((y) => [y.year, y.droppedMonths]));
    expect(byYear.get(2029)).toBe(12);
    expect(byYear.get(2028)).toBe(12);
    expect(byYear.get(2027)).toBe(3);
    expect(byYear.get(2026)).toBe(0);
    expect(byYear.get(2017)).toBe(0);
  });

  it("matches the Act's dropout counts for a 15-year case (research vector)", () => {
    // Independent research against the CPP Act (s.48): 180 contributory months,
    // 17% × 180 = 30.6 → ceiling 31 months dropped, divisor 149.
    const earningsHistory = [];
    for (let year = 2011; year <= 2025; year++) {
      earningsHistory.push({ year, earnings: 55000 });
    }

    const result = calculateCppBenefit({
      birthYear: 1993, // Turned 18 in 2011
      birthMonth: 1,
      earningsHistory,
      cppStartAge: 32, // 1993 + 32 = 2025 → period 2011-2025 (15 years)
      calculationYear: 2026,
    });

    expect(result.generalDropoutMonths).toBe(31);
    expect(result.divisorMonths).toBe(149);
  });

  it("drops low-earning child-rearing months (s.48(2))", () => {
    const earningsHistory = [];
    for (let year = 2000; year <= 2020; year++) {
      // Low earnings during the child-rearing years
      const earnings = year >= 2005 && year <= 2007 ? 5000 : 60000;
      earningsHistory.push({ year, earnings });
    }

    const withCR = calculateCppBenefit({
      birthYear: 1982, // Turned 18 in 2000
      birthMonth: 6,
      earningsHistory,
      childRearingYears: [2005, 2006, 2007],
      cppStartAge: 65,
      calculationYear: 2026,
    });
    const withoutCR = calculateCppBenefit({
      birthYear: 1982,
      birthMonth: 6,
      earningsHistory,
      cppStartAge: 65,
      calculationYear: 2026,
    });

    // All 36 child-rearing months qualify (below the no-dropout average)…
    expect(withCR.childRearingDropoutMonths).toBe(36);
    // …and dropping them increases the benefit, so the provision applies.
    expect(withCR.cppBaseMonthly).toBeGreaterThan(withoutCR.cppBaseMonthly);
  });

  it("drops the N lowest months anywhere in the period under s.48(3), not the post-65 months", () => {
    // s.48(3): the post-65 months only set the COUNT (N = 60 for a delay to 70);
    // the N months deducted are the lowest indexed-earning months anywhere in
    // the period. Here post-65 earnings are HIGH ($100k/yr, ratio 1.0) and
    // pre-65 earnings are LOW ($30k/yr) — so all 60 must come from pre-65 years.
    const earningsHistory = [];
    for (let year = 1978; year <= 2024; year++) {
      earningsHistory.push({ year, earnings: 30000 });
    }
    for (let year = 2025; year <= 2030; year++) {
      earningsHistory.push({ year, earnings: 100000 });
    }
    const result = calculateCppBenefit({
      birthYear: 1960, // Turned 18 in 1978
      birthMonth: 6,
      earningsHistory,
      retirementAge: 70,
      cppStartAge: 70,
    });

    // 53 years = 636 months; N = min(60 post-65 months, 636 − 120) = 60.
    expect(result.over65DropoutMonths).toBe(60);
    // General dropout then takes 98 more (min(ceil(576 × 0.17), 576 − 120)).
    expect(result.generalDropoutMonths).toBe(98);
    expect(result.dropoutMonths).toBe(158);
    expect(result.divisorMonths).toBe(478);
    // The high-earning post-65 years (2025-2030) lose no months at all —
    // s.48(3) reached back into the low-earning pre-65 years instead.
    const droppedByYear = new Map(result.yearlyBreakdown.map((y) => [y.year, y.droppedMonths]));
    for (let year = 2025; year <= 2030; year++) {
      expect(droppedByYear.get(year)).toBe(0);
    }
  });

  it("s.48(3) neutralizes zero post-65 earnings so delay neither helps nor hurts the average", () => {
    // Research illustration: work to 65 at $60k/yr, then $0 from 65-70 while
    // delaying CPP to 70. s.48(3) drops exactly the 60 zero months, so the
    // average earnings ratio matches starting at 65.
    const earningsHistory = [];
    for (let year = 1978; year <= 2024; year++) {
      earningsHistory.push({ year, earnings: 60000 });
    }
    const base = {
      birthYear: 1960,
      birthMonth: 6,
      earningsHistory,
      futureAnnualEarnings: 0,
      retirementAge: 65,
    };
    const at65 = calculateCppBenefit({ ...base, cppStartAge: 65 });
    const at70 = calculateCppBenefit({ ...base, cppStartAge: 70 });

    expect(at70.over65DropoutMonths).toBe(60);
    expect(at65.over65DropoutMonths).toBe(0);
    expect(at70.averageEarningsRatio).toBeCloseTo(at65.averageEarningsRatio, 6);
  });

  it("does not apply s.48(3) when the pension starts at 65", () => {
    const earningsHistory = [];
    for (let year = 2000; year <= 2020; year++) {
      earningsHistory.push({ year, earnings: 50000 });
    }
    const result = calculateCppBenefit({
      birthYear: 1982,
      birthMonth: 6,
      earningsHistory,
      cppStartAge: 65,
      calculationYear: 2026,
    });
    // Trigger (a) requires commencement AFTER 65; starting exactly at 65
    // does not qualify.
    expect(result.over65DropoutMonths).toBe(0);
  });

  it("does NOT drop child-rearing years when earnings were not low (s.48(2))", () => {
    // Same earnings in the child-rearing years as everywhere else:
    // those months are above the no-dropout average, so s.48(2) does not apply
    // (the provision only operates when it increases the benefit).
    const earningsHistory = [];
    for (let year = 2000; year <= 2020; year++) {
      earningsHistory.push({ year, earnings: 50000 });
    }

    const result = calculateCppBenefit({
      birthYear: 1982, // Turned 18 in 2000
      birthMonth: 6,
      earningsHistory,
      childRearingYears: [2005, 2006, 2007],
      cppStartAge: 65,
      calculationYear: 2026,
    });

    expect(result.childRearingDropoutMonths).toBe(0);
    expect(result.cppBaseMonthly).toBeGreaterThan(0);
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

    expect(result.cppBaseMonthly).toBe(0);
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
    expect(retireAt50.cppBaseMonthly).toBeLessThan(workTo65.cppBaseMonthly);
    // But not zero — dropout rules absorb some of the gap
    expect(retireAt50.cppBaseMonthly).toBeGreaterThan(0);
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
    expect(withoutRetirement.cppBaseMonthly).toBeGreaterThanOrEqual(withRetirement65.cppBaseMonthly);
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
    expect(withEnhancement.cppBaseMonthly).toBeGreaterThan(withoutEnhancement.cppBaseMonthly);
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

  it("averages enhancement over a fixed 40 years with no dropout (ss.48.1/48.2)", () => {
    // 14-year contributory period, max earnings 2019-2026 (ratio 1.0 each year).
    // Hand computation (ss.48.1/48.2: fixed 480-month divisor, no dropout):
    //   2019: 1.0 × 0.0833 × 57400 × 0.15 =   717.21
    //   2020: 1.0 × 0.0833 × 58700 × 0.30 =  1467.21
    //   2021: 1.0 × 0.0833 × 61600 × 0.50 =  2565.64
    //   2022: 1.0 × 0.0833 × 64900 × 0.75 =  4054.63
    //   2023: 1.0 × 0.0833 × 66600 × 1.00 =  5547.78
    //   2024: 1.0 × 0.0833 × 68500 × 1.00 =  5706.05
    //   2025: 1.0 × 0.0833 × 71300 × 1.00 =  5939.29
    //   2026: 1.0 × 0.0833 × 74600 × 1.00 =  6214.18
    //   total = 32211.99 / 40 years = 805.30/year
    // The old code divided by the ~12 post-dropout years (≈2684/yr) — wrong.
    const earningsHistory = [];
    for (let year = 2019; year <= 2026; year++) {
      earningsHistory.push({ year, earnings: 100000 }); // Above YMPE → ratio 1.0
    }
    const result = calculateCppBenefit({
      birthYear: 1995, // Turned 18 in 2013
      birthMonth: 1,
      earningsHistory, // 2013-2018 default to 0 (past years, no data)
      cppStartAge: 31, // 1995 + 31 = 2026 → period 2013-2026 (14 years)
      calculationYear: 2026,
    });

    expect(result.firstAdditionalAnnual).toBeCloseTo(805.3, 0);
    // Sanity: the old (buggy) value would have been ~3.3x larger.
    expect(result.firstAdditionalAnnual).toBeLessThan(1000);
  });

  it("indexes earnings to the pension start year per s.51(1)", () => {
    // s.51(1): G (the MPEA) is for "the year in which a benefit becomes
    // payable" — the pension START year, not the age-65 year.
    // Same max-earnings history; only the start age differs.
    // MPEA(2060)/MPEA(2050) = 1.025^10 ≈ 1.2801 (both fully in YMPE
    // projection territory at 2.5%/yr). The old code used MPEA(65) for
    // both → ratio 1.0, overstating age-60 and understating age-70.
    const earningsHistory = [];
    for (let year = 2008; year <= 2060; year++) {
      earningsHistory.push({ year, earnings: 200000 }); // Above YMPE → ratio 1.0
    }
    const base = {
      birthYear: 1990, // Turned 18 in 2008
      birthMonth: 1,
      earningsHistory,
      futureAnnualEarnings: 200000,
      retirementAge: 70,
    };
    const at60 = calculateCppBenefit({ ...base, cppStartAge: 60 });
    const at70 = calculateCppBenefit({ ...base, cppStartAge: 70 });
    // Compare baseAnnual (pre age-factor) to isolate the MPEA effect.
    expect(at70.baseAnnual / at60.baseAnnual).toBeCloseTo(Math.pow(1.025, 10), 2);
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
