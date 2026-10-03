/**
 * Year's Additional Maximum Pensionable Earnings (YAMPE) history and projection.
 *
 * The YAMPE is the second earnings ceiling for CPP2, introduced January 1, 2024.
 * Earnings between YMPE and YAMPE are subject to the second additional CPP
 * contribution (4% employee/employer) and earn the second additional benefit
 * (33.33% replacement on the band).
 *
 * Sources: CRA (canada.ca), ESDC.
 * - 2024: $73,200 (107% of YMPE)
 * - 2025: $81,200
 * - 2026: $85,000
 * - 2027+: 114% of YMPE (per legislation)
 *
 * For future years beyond the last known, YAMPE is projected at 114% of the
 * projected YMPE.
 */

import { getYmpe } from "./ympeTable";

// Known YAMPE values from CRA
const KNOWN_YAMPE: Record<number, number> = {
  2026: 85000,
  2025: 81200,
  2024: 73200,
};

const LAST_KNOWN_YEAR = 2026;
// Post-2025, YAMPE is 114% of YMPE by legislation
const YAMPE_YMPE_RATIO = 1.14;

/**
 * Get the YAMPE for a given year.
 * Returns 0 for years before 2024 (CPP2 did not exist).
 * For known years, returns the exact CRA value.
 * For future years, projects at 114% of projected YMPE.
 */
export function getYampe(year: number): number {
  if (year < 2024) {
    return 0;
  }
  if (KNOWN_YAMPE[year] !== undefined) {
    return KNOWN_YAMPE[year];
  }
  if (year > LAST_KNOWN_YEAR) {
    return Math.round(getYmpe(year) * YAMPE_YMPE_RATIO);
  }
  // Should not happen (2024-2026 are all known), but fall back to ratio
  return Math.round(getYmpe(year) * YAMPE_YMPE_RATIO);
}

/**
 * Phase-in factors (βm) for the first additional CPP benefit.
 * From ESDC Fall 2025: 15% in 2019, 30% in 2020, 50% in 2021, 75% in 2022, 100% in 2023+.
 */
export function getFirstAdditionalPhaseIn(year: number): number {
  if (year < 2019) return 0;
  if (year === 2019) return 0.15;
  if (year === 2020) return 0.30;
  if (year === 2021) return 0.50;
  if (year === 2022) return 0.75;
  return 1.0; // 2023+
}

/** First additional replacement rate: 8.33% (total 33.33% with base 25%). */
export const FIRST_ADDITIONAL_RATE = 0.0833;

/** Second additional (CPP2) replacement rate: 33.33% on the YMPE-YAMPE band. */
export const SECOND_ADDITIONAL_RATE = 1 / 3;

/** Base CPP replacement rate: 25%. */
export const BASE_REPLACEMENT_RATE = 0.25;
