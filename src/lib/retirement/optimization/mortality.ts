/**
 * Mortality for the CPP/OAS timing optimizer.
 *
 * The optimizer needs full survival PROBABILITIES (qx vectors), not a single
 * life-expectancy number — a single "plan to age 87" discards the right tail,
 * which is where delay's value concentrates (MacDonald 2020; CIA/SOA 2020;
 * Milligan & Schirle 2025).
 *
 * Interface accepts qx vectors from any table (StatCan complete life tables,
 * CIA CPM2014 + improvement scale). The built-in default is a Gompertz law
 * calibrated to StatCan 2023 period life expectancy at 65 (19.7M / 22.3F);
 * swap in table vectors when available — no optimizer code changes needed.
 */

export type Sex = "M" | "F";

export interface MortalityTable {
  /** qx: probability of death between exact ages x and x+1. */
  qx: (age: number, sex: Sex) => number;
  /** Human-readable label, surfaced in results. */
  label: string;
}

/** Gompertz parameters calibrated to StatCan 2023 period LE at 65. */
const GOMPERTZ: Record<Sex, { a: number; b: number; e65: number }> = {
  M: { a: 2.371e-5, b: 0.095, e65: 19.7 },
  F: { a: 1.738e-5, b: 0.095, e65: 22.3 },
};

function gompertzQx(age: number, sex: Sex): number {
  const { a, b } = GOMPERTZ[sex];
  // qx ≈ 1 − exp(−μ(x)) with μ(x) = a·e^(b·x); clamp for very old ages.
  const mu = a * Math.exp(b * Math.min(age, 120));
  return Math.min(1, 1 - Math.exp(-mu));
}

/** Default table: Gompertz law calibrated to StatCan 2023 period LE65. */
export function defaultMortalityTable(): MortalityTable {
  return {
    qx: gompertzQx,
    label: "Gompertz(a,b) calibrated to StatCan 2023 period life expectancy at 65 (19.7M / 22.3F)",
  };
}

/** Build a table from explicit qx vectors (e.g. StatCan/CPM2014). */
export function tableFromQxVectors(
  male: Record<number, number>,
  female: Record<number, number>,
  label: string,
): MortalityTable {
  const pick = (vec: Record<number, number>, age: number): number => {
    const x = Math.floor(age);
    if (vec[x] !== undefined) return vec[x];
    // Beyond the table: hold the last rate (documented approximation).
    const keys = Object.keys(vec).map(Number).sort((a, b) => a - b);
    return vec[keys[keys.length - 1]!] ?? 1;
  };
  return {
    qx: (age, sex) => Math.min(1, Math.max(0, pick(sex === "M" ? male : female, age))),
    label,
  };
}

/**
 * Probability of surviving from exact age `fromAge` to exact age `toAge`,
 * with an optional longevity multiplier on qx (>1 = shorter-lived).
 */
export function survivalProbability(
  table: MortalityTable,
  fromAge: number,
  toAge: number,
  sex: Sex,
  longevityMultiplier = 1,
): number {
  if (toAge <= fromAge) return 1;
  let p = 1;
  const startYear = Math.floor(fromAge);
  const endYear = Math.ceil(toAge);
  for (let x = startYear; x < endYear; x++) {
    const q = Math.min(1, table.qx(x, sex) * longevityMultiplier);
    // Pro-rate partial first/last years.
    const frac =
      Math.min(x + 1, toAge) - Math.max(x, fromAge);
    p *= 1 - q * Math.max(0, Math.min(1, frac));
    if (p <= 0) return 0;
  }
  return p;
}
