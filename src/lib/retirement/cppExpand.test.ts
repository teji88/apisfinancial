import { describe, expect, it } from "vitest";
import { expandSimplifiedToDetailed } from "./cppExpand";

const BIRTH = 1986; // age 40 in 2026
const NOW = 2026;

describe("expandSimplifiedToDetailed", () => {
  it("spreads past avg income over the most recent N years", () => {
    const rows = expandSimplifiedToDetailed(
      { avgIncome: 60000, yearsWorked: 5, futureIncome: 0 },
      BIRTH,
      65,
      NOW,
    );
    expect(rows.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(rows.every((r) => r.earnings === 60000)).toBe(true);
  });

  it("fills future years with expected income up to min(retirementAge, 65)", () => {
    const rows = expandSimplifiedToDetailed(
      { avgIncome: 0, yearsWorked: 0, futureIncome: 80000 },
      BIRTH,
      60,
      NOW,
    );
    // Born 1986, retire at 60 → last future year 2046.
    expect(rows[0]!.year).toBe(2027);
    expect(rows[rows.length - 1]!.year).toBe(2046);
    expect(rows.every((r) => r.earnings === 80000)).toBe(true);
  });

  it("caps future years at 65 even when retirement age is later", () => {
    const rows = expandSimplifiedToDetailed(
      { avgIncome: 0, yearsWorked: 0, futureIncome: 80000 },
      BIRTH,
      70,
      NOW,
    );
    // 1986 + 65 = 2051.
    expect(rows[rows.length - 1]!.year).toBe(2051);
  });

  it("clamps past years to the contributory period (1966 / age 18)", () => {
    const rows = expandSimplifiedToDetailed(
      { avgIncome: 50000, yearsWorked: 60, futureIncome: 0 },
      1950,
      65,
      NOW,
    );
    // 1950 + 18 = 1968 > 1966 → earliest 1968.
    expect(rows[0]!.year).toBe(1968);
    expect(rows[rows.length - 1]!.year).toBe(NOW);
  });

  it("produces no rows for zero/negative inputs", () => {
    expect(
      expandSimplifiedToDetailed({ avgIncome: 0, yearsWorked: 10, futureIncome: 0 }, BIRTH, 65, NOW),
    ).toEqual([]);
    expect(
      expandSimplifiedToDetailed({ avgIncome: -5, yearsWorked: 10, futureIncome: -1 }, BIRTH, 65, NOW),
    ).toEqual([]);
  });

  it("returns rows sorted by year, past then future", () => {
    const rows = expandSimplifiedToDetailed(
      { avgIncome: 60000, yearsWorked: 2, futureIncome: 70000 },
      BIRTH,
      65,
      NOW,
    );
    const years = rows.map((r) => r.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(years.slice(0, 2)).toEqual([2025, 2026]);
    expect(years[2]).toBe(2027);
  });
});
