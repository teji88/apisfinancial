import { describe, expect, it } from "vitest";
import { assessSmithLedger, SMITH_DISCLAIMER, type SmithTrancheInput } from "./SmithTracker";

const baseTranche: SmithTrancheInput = {
  id: "t1",
  facility: "HELOC",
  drawDate: "2026-01-15",
  principal: 50_000,
  rate: 0.055,
  useOfFunds: "Non-registered brokerage — dividend ETF",
  eligible: true,
  purposeEvidence: "ETF pays monthly distributions; silent on policy otherwise",
  interestPaidYtd: 2_000,
  repayments: [],
  personalUse: false,
  personalUseDate: null,
  commingled: false,
  disposition: null,
  s201Deemed: 0,
  documents: "HELOC statement Jan 2026; trade confirmation",
};

describe("assessSmithLedger", () => {
  it("a clean tranche is fully deductible", () => {
    const r = assessSmithLedger([baseTranche]);
    const t = r.tranches[0];
    expect(t.deductible).toBe(true);
    expect(t.deductibleInterestYtd).toBe(2_000);
    expect(t.outstanding).toBe(50_000);
    expect(t.health).toBe("good");
    expect(r.totalDeductibleInterestYtd).toBe(2_000);
  });

  it("repayments reduce the outstanding balance", () => {
    const r = assessSmithLedger([
      { ...baseTranche, repayments: [{ date: "2026-06-01", amount: 10_000 }] },
    ]);
    expect(r.tranches[0].outstanding).toBe(40_000);
    expect(r.tranches[0].deductible).toBe(true);
  });

  it("borrowing for a TFSA is never deductible", () => {
    const r = assessSmithLedger([
      { ...baseTranche, useOfFunds: "TFSA contribution" },
    ]);
    const t = r.tranches[0];
    expect(t.deductible).toBe(false);
    expect(t.deductibleInterestYtd).toBe(0);
    expect(t.health).toBe("bad");
    expect(t.warnings.some((w) => w.includes("Line 22100"))).toBe(true);
  });

  it("personal use ends deductibility", () => {
    const r = assessSmithLedger([
      { ...baseTranche, personalUse: true, personalUseDate: "2026-08-01" },
    ]);
    const t = r.tranches[0];
    expect(t.deductible).toBe(false);
    expect(t.warnings.some((w) => w.includes("2026-08-01"))).toBe(true);
  });

  it("personal disposition ends deductibility; reinvestment preserves with a note", () => {
    const personal = assessSmithLedger([
      { ...baseTranche, disposition: { date: "2026-09-01", proceeds: 55_000, destination: "personal" } },
    ]);
    expect(personal.tranches[0].deductible).toBe(false);

    const reinvested = assessSmithLedger([
      { ...baseTranche, disposition: { date: "2026-09-01", proceeds: 55_000, destination: "reinvested" } },
    ]);
    expect(reinvested.tranches[0].deductible).toBe(true);
    expect(reinvested.tranches[0].warnings.some((w) => w.includes("Tennant"))).toBe(true);
  });

  it("commingling triggers the apportionment warning but preserves deductibility", () => {
    const r = assessSmithLedger([{ ...baseTranche, commingled: true }]);
    const t = r.tranches[0];
    expect(t.deductible).toBe(true);
    expect(t.health).toBe("warning");
    expect(t.warnings.some((w) => w.includes("1.43"))).toBe(true);
  });

  it("flags a no-dividend purpose problem", () => {
    const r = assessSmithLedger([
      { ...baseTranche, purposeEvidence: "Company stated it will not pay dividends" },
    ]);
    expect(r.tranches[0].warnings.some((w) => w.includes("Cassan"))).toBe(true);
  });

  it("totals deductible interest across tranches", () => {
    const r = assessSmithLedger([
      baseTranche,
      { ...baseTranche, id: "t2", interestPaidYtd: 1_500 },
      { ...baseTranche, id: "t3", interestPaidYtd: 3_000, personalUse: true },
    ]);
    expect(r.totalDeductibleInterestYtd).toBe(3_500);
  });

  it("is informational only", () => {
    const r = assessSmithLedger([baseTranche]);
    expect(r.disclaimer).toBe(SMITH_DISCLAIMER);
    expect(r.disclaimer.toLowerCase()).toContain("not tax advice");
  });
});

describe("distributions", () => {
  it("aggregates distributions by destination", () => {
    const result = assessSmithLedger([
      {
        ...baseTranche,
        distributions: [
          { date: "2026-03-01", amount: 500, destination: "mortgage" },
          { date: "2026-06-01", amount: 300, destination: "reinvested" },
          { date: "2026-09-01", amount: 200, destination: "personal" },
        ],
      },
      { ...baseTranche, id: "s-2", distributions: [{ date: "2026-04-01", amount: 100, destination: "mortgage" }] },
    ]);
    expect(result.distributions.mortgage).toBe(600);
    expect(result.distributions.reinvested).toBe(300);
    expect(result.distributions.personal).toBe(200);
    expect(result.distributions.total).toBe(1100);
  });
  it("defaults to zero distributions", () => {
    const result = assessSmithLedger([baseTranche]);
    expect(result.distributions.total).toBe(0);
  });
});
