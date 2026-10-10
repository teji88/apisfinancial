import { computeTax } from "@/lib/tax";
import type { ProvinceCode } from "@/lib/tax";

/** Marginal tax rate at a given income (finite-difference, $1,000 bump). */
export function marginalRateAt(income: number, province: ProvinceCode, age: number): number {
  const d = 1000;
  const base = Math.max(0, income);
  const t1 = computeTax({ ordinary: base, province, age }).total;
  const t2 = computeTax({ ordinary: base + d, province, age }).total;
  return (t2 - t1) / d;
}
