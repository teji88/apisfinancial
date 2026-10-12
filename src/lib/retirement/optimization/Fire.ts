/**
 * FIRE (Financial Independence, Retire Early) calculator math.
 *
 * Pure, deterministic, today's dollars. All returns are REAL (after inflation).
 * Informational only — no recommendations.
 */

export interface FireInputs {
  /** Desired annual retirement spending, today's dollars. */
  annualSpend: number;
  /** Safe withdrawal rate as a decimal, e.g. 0.04. */
  withdrawalRate: number;
  /** Expected real annual return as a decimal, e.g. 0.05. */
  realReturn: number;
  /** Years from now until the planned retirement age. */
  yearsToRetirement: number;
  /** Invested assets today (excludes home equity). */
  currentInvested: number;
  /** New savings per year, today's dollars. */
  annualContribution: number;
}

export interface FireResult {
  /** Classic FIRE number: the portfolio that funds `annualSpend` at `withdrawalRate`. */
  fireNumber: number;
  /** Coast FIRE number: what must be invested today to reach `fireNumber` by retirement. */
  coastNumber: number;
  /** Progress toward the classic FIRE number, 0..1. */
  progress: number;
  /**
   * Years until the coast number is reached at current savings pace,
   * 0 when already coasted, null when unreachable.
   */
  yearsToCoast: number | null;
}

/**
 * Classic FIRE number: the portfolio that sustains `annualSpend`
 * at the given withdrawal rate (default 4%).
 */
export function classicFireNumber(annualSpend: number, withdrawalRate = 0.04): number {
  if (annualSpend <= 0 || withdrawalRate <= 0) return 0;
  return annualSpend / withdrawalRate;
}

/**
 * Coast FIRE number: the amount that must be invested TODAY so that
 * compounding alone reaches `fireNumber` in `yearsToRetirement` years.
 * No further contributions assumed after today.
 */
export function coastFireNumber(
  fireNumber: number,
  yearsToRetirement: number,
  realReturn: number,
): number {
  if (fireNumber <= 0) return 0;
  if (yearsToRetirement <= 0 || realReturn <= 0) return fireNumber;
  return fireNumber / Math.pow(1 + realReturn, yearsToRetirement);
}

/**
 * Years until `coastNumber` is reached, solving
 *   FV = PV·(1+r)^n + PMT·(((1+r)^n − 1)/r) = coastNumber
 * for n (ordinary annuity — contributions at each year end).
 *
 * Returns 0 when already coasted, null when unreachable
 * (no growth and contributions that can never close the gap).
 */
export function yearsToCoastFire(
  currentInvested: number,
  annualContribution: number,
  coastNumber: number,
  realReturn: number,
): number | null {
  if (coastNumber <= 0) return 0;
  const pv = Math.max(0, currentInvested);
  if (pv >= coastNumber) return 0;

  if (realReturn <= 0) {
    // No growth: linear savings only.
    if (annualContribution <= 0) return null;
    return (coastNumber - pv) / annualContribution;
  }

  const r = realReturn;
  // x = (1+r)^n. PV·x + PMT·(x−1)/r = coast
  //   → x·(PV + PMT/r) = coast + PMT/r
  const denom = pv + annualContribution / r;
  if (denom <= 0) return null;
  const x = (coastNumber + annualContribution / r) / denom;
  if (x <= 1) return 0;
  return Math.log(x) / Math.log(1 + r);
}

/** Progress toward the FIRE number, clamped to 0..1. */
export function fireProgress(currentInvested: number, fireNumber: number): number {
  if (fireNumber <= 0) return 0;
  return Math.min(1, Math.max(0, currentInvested / fireNumber));
}

/** Convenience wrapper computing the full FIRE picture. */
export function computeFire(inputs: FireInputs): FireResult {
  const fireNumber = classicFireNumber(inputs.annualSpend, inputs.withdrawalRate);
  const coastNumber = coastFireNumber(
    fireNumber,
    inputs.yearsToRetirement,
    inputs.realReturn,
  );
  return {
    fireNumber,
    coastNumber,
    progress: fireProgress(inputs.currentInvested, fireNumber),
    yearsToCoast: yearsToCoastFire(
      inputs.currentInvested,
      inputs.annualContribution,
      coastNumber,
      inputs.realReturn,
    ),
  };
}
