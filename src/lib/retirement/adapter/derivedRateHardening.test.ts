import { describe, expect, it } from "vitest";
import {
  deriveWithdrawalMarginalRate,
  type Projection,
  type YearRow,
} from "./oldApiAdapter";
import type { AnnualTaxCapture } from "../domain/types";

const baseRow = (overrides: Partial<YearRow> = {}): YearRow => ({
  age: 70,
  year: 2030,
  rrifDraw: 5000,
  lifDraw: 0,
  nonregDraw: 0,
  tfsaDraw: 0,
  cpp: 10000,
  oas: 8000,
  oasClawback: 0,
  otherIncome: 0,
  taxes: 2000,
  spending: 40000,
  shortfall: 0,
  pensionSplit: 0,
  effectiveCeiling: 0,
  meltdownFlag: false,
  people: [
    {
      label: "You",
      age: 70,
      rrifDraw: 5000,
      lifDraw: 0,
      nonregDraw: 0,
      tfsaDraw: 0,
      cpp: 10000,
      oas: 8000,
      oasClawback: 0,
      otherIncome: 0,
      taxableIncome: 23000,
      taxes: 2000,
      balances: { tfsa: 0, rrsp: 0, lira: 0, nonreg: 0, total: 0 },
    },
  ],
  balances: { tfsa: 50000, rrsp: 300000, lira: 0, nonreg: 50000, total: 400000 },
  ...overrides,
});

const baseCapture = (overrides: Partial<AnnualTaxCapture> = {}): AnnualTaxCapture => ({
  year: 2030,
  ages: { MAIN_USER: 70 },
  pensionSplitPercent: 0,
  province: "ON",
  inflationRate: 2.5,
  taxInputs: {
    MAIN_USER: { age: 70, rrspRrif: 5000, cpp: 10000, oas: 8000 },
    PARTNER: {},
  },
  ...overrides,
});

const baseProjection = (overrides: Partial<Projection> = {}): Projection => ({
  rows: [baseRow()],
  depletionAge: null,
  success: true,
  endingBalance: 400000,
  totalTaxes: 50000,
  totalClawback: 0,
  estateTax: 0,
  estateRegistered: 300000,
  annualTaxInputs: [baseCapture()],
  ...overrides,
});

/**
 * Regression tests: deriveWithdrawalMarginalRate must never throw.
 *
 * On 2026-10-12 the live Retirement page crashed for all visitors with the
 * app error boundary ("This page didn't load"). Root cause: this function ran
 * during render and made unguarded dereferences (cap.taxInputs.MAIN_USER,
 * cap.ages.*, r.people.length, projection.rows iteration) that throw
 * TypeErrors on any projection shape deviating from the ideal.
 *
 * A derived display value must never crash the page: the function now guards
 * every dereference and returns null on anything unexpected, and the call
 * site is additionally wrapped in try/catch.
 */
describe("deriveWithdrawalMarginalRate hardening: never throws", () => {
  it("does not throw on a well-formed single-person projection", () => {
    expect(() => deriveWithdrawalMarginalRate(baseProjection())).not.toThrow();
  });

  it("does not throw when projection.rows is undefined", () => {
    const p = baseProjection({ rows: undefined as unknown as YearRow[] });
    expect(() => deriveWithdrawalMarginalRate(p)).not.toThrow();
  });

  it("does not throw when a capture is missing taxInputs", () => {
    const cap = baseCapture({ taxInputs: undefined as unknown as AnnualTaxCapture["taxInputs"] });
    const p = baseProjection({ annualTaxInputs: [cap] });
    expect(() => deriveWithdrawalMarginalRate(p)).not.toThrow();
  });

  it("does not throw when a capture is missing ages", () => {
    const cap = baseCapture({ ages: undefined as unknown as AnnualTaxCapture["ages"] });
    const p = baseProjection({ annualTaxInputs: [cap] });
    expect(() => deriveWithdrawalMarginalRate(p)).not.toThrow();
  });

  it("does not throw when rows have undefined rrifDraw/lifDraw", () => {
    const row = baseRow({ rrifDraw: undefined as unknown as number, lifDraw: undefined as unknown as number });
    const p = baseProjection({ rows: [row] });
    let result: ReturnType<typeof deriveWithdrawalMarginalRate> = null;
    expect(() => {
      result = deriveWithdrawalMarginalRate(p);
    }).not.toThrow();
    // Must not produce a NaN rate
    if (result) expect(Number.isNaN(result.rate)).toBe(false);
  });

  it("does not throw when a row is missing people", () => {
    const row = baseRow({ people: undefined as unknown as YearRow["people"] });
    const p = baseProjection({ rows: [row] });
    expect(() => deriveWithdrawalMarginalRate(p)).not.toThrow();
  });

  it("does not throw on empty rows", () => {
    const p = baseProjection({ rows: [] });
    expect(deriveWithdrawalMarginalRate(p)).toBeNull();
  });

  it("does not throw when captures exist for other years only", () => {
    const cap = baseCapture({ year: 1999 });
    const p = baseProjection({ annualTaxInputs: [cap] });
    expect(deriveWithdrawalMarginalRate(p)).toBeNull();
  });
});
