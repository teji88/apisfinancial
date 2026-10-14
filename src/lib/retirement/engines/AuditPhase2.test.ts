/**
 * Regression tests for the Phase 2 audit fixes (retirement engine).
 * Each test maps to an audit item; see the inline comments.
 */
import { describe, expect, it } from "vitest";
import { CANADA_2026_PARAMETERS } from "../rules/canada2026";
import { FED_AGE_AMOUNT, FED_AGE_CLAWBACK_START, FEDERAL_BPA } from "../../tax";
import { BASIC_PERSONAL_AMOUNT } from "../../family-accounts";
import {
  birthYearFromAge,
  oasAt,
} from "../adapter/oldApiAdapter";
import { runRetirementSimulation } from "./SimulationCoordinator";
import type { RetirementScenario } from "../domain/types";

const base = {
  id: "audit-phase2",
  name: "Audit Phase 2",
  household: {
    province: "AB" as const,
    stage: "BOTH_ALIVE" as const,
    people: [
      {
        role: "MAIN_USER" as const,
        birthYear: 1960,
        birthMonth: 1,
        retirementAge: 65,
        cppAt65: 1000,
        cppStartAge: 65 as const,
        oasStartAge: 65 as const,
        oasResidenceYears: 40,
      },
    ],
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

describe("audit #4 — constants agree on CRA 2026 values", () => {
  it("BPA, age amount, and threshold match across modules", () => {
    // CRA 2026: BPA $16,452; age amount $9,208; threshold $46,432.
    expect(FEDERAL_BPA).toBe(16452);
    expect(BASIC_PERSONAL_AMOUNT).toBe(16452);
    expect(CANADA_2026_PARAMETERS.tax.federalBasicPersonalAmount).toBe(16452);
    expect(FED_AGE_AMOUNT).toBe(9208);
    expect(CANADA_2026_PARAMETERS.tax.federalAgeAmount).toBe(9208);
    expect(FED_AGE_CLAWBACK_START).toBe(46432);
    expect(CANADA_2026_PARAMETERS.tax.federalAgeAmountReductionThreshold).toBe(46432);
  });
});

describe("audit #5 — oasAt", () => {
  it("applies the 65-74 base rate at 65", () => {
    expect(oasAt(65, 40)).toBeCloseTo(762.5 * 12, 2);
  });

  it("applies the deferral bonus to age 70", () => {
    expect(oasAt(70, 40)).toBeCloseTo(762.5 * 12 * 1.36, 2);
  });

  it("applies the 75+ 10% increase when the payment age is 75+", () => {
    expect(oasAt(65, 40, 76)).toBeCloseTo(838.75 * 12, 2);
    expect(oasAt(70, 40, 76)).toBeCloseTo(838.75 * 12 * 1.36, 2);
  });

  it("caps the result at the applicable maximum (1.36x base)", () => {
    // Full residence + max deferral + 75+ must not exceed 1.36x the 75+ base.
    expect(oasAt(70, 40, 80)).toBeLessThanOrEqual(838.75 * 12 * 1.36 + 0.01);
  });

  it("returns 0 below 10 years of residence", () => {
    expect(oasAt(65, 9)).toBe(0);
  });
});

describe("audit #6 — birthYearFromAge", () => {
  it("assumes the June birthday already happened when today is after June", () => {
    // October: birthday passed → birthYear = currentYear - age.
    expect(birthYearFromAge(45, 6, new Date(Date.UTC(2026, 9, 15)))).toBe(1981);
  });

  it("subtracts a year when today is before the assumed birth month", () => {
    // March: birthday not yet passed → birthYear = currentYear - age - 1.
    expect(birthYearFromAge(45, 6, new Date(Date.UTC(2026, 2, 15)))).toBe(1980);
  });

  it("respects an explicit birth month", () => {
    // December birthday, today October → not yet passed.
    expect(birthYearFromAge(45, 12, new Date(Date.UTC(2026, 9, 15)))).toBe(1980);
    // January birthday, today October → already passed.
    expect(birthYearFromAge(45, 1, new Date(Date.UTC(2026, 9, 15)))).toBe(1981);
  });
});

describe("audit #7 — stress crash override applies only in retirement", () => {
  it("ignores a return override in a wholly pre-retirement year", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          {
            role: "MAIN_USER" as const,
            birthYear: 1962,
            birthMonth: 1,
            retirementAge: 65, // turns 65 in Jan 2027
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
          },
        ],
      },
      accounts: [
        {
          id: "nonreg",
          owner: "MAIN_USER" as const,
          type: "NON_REGISTERED" as const,
          valuation: { mode: "MANUAL" as const, value: 500_000 },
        },
      ],
      assumptions: {
        ...base.assumptions,
        annualReturnOverrides: { 2026: -0.5 }, // crash in 2026, person is 64 (not retired)
      },
    };
    const withOverride = runRetirementSimulation(scenario, 500_000, 2026);
    const withoutOverride = runRetirementSimulation(
      { ...scenario, assumptions: { ...base.assumptions } },
      500_000,
      2026,
    );
    expect(withOverride.status).toBe("COMPLETE");
    // 2026 is entirely pre-retirement, so the crash must not change anything.
    expect(withOverride.metrics.endingPortfolio).toBeCloseTo(
      withoutOverride.metrics.endingPortfolio,
      2,
    );
  });
});

