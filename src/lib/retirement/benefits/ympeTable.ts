/**
 * Year's Maximum Pensionable Earnings (YMPE) history and projection.
 *
 * Sources: Canada.ca (CRA), Government of Newfoundland and Labrador.
 * Values are in nominal dollars for the calendar year.
 *
 * For years before 2000, values are interpolated from known anchor points:
 * 1995: $34,900, 1990: $28,900 (per published sources).
 * For future years beyond the last known, YMPE is projected at 2.5% annual growth
 * (approximate long-term wage growth).
 */

// Known YMPE values from CRA/Canada.ca
const KNOWN_YMPE: Record<number, number> = {
  2026: 74600,
  2025: 71300,
  2024: 68500,
  2023: 66600,
  2022: 64900,
  2021: 61600,
  2020: 58700,
  2019: 57400,
  2018: 55900,
  2017: 55300,
  2016: 54900,
  2015: 53600,
  2014: 52500,
  2013: 51100,
  2012: 50100,
  2011: 48300,
  2010: 47200,
  2009: 46300,
  2008: 44900,
  2007: 43700,
  2006: 42100,
  2005: 41100,
  2004: 40500,
  2003: 39900,
  2002: 39100,
  2001: 38300,
  2000: 37600,
  1995: 34900,
  1990: 28900,
  1985: 23400, // estimated from historical growth
  1980: 13100, // estimated
  1975: 7400,  // estimated
  1970: 5200,  // estimated
  1966: 5000,  // CPP inception
};

const LAST_KNOWN_YEAR = 2026;
const PROJECTION_GROWTH_RATE = 0.025; // 2.5% annual wage growth

/**
 * Get the YMPE for a given year.
 * For known years, returns the exact value.
 * For years between known anchors, linearly interpolates.
 * For future years, projects at 2.5% annual growth.
 * For years before 1966 (CPP inception), returns the 1966 value.
 */
export function getYmpe(year: number): number {
  if (KNOWN_YMPE[year] !== undefined) {
    return KNOWN_YMPE[year];
  }

  if (year > LAST_KNOWN_YEAR) {
    const baseYmpe = KNOWN_YMPE[LAST_KNOWN_YEAR]!;
    const yearsOut = year - LAST_KNOWN_YEAR;
    return Math.round(baseYmpe * Math.pow(1 + PROJECTION_GROWTH_RATE, yearsOut));
  }

  if (year < 1966) {
    return KNOWN_YMPE[1966]!;
  }

  // Interpolate between known anchors
  const years = Object.keys(KNOWN_YMPE).map(Number).sort((a, b) => a - b);
  let lowerYear = years[0]!;
  let upperYear = years[years.length - 1]!;

  for (let i = 0; i < years.length - 1; i++) {
    if (years[i]! <= year && year <= years[i + 1]!) {
      lowerYear = years[i]!;
      upperYear = years[i + 1]!;
      break;
    }
  }

  const lowerYmpe = KNOWN_YMPE[lowerYear]!;
  const upperYmpe = KNOWN_YMPE[upperYear]!;
  const fraction = (year - lowerYear) / (upperYear - lowerYear);
  return Math.round(lowerYmpe + fraction * (upperYmpe - lowerYmpe));
}

/**
 * Get the average YMPE over the 5 years ending in the given year.
 * Used in the CPP formula as the "average YMPE" for benefit calculation.
 */
export function getAverageYmpe(endYear: number): number {
  let sum = 0;
  for (let y = endYear - 4; y <= endYear; y++) {
    sum += getYmpe(y);
  }
  return sum / 5;
}
