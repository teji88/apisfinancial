import { describe, expect, it } from "vitest";
import {
  importHoldingsFromAccounts,
  scoreAssetLocation,
  type LocatedHolding,
} from "./AssetLocation";

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

describe("explainers and disclaimer", () => {
  it("provides a factual explainer for every holding type", async () => {
    const { HOLDING_EXPLAINERS, LOCATION_DISCLAIMER } = await import("./AssetLocation");
    const types = Object.keys(HOLDING_EXPLAINERS);
    expect(types).toHaveLength(9);
    for (const t of types) {
      const text = HOLDING_EXPLAINERS[t as keyof typeof HOLDING_EXPLAINERS];
      expect(text.length).toBeGreaterThan(50);
      // Factual tone: no prescriptive advice language.
      expect(text.toLowerCase()).not.toMatch(/you should|we recommend|move your/);
    }
  });

  it("attaches the explainer and disclaimer to results", () => {
    const r = scoreAssetLocation({
      holdings: [holding({ taxType: "canadianListedUS", yield: 0.017647 })],
      marginalRate: 0.3,
    });
    expect(r.scores[0]!.explainer).toContain("0% treaty rate");
    expect(r.disclaimer).toContain("not financial, tax, or investment advice");
  });
});

describe("importHoldingsFromAccounts", () => {
  const pos = (o: Partial<Parameters<typeof importHoldingsFromAccounts>[0][number]> = {}) => ({
    symbol: "VFV",
    name: "Vanguard S&P 500",
    accountType: "TFSA",
    marketValueCad: 12345.678,
    yieldDecimal: 0.012,
    ...o,
  });

  it("maps symbol, value, yield, and account bucket", () => {
    const r = importHoldingsFromAccounts([pos()], []);
    expect(r.imported).toHaveLength(1);
    expect(r.skippedDuplicates).toBe(0);
    const h = r.imported[0];
    expect(h.name).toBe("VFV");
    expect(h.value).toBe(12345.68);
    expect(h.yield).toBe(0.012);
    expect(h.account).toBe("TFSA");
    expect(h.taxType).toBe("growthEquity");
    expect(h.id).toMatch(/^h-/);
  });

  it("maps registered and non-registered account types", () => {
    const r = importHoldingsFromAccounts(
      [
        pos({ symbol: "A", accountType: "RRSP" }),
        pos({ symbol: "B", accountType: "Spousal RRSP" }),
        pos({ symbol: "C", accountType: "LIRA" }),
        pos({ symbol: "D", accountType: "FHSA" }),
        pos({ symbol: "E", accountType: "Non-Registered" }),
        pos({ symbol: "F", accountType: "Corporate" }),
        pos({ symbol: "G", accountType: "Something Else" }),
      ],
      [],
    );
    const by = Object.fromEntries(r.imported.map((h) => [h.name, h.account]));
    expect(by).toEqual({
      A: "RRSP",
      B: "RRSP",
      C: "RRSP",
      D: "RRSP",
      E: "NON_REGISTERED",
      F: "NON_REGISTERED",
      G: "NON_REGISTERED",
    });
  });

  it("skips duplicates matching name+account case-insensitively", () => {
    const existing = [{ name: "vfv", account: "TFSA" as const }];
    const r = importHoldingsFromAccounts(
      [
        pos({ symbol: "VFV", accountType: "TFSA" }), // dup
        pos({ symbol: "VFV", accountType: "Non-Registered" }), // same symbol, different account → import
        pos({ symbol: "XEQT", accountType: "TFSA" }), // new
      ],
      existing,
    );
    expect(r.skippedDuplicates).toBe(1);
    expect(r.imported.map((h) => h.name)).toEqual(["VFV", "XEQT"]);
    expect(r.imported[0].account).toBe("NON_REGISTERED");
  });

  it("skips duplicates within the same import batch", () => {
    const r = importHoldingsFromAccounts(
      [pos({ symbol: "VFV" }), pos({ symbol: "vfv", accountType: "TFSA" })],
      [],
    );
    expect(r.imported).toHaveLength(1);
    expect(r.skippedDuplicates).toBe(1);
  });

  it("skips blank symbols and zero-value positions", () => {
    const r = importHoldingsFromAccounts(
      [pos({ symbol: "  " }), pos({ symbol: "ZERO", marketValueCad: 0 })],
      [],
    );
    expect(r.imported).toHaveLength(0);
    expect(r.skippedDuplicates).toBe(0);
  });

  it("defaults yield to 0 and clamps negative", () => {
    const r = importHoldingsFromAccounts(
      [pos({ symbol: "A", yieldDecimal: 0 }), pos({ symbol: "B", yieldDecimal: -0.5 })],
      [],
    );
    expect(r.imported[0].yield).toBe(0);
    expect(r.imported[1].yield).toBe(0);
  });
});
