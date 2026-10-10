/**
 * Defined-benefit pension engine.
 *
 * Computes the monthly DB pension for a member (or surviving spouse) in
 * NOMINAL dollars for a given calendar year. Quoted amounts are in today's
 * dollars and converted to nominal at commencement; post-commencement
 * indexation follows the plan's indexing rule.
 *
 * Documented simplifications:
 * - Pre-commencement member death: survivor benefit not modeled (returns 0).
 *   Plan-specific pre-retirement death benefits vary too widely to derive.
 * - The bridge benefit is not indexed (the common plan design).
 * - Integration/offset formulas (e.g. "minus CPP at 65") are not modeled;
 *   use startAgeTable for plans with offsets.
 */

import type { DbPension, Money } from "../domain/types";

function inflationFactor(inflationRate: number, years: number): number {
  return Math.pow(1 + Math.max(0, inflationRate) / 100, Math.max(0, years));
}

/** Monthly amount at commencement, in nominal dollars of the start year. */
function commencementMonthly(
  p: DbPension,
  inflationRate: number,
  birthYear: number,
): { monthly: Money; startYear: number } {
  const startYear = birthYear + p.startAge;
  const infl = inflationFactor(inflationRate, startYear - 2026);
  let monthly: Money;
  const tableAmount = p.startAgeTable?.[p.startAge];
  if (tableAmount !== undefined) {
    monthly = tableAmount;
  } else {
    const earlyYears = Math.max(0, p.normalRetirementAge - p.startAge);
    const lateYears = Math.max(0, p.startAge - p.normalRetirementAge);
    const factor =
      (1 - (p.earlyReductionPerYear ?? 0) * earlyYears) *
      (1 + (p.lateIncreasePerYear ?? 0) * lateYears);
    monthly = p.monthlyAmountAtNRA * Math.max(0, factor);
  }
  return { monthly: monthly * infl, startYear };
}

function indexingFactor(p: DbPension, yearsSinceStart: number, inflationRate: number): number {
  const frac =
    p.indexing === "full" ? 1 : p.indexing === "partial" ? (p.indexingFraction ?? 0) : 0;
  return Math.pow(1 + (Math.max(0, inflationRate) / 100) * frac, Math.max(0, yearsSinceStart));
}

/**
 * Member's monthly DB pension at a given age/calendar year (nominal $).
 * Returns 0 before the commencement age.
 */
export function dbPensionMonthlyAt(
  p: DbPension,
  age: number,
  calendarYear: number,
  inflationRate: number,
  birthYear: number,
): Money {
  if (age < p.startAge) return 0;
  const { monthly, startYear } = commencementMonthly(p, inflationRate, birthYear);
  const base = monthly * indexingFactor(p, calendarYear - startYear, inflationRate);
  let bridge = 0;
  if (p.bridgeMonthly && p.bridgeEndAge !== undefined && age < p.bridgeEndAge) {
    bridge = p.bridgeMonthly * inflationFactor(inflationRate, startYear - 2026);
  }
  return base + bridge;
}

/**
 * Survivor's monthly pension after the member's death (nominal $).
 * A percentage of the member's indexed pension at death; the bridge is
 * excluded and indexation continues per the plan rule.
 */
export function dbSurvivorMonthlyAt(
  p: DbPension,
  calendarYear: number,
  inflationRate: number,
  memberBirthYear: number,
  memberDeathAge: number,
  memberDeathYear: number,
): Money {
  const pct = p.survivorPercent ?? 0;
  if (pct <= 0) return 0;
  if (memberDeathAge < p.startAge) return 0; // pre-commencement death: not modeled
  const { monthly, startYear } = commencementMonthly(p, inflationRate, memberBirthYear);
  const atDeath = monthly * indexingFactor(p, memberDeathYear - startYear, inflationRate);
  const survivorBase = atDeath * (pct / 100);
  return survivorBase * indexingFactor(p, calendarYear - memberDeathYear, inflationRate);
}
