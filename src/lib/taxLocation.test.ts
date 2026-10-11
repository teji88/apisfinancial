import { describe, expect, it } from "vitest";
import {
  assessTaxLocation,
  isTreatyExemptAccountType,
  totalActionableDrag,
  TAX_LOCATION_DRAG_THRESHOLD,
} from "./taxLocation";

describe("isTreatyExemptAccountType", () => {
  it("matches RRSP-family types case-insensitively", () => {
    expect(isTreatyExemptAccountType("RRSP")).toBe(true);
    expect(isTreatyExemptAccountType("Spousal RRSP")).toBe(true);
    expect(isTreatyExemptAccountType("lira")).toBe(true);
    expect(isTreatyExemptAccountType("TFSA")).toBe(false);
    expect(isTreatyExemptAccountType("FHSA")).toBe(false);
    expect(isTreatyExemptAccountType("Non-Registered")).toBe(false);
    expect(isTreatyExemptAccountType(null)).toBe(false);
  });
});

describe("assessTaxLocation", () => {
  it("ticks treaty-exempt accounts regardless of yield", () => {
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 100_000,
      dividendYieldPct: 4,
      accountType: "RRSP",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("ok");
    expect(r.annualDrag).toBe(0);
  });

  it("flags a high-yield US payer in a TFSA with correct drag math", () => {
    // 4% yield x 15% x $50,000 = $300/yr
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 50_000,
      dividendYieldPct: 4,
      accountType: "TFSA",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("flag");
    expect(r.annualDrag).toBeCloseTo(300, 6);
    expect(r.message).toContain("Better in RRSP");
    expect(r.message).toContain("~$300/yr");
    expect(r.tooltip).toContain("unrecoverable");
  });

  it("notes foreign tax credit recovery for taxable accounts", () => {
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 50_000,
      dividendYieldPct: 4,
      accountType: "Non-Registered",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("flag");
    expect(r.tooltip).toContain("foreign tax credit");
  });

  it("ticks NVDA-type low-yield growth in TFSA with explanatory tooltip", () => {
    // 0.03% yield x 15% x $10,000 = $0.45/yr — below the $25 threshold
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 10_000,
      dividendYieldPct: 0.03,
      accountType: "TFSA",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("ok");
    expect(r.annualDrag).toBeLessThan(TAX_LOCATION_DRAG_THRESHOLD);
    expect(r.tooltip).toContain("tax-free");
    expect(r.tooltip).toContain("right home");
  });

  it("gives a softer hint when no treaty-exempt account exists", () => {
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 50_000,
      dividendYieldPct: 4,
      accountType: "TFSA",
      hasTreatyExemptAccount: false,
    });
    expect(r.status).toBe("hint");
    expect(r.message).toContain("future US purchases");
  });

  it("returns unknown (never a guess) without yield data", () => {
    const r = assessTaxLocation({
      currency: "USD",
      marketValueCad: 50_000,
      dividendYieldPct: null,
      accountType: "TFSA",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("unknown");
    expect(r.message).toBeNull();
    expect(r.tooltip).toContain("Not enough data");
  });

  it("returns unknown for non-USD holdings (v1 scope)", () => {
    const r = assessTaxLocation({
      currency: "CAD",
      marketValueCad: 50_000,
      dividendYieldPct: 4,
      accountType: "TFSA",
      hasTreatyExemptAccount: true,
    });
    expect(r.status).toBe("unknown");
  });
});

describe("totalActionableDrag", () => {
  it("sums only flagged drags", () => {
    const mk = (status: "ok" | "flag" | "hint" | "unknown", annualDrag: number) => ({
      status,
      message: null,
      tooltip: "",
      annualDrag,
    });
    expect(
      totalActionableDrag([mk("flag", 300), mk("flag", 100), mk("hint", 500), mk("ok", 0)]),
    ).toBe(400);
  });
});
