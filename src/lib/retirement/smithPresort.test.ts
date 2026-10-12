import { describe, expect, it } from "vitest";
import { applyPresortDecisions } from "./smithPresort";
import type { ProposedItem } from "./smithCsvImport";

const tranche = (key: string): ProposedItem => ({
  kind: "tranche",
  key,
  date: "2024-01-15",
  amount: 1000,
  symbol: "VFV",
  note: "Buy VFV — inferred draw from HELOC",
});
const outflow = (key: string): ProposedItem => ({
  kind: "outflow",
  key,
  date: "2024-02-01",
  amount: 500,
  symbol: null,
  note: "Cash out — classify before recording",
  classification: null,
});

describe("applyPresortDecisions", () => {
  it("unchecks tranches the AI flags, with reasons", () => {
    const { checked, notes } = applyPresortDecisions(
      [tranche("a"), tranche("b")],
      [{ key: "b", suggest_checked: false, reason: "Tiny amount, looks unrelated." }],
    );
    expect(checked.has("a")).toBe(true);
    expect(checked.has("b")).toBe(false);
    expect(notes["b"]).toBe("Tiny amount, looks unrelated.");
  });

  it("never pre-checks outflows, even when the AI suggests it", () => {
    const { checked } = applyPresortDecisions(
      [tranche("a"), outflow("o")],
      [{ key: "o", suggest_checked: true, reason: "Looks like a repayment." }],
    );
    expect(checked.has("o")).toBe(false);
    expect(checked.has("a")).toBe(true);
  });

  it("ignores decisions for unknown keys", () => {
    const { checked, notes } = applyPresortDecisions(
      [tranche("a")],
      [{ key: "ghost", suggest_checked: false, reason: "Invented." }],
    );
    expect(checked.has("a")).toBe(true);
    expect(notes["ghost"]).toBeUndefined();
  });

  it("keeps the default (tranches checked) for items with no decision", () => {
    const { checked } = applyPresortDecisions([tranche("a"), tranche("b"), outflow("o")], []);
    expect(checked).toEqual(new Set(["a", "b"]));
  });
});
