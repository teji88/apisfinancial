/**
 * True fill-to-ceiling meltdown helpers (TAX_TARGETED withdrawal policy).
 *
 * The meltdown deliberately withdraws registered funds BEYOND the spending
 * need in low-income years, up to the OAS clawback ceiling (+ tolerance),
 * and parks the after-tax surplus in non-registered accounts. This is the
 * "correct" (not "cheap") implementation Gurteg chose on 2026-10-12.
 *
 * Design decisions (per the approved spec):
 * - Fill target is PER-PERSON: OAS clawback is assessed per individual, so
 *   each person's headroom = (threshold + tolerance) − their own taxable income.
 * - Pension splitting is preserved: all incremental-tax math goes through
 *   calculateHouseholdTax with the scenario's pensionSplitPercent.
 * - The meltdown never melts INTO the clawback zone it is trying to avoid:
 *   gross meltdown withdrawals are capped at headroom, and a forward-looking
 *   gate stops melting once no future breach is projected.
 */

import type { PersonRole } from "../domain/types";
import type { TaxIncomeComponents } from "./TaxEngine";
import { rrifMinimumFactor } from "./AccountEngine";

export interface FutureBreachInput {
  /** Current age of the person. */
  currentAge: number;
  /** Registered balance (RRSP/RRIF + LIRA/LIF), today's dollars. */
  registeredBalance: number;
  /** Expected real (after-inflation) investment return, e.g. 0.04. */
  realReturn: number;
  /**
   * Annual non-registered income expected at 72+ (OAS + CPP + other/DB
   * pension), today's dollars. Deliberately excludes future RRIF minimums —
   * those are projected from the balance.
   */
  fixedIncomeAt72: number;
  /** Clawback threshold + tolerance fill target, today's dollars. */
  threshold: number;
  /** Planning age (last age simulated). */
  planningAge: number;
}

/**
 * Forward-looking gate: would this person's income breach the clawback
 * threshold in a future year if we do nothing?
 *
 * Projects the registered balance forward at the real return, applies the
 * CRA RRIF minimum percentages from age 72, and checks whether
 * (RRIF minimum + fixed income) breaches the threshold in any future year.
 *
 * This is a heuristic, not a full projection: it ignores future spending
 * withdrawals (which would shrink the balance faster), so it errs toward
 * melting. The gate is re-evaluated every year, and melting stops by itself
 * once balances are drawn down enough that no breach is projected.
 */
export function projectFutureClawbackBreach(input: FutureBreachInput): boolean {
  let balance = Math.max(0, input.registeredBalance);
  if (balance <= 0) return false;
  const startAge = Math.max(72, Math.ceil(input.currentAge) + 1);
  for (let age = startAge; age <= input.planningAge; age++) {
    balance *= 1 + input.realReturn;
    const rrifMin = balance * rrifMinimumFactor(age);
    if (rrifMin + input.fixedIncomeAt72 > input.threshold) return true;
    balance = Math.max(0, balance - rrifMin);
  }
  return false;
}

/** Income components that count toward the OAS-clawback fill target. */
const INCOME_KEYS: (keyof TaxIncomeComponents)[] = [
  "employment",
  "cpp",
  "oas",
  "pension",
  "rrspRrif",
  "interest",
  "foreignIncome",
  "eligibleCanadianDividends",
  "nonEligibleCanadianDividends",
  "canadianDividends",
];

/**
 * Taxable income for clawback purposes from a TaxIncomeComponents ledger.
 * Capital gains count at the 50% inclusion rate, matching the engine's
 * year-to-date income estimate.
 */
export function clawbackIncomeOf(t: TaxIncomeComponents): number {
  let income = 0;
  for (const key of INCOME_KEYS) {
    const v = t[key];
    if (typeof v === "number") income += Math.max(0, v);
  }
  const gains = t.capitalGains;
  if (typeof gains === "number") income += Math.max(0, gains) * 0.5;
  return income;
}

/**
 * Merge year-to-date and current-month tax ledgers for one person.
 * Mirrors how SimulationCoordinator builds the tax basis for the year.
 */
export function mergeTaxInputs(
  yearToDate: TaxIncomeComponents,
  thisMonth: TaxIncomeComponents,
): TaxIncomeComponents {
  const merged: TaxIncomeComponents = { ...yearToDate };
  for (const [key, value] of Object.entries(thisMonth)) {
    if (key === "age" || typeof value !== "number") continue;
    const k = key as keyof TaxIncomeComponents;
    (merged as unknown as Record<string, number>)[k] =
      ((merged as unknown as Record<string, number>)[k] ?? 0) + value;
  }
  if (typeof thisMonth.age === "number") merged.age = thisMonth.age;
  return merged;
}

/** Roles in a household, for per-person meltdown iteration. */
export const MELTDOWN_ROLES: PersonRole[] = ["MAIN_USER", "PARTNER"];