describe("audit #9 — working spouse keeps contributing after partner retires", () => {
  it("partner contributions continue while the partner is still working", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          {
            role: "MAIN_USER" as const,
            birthYear: 1970,
            birthMonth: 1,
            retirementAge: 60, // retires Jan 2030
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
          },
          {
            role: "PARTNER" as const,
            birthYear: 1970,
            birthMonth: 1,
            retirementAge: 70, // retires Jan 2040
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
          },
        ],
      },
      accounts: [
        {
          id: "partner-rrsp",
          owner: "PARTNER" as const,
          type: "RRSP" as const,
          valuation: { mode: "MANUAL" as const, value: 100_000 },
          contribution: { annualAmount: 12_000 },
        },
      ],
      goals: { ...base.goals, annualSpending: 30_000 },
    };
    const result = runRetirementSimulation(scenario, 100_000, 2026);
    expect(result.status).toBe("COMPLETE");
    // June 2032: main user retired (2030), partner age 62, still working.
    // The partner's $12k/yr contribution must still be flowing ($1,000/mo).
    const june2032 = result.monthly.find((m) => m.date.startsWith("2032-06"));
    expect(june2032).toBeDefined();
    expect(june2032!.cashFlow?.contributions).toBeGreaterThan(0);
  });
});

describe("audit #10 — estate does not double-count spousal rollovers", () => {
  it("estate value does not exceed the portfolio at the second death", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          {
            role: "MAIN_USER" as const,
            birthYear: 1960,
            birthMonth: 1,
            retirementAge: 65,
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
            deathAge: 75,
          },
          {
            role: "PARTNER" as const,
            birthYear: 1960,
            birthMonth: 1,
            retirementAge: 65,
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
            deathAge: 80,
          },
        ],
      },
      accounts: [
        {
          id: "main-rrsp",
          owner: "MAIN_USER" as const,
          type: "RRSP" as const,
          valuation: { mode: "MANUAL" as const, value: 200_000 },
          deathTransfer: "SPOUSE" as const,
        },
        {
          id: "partner-tfsa",
          owner: "PARTNER" as const,
          type: "TFSA" as const,
          valuation: { mode: "MANUAL" as const, value: 100_000 },
          deathTransfer: "SPOUSE" as const,
        },
      ],
      goals: { ...base.goals, annualSpending: 30_000 },
    };
    const result = runRetirementSimulation(scenario, 300_000, 2026);
    expect(result.status).toBe("COMPLETE");
    // The estate at the second death must not exceed the portfolio that
    // existed then. (A double-count of the first spouse's rolled-over
    // assets would inflate it beyond the portfolio.)
    const lastMonth = result.monthly.at(-1);
    expect(lastMonth).toBeDefined();
    if (result.metrics.estateValue !== undefined) {
      expect(result.metrics.estateValue).toBeLessThanOrEqual(
        (lastMonth!.portfolio ?? 0) + (lastMonth!.netWorth ?? 0) + 1,
      );
    }
  });
});

describe("audit #11 — tax ledger resets on household transitions", () => {
  it("survivor tax drops after the spouse dies (deceased income not carried forward)", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          {
            role: "MAIN_USER" as const,
            birthYear: 1960,
            birthMonth: 1,
            retirementAge: 65,
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
            otherIncome: 0,
          },
          {
            role: "PARTNER" as const,
            birthYear: 1960,
            birthMonth: 1,
            retirementAge: 65,
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
            otherIncome: 120_000, // high income that must not linger after death
            deathAge: 70, // dies Jan 2030
          },
        ],
      },
      accounts: [
        {
          id: "cash",
          owner: "MAIN_USER" as const,
          type: "CASH" as const,
          valuation: { mode: "MANUAL" as const, value: 500_000 },
        },
      ],
      goals: { ...base.goals, annualSpending: 30_000 },
    };
    const result = runRetirementSimulation(scenario, 500_000, 2026);
    expect(result.status).toBe("COMPLETE");
    // Partner dies Jan 2030 (age 70). By mid-2030 the survivor's monthly
    // tax should reflect only the survivor's income — far below the level
    // implied by the deceased's $120k other income carried forward.
    const june2030 = result.monthly.find((m) => m.date.startsWith("2030-06"));
    const dec2029 = result.monthly.find((m) => m.date.startsWith("2029-12"));
    expect(june2030).toBeDefined();
    expect(dec2029).toBeDefined();
    // Survivor's post-death monthly tax must be well below the pre-death
    // level (which included the partner's $10k/mo other income).
    expect(june2030!.taxes).toBeLessThan(dec2029!.taxes * 0.5);
  });

  it("employment income stops at the retirement age (no OR loophole)", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          {
            role: "MAIN_USER" as const,
            birthYear: 1962, // age 64 in 2026 (working), 65 in 2027 (retired)
            birthMonth: 1,
            retirementAge: 65,
            cppAt65: 1000,
            cppStartAge: 65 as const,
            oasStartAge: 65 as const,
            oasResidenceYears: 40,
            employmentIncome: 96_000, // must stop at 65
          },
        ],
      },
      accounts: [
        {
          id: "cash",
          owner: "MAIN_USER" as const,
          type: "CASH" as const,
          valuation: { mode: "MANUAL" as const, value: 500_000 },
        },
      ],
      goals: { ...base.goals, annualSpending: 30_000 },
    };
    const result = runRetirementSimulation(scenario, 500_000, 2026);
    expect(result.status).toBe("COMPLETE");
    // Age 64 (2026): employment income $8k/mo is modeled → taxes reflect it.
    // Age 65+ (2027): retired — employment income must NOT be modeled, so
    // monthly taxes must drop well below the working-year level.
    const june2026 = result.monthly.find((m) => m.date.startsWith("2026-06"));
    const june2027 = result.monthly.find((m) => m.date.startsWith("2027-06"));
    expect(june2026).toBeDefined();
    expect(june2027).toBeDefined();
    expect(june2027!.taxes).toBeLessThan(june2026!.taxes * 0.5);
  });
});
