import { describe, expect, it } from "vitest";
import { isDoubtfulDividend } from "./dividend-reconcile";

const base = {
  kind: "missing" as const,
  awaitingPayDate: false,
  reasons: [] as string[],
  expected: 100,
};

describe("isDoubtfulDividend", () => {
  it("treats an unrecorded, dated, unflagged, positive suggestion as confident", () => {
    expect(isDoubtfulDividend(base)).toBe(false);
  });

  it("treats a fix as doubtful — it would overwrite a recorded entry", () => {
    expect(isDoubtfulDividend({ ...base, kind: "fix" })).toBe(true);
  });

  it("treats a dateless fallback suggestion as doubtful", () => {
    expect(isDoubtfulDividend({ ...base, awaitingPayDate: true })).toBe(true);
  });

  it("treats a flagged suggestion as doubtful", () => {
    expect(isDoubtfulDividend({ ...base, reasons: ["Amount differs"] })).toBe(true);
  });

  it("treats a zero expected amount as doubtful", () => {
    expect(isDoubtfulDividend({ ...base, expected: 0 })).toBe(true);
  });
});
