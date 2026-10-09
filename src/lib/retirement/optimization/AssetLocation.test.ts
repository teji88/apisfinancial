import { describe, expect, it } from "vitest";
import { scoreAssetLocation, type LocatedHolding } from "./AssetLocation";

function holding(overrides: Partial<LocatedHolding> = {}): LocatedHolding {
  return {
    id: "h1",
    name: "Test holding",
    taxType: "interest",
    value: 100_000,
    yield: 0.04,
    account: "NON_REGISTERED",
    ...overrides,
  };
}

describe("scoreAssetLocation", () => {
  it("matches the research drag vectors for interest (H1)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "interest", yield: 0.04 })],
      marginalRate: 0.3,
    });
    const s = r.scores[0]!;
    expect(s.dragByAccount.NON_REGISTERED).toBeCloseTo(1200, 6);
    expect(s.dragByAccount.TFSA).toBe(0);
    expect(s.dragByAccount.RRSP).toBe(0);
    expect(s.ranking).toEqual(["TFSA", "RRSP", "NON_REGISTERED"]);
    expect(s.annualSavingsIfMoved).toBeCloseTo(1200, 6);
  });

  it("matches the research drag vectors for eligible dividends (H2)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "eligibleDividend", yield: 0.035 })],
      marginalRate: 0.435,
    });
    const s = r.scores[0]!;
    // $3,500 × 28.10% = $984.
    expect(s.dragByAccount.NON_REGISTERED).toBeCloseTo(984, 0);
    expect(s.dragByAccount.TFSA).toBe(0);
    // TFSA beats non-reg; non-reg beats RRSP (DTC destroyed inside).
    expect(s.ranking).toEqual(["TFSA", "NON_REGISTERED", "RRSP"]);
  });

  it("encodes the VFV gotcha: RRSP does not shelter fund-level withholding (H4)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "canadianListedUS", yield: 0.017647, account: "RRSP" })],
      marginalRate: 0.435,
    });
    const s = r.scores[0]!;
    // 15% unrecoverable in BOTH TFSA and RRSP — the research's key correction.
    expect(s.dragByAccount.RRSP).toBeCloseTo(264.71, 1);
    expect(s.dragByAccount.TFSA).toBeCloseTo(264.71, 1);
    expect(s.dragByAccount.NON_REGISTERED).toBeCloseTo(768, 0);
    // At 43.5%, registered still beats non-reg despite the leak.
    expect(s.bestAccount).toBe("TFSA");
    expect(s.annualSavingsIfMoved).toBe(0); // already in RRSP ≈ TFSA
  });

  it("gives US direct holdings 0% in RRSP via treaty XXI(2) (H3)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "usDirect", yield: 0.017647, account: "TFSA" })],
      marginalRate: 0.3,
    });
    const s = r.scores[0]!;
    expect(s.dragByAccount.RRSP).toBe(0);
    expect(s.dragByAccount.TFSA).toBeCloseTo(264.71, 1);
    expect(s.bestAccount).toBe("RRSP");
    expect(s.annualSavingsIfMoved).toBeCloseTo(264.71, 1);
  });

  it("ranks non-registered first for swap ETFs (H8)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "swapBased", yield: 0, account: "TFSA" })],
      marginalRate: 0.435,
    });
    const s = r.scores[0]!;
    expect(s.ranking[0]).toBe("NON_REGISTERED");
  });

  it("matches the illustrative REIT breakdown math (H6)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "canadianReit", yield: 0.045 })],
      marginalRate: 0.3,
    });
    const s = r.scores[0]!;
    // $810 + $101.25 + $42.62 = $954.
    expect(s.dragByAccount.NON_REGISTERED).toBeCloseTo(954, 0);
    expect(s.bestAccount).toBe("TFSA");
  });

  it("prefers non-registered for foreign holdings at very low marginal rates (H5)", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "foreignNonUS", yield: 0.02, account: "TFSA" })],
      marginalRate: 0.1,
    });
    const s = r.scores[0]!;
    // t (10%) < WHT (15%): non-reg wins.
    expect(s.ranking[0]).toBe("NON_REGISTERED");
    expect(s.annualSavingsIfMoved).toBeCloseTo(300 - 200, 6);
  });

  it("sorts moves by savings and totals them", () => {
    const r = scoreAssetLocation({
      holdings: [
        holding({ id: "a", name: "GIC", taxType: "interest", yield: 0.04, value: 100_000, account: "NON_REGISTERED" }),
        holding({ id: "b", name: "VTI", taxType: "usDirect", yield: 0.017647, value: 100_000, account: "TFSA" }),
      ],
      marginalRate: 0.3,
    });
    expect(r.moves).toHaveLength(2);
    expect(r.moves[0]!.annualSavings).toBeGreaterThanOrEqual(r.moves[1]!.annualSavings);
    expect(r.totalAnnualSavings).toBeCloseTo(1200 + 264.71, 1);
    expect(r.moves[0]).toMatchObject({ from: "NON_REGISTERED", to: "TFSA" });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toContain("146(5)");
  });

  it("warns on hypothetical above-Alberta rates", () => {
    const r = scoreAssetLocation({
      holdings: [holding()],
      marginalRate: 0.535,
    });
    expect(r.warnings.some((w) => w.includes("48%"))).toBe(true);
  });
});
