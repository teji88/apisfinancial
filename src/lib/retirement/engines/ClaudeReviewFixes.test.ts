import { describe, expect, it } from "vitest";
import { runRetirementSimulation } from "./SimulationCoordinator";
import { oasAt, plannerInputsToScenario } from "../adapter/oldApiAdapter";
import { computePositions } from "@/lib/finance";
import type { RetirementScenario } from "../domain/types";
import type { PlannerInputs } from "../adapter/oldApiAdapter";

const person = {
  role: "MAIN_USER" as const,
  birthYear: 1980,
  birthMonth: 1,
  retirementAge: 65,
  cppAt65: 1000,
  cppStartAge: 65 as const,
  oasStartAge: 65 as const,
  oasResidenceYears: 40,
};

const base = {
  id: "claude-review-fixes",
  name: "Claude review fixes",
  household: {
    province: "AB" as const,
    stage: "BOTH_ALIVE" as const,
    people: [person],
  },
  goals: {
    retirementAge: 65,
    annualSpending: 60000,
    spendingBasis: "TODAYS_DOLLARS" as const,
    planningAge: 90,
  },
  accounts: [],
  assumptions: {
    inflationRate: 2,
    investmentReturn: 5,
    investmentFeeRate: 0.5,
    futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" as const,
  },
  strategy: {
    withdrawalPolicy: "TFSA_FIRST" as const,
    objective: "MAX_SUSTAINABLE_SPENDING" as const,
  },
  metadata: { createdAt: "2026-01-01", engineVersion: "test", rulesVersion: "test" },
} satisfies RetirementScenario;

describe("fix #8: household horizon uses the longest-lived person's planning age", () => {
  it("simulates until the LAST person reaches planning age, not the first", () => {
    const scenario: RetirementScenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          { ...person, birthYear: 1980 }, // reaches 90 in 2070
          { ...person, role: "PARTNER" as const, birthYear: 1985 }, // reaches 90 in 2075
        ],
      },
    };
    const result = runRetirementSimulation(scenario, 500_000, 2026);
    expect(result.status).toBe("COMPLETE");
    const lastDate = result.monthly[result.monthly.length - 1]!.date;
    // Must cover through Dec 2075 (younger partner's planning age), not stop at 2070.
    expect(new Date(lastDate).getUTCFullYear()).toBe(2075);
  });
});

describe("fix #10: retirement spending starts when everyone is retired", () => {
  it("holds spending at zero while one spouse still works", () => {
    const scenario: RetirementScenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          { ...person, birthYear: 1980, retirementAge: 60 }, // retires 2040
          { ...person, role: "PARTNER" as const, birthYear: 1980, retirementAge: 65 }, // retires 2045
        ],
      },
    };
    const result = runRetirementSimulation(scenario, 1_000_000, 2026);
    expect(result.status).toBe("COMPLETE");
    const yearOf = (d: string) => new Date(d).getUTCFullYear();
    // 2042: main retired, partner still working -> no retirement spending yet.
    const during = result.monthly.filter((m) => yearOf(m.date) === 2042);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((m) => m.spending === 0)).toBe(true);
    // 2046: both retired -> spending flows.
    const after = result.monthly.filter((m) => yearOf(m.date) === 2046);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((m) => m.spending > 0)).toBe(true);
  });

  it("is unchanged for a single person", () => {
    const result = runRetirementSimulation(base, 1_000_000, 2026);
    expect(result.status).toBe("COMPLETE");
    const yearOf = (d: string) => new Date(d).getUTCFullYear();
    // Born 1980, retires at 65 -> 2045. Spending starts that year.
    const before = result.monthly.filter((m) => yearOf(m.date) === 2044);
    expect(before.every((m) => m.spending === 0)).toBe(true);
    const after = result.monthly.filter((m) => yearOf(m.date) === 2046);
    expect(after.every((m) => m.spending > 0)).toBe(true);
  });
});

describe("fix #13: oasAt applies the deferral bonus for start ages 66-70", () => {
  const baseAnnual = 762.50 * 12;
  it("pays the unadjusted max at 65 with full residence", () => {
    expect(oasAt(65, 40)).toBeCloseTo(baseAnnual, 2);
  });
  it("adds 0.6% per month deferred (67 -> +14.4%)", () => {
    expect(oasAt(67, 40)).toBeCloseTo(baseAnnual * 1.144, 2);
  });
  it("caps the bonus at +36% for age 70 and beyond", () => {
    expect(oasAt(70, 40)).toBeCloseTo(baseAnnual * 1.36, 2);
    expect(oasAt(72, 40)).toBeCloseTo(baseAnnual * 1.36, 2);
  });
  it("scales by residence fraction", () => {
    expect(oasAt(65, 20)).toBeCloseTo(baseAnnual * 0.5, 2);
  });
});

describe("fix #4: standalone FEE does not inflate ACB", () => {
  it("leaves cost base at the buy cost when an account fee is recorded", () => {
    const holdings = [
      { id: "h1", account_id: "a1", symbol: "XEQT", name: "XEQT", asset_type: "ETF", currency: "CAD" },
    ];
    const transactions = [
      {
        id: "t1", account_id: "a1", holding_id: "h1", transaction_type: "BUY",
        units: 100, price_per_unit: 30, amount: 3000, currency: "CAD",
        fx_rate: 1, fee: 10, transaction_date: "2024-01-15",
      },
      {
        id: "t2", account_id: "a1", holding_id: "h1", transaction_type: "FEE",
        units: 0, price_per_unit: 0, amount: 50, currency: "CAD",
        fx_rate: 1, fee: 0, transaction_date: "2024-06-01",
      },
    ];
    const [pos] = computePositions(holdings, transactions, {}, 1.36);
    // ACB = buy cost incl. commission only; the $50 account fee is not part of cost base.
    expect(pos!.acb).toBeCloseTo(3010, 2);
    expect(pos!.acbPerUnit).toBeCloseTo(30.1, 2);
  });
});

describe("fix #11: adapter honors an explicit birth year", () => {
  const spec = {
    label: "self",
    age: 45,
    retirementAge: 65,
    cppAt65: 12000,
    cppStartAge: 65,
    oasStartAge: 65,
    oasFraction: 1,
    otherIncome: 0,
    balances: { tfsa: 0, rrsp: 0, lira: 0, nonreg: 0 },
    nonregGainRatio: 0.4,
  };
  const inputs = {
    retirementAge: 65,
    lifeExpectancy: 90,
    province: "AB",
    inflation: 2,
    desiredIncome: 60000,
    annualSavings: 0,
    savingsSplit: "custom" as const,
    self: spec,
    spouse: null,
  } as unknown as PlannerInputs;

  it("uses spec.birthYear when provided", () => {
    const scenario = plannerInputsToScenario(
      { ...inputs, self: { ...spec, birthYear: 1978 } },
      0,
    );
    expect(scenario.household.people[0]!.birthYear).toBe(1978);
  });

  it("falls back to currentYear - age otherwise", () => {
    const scenario = plannerInputsToScenario(inputs, 0);
    expect(scenario.household.people[0]!.birthYear).toBe(new Date().getFullYear() - 45);
  });
});
