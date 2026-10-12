/**
 * Apply AI pre-sort decisions to the import review queue's checked set.
 *
 * Safety rules (the AI suggests, the human confirms):
 * - Only tranche items are affected. Outflows are never pre-checked by AI —
 *   classifying an outflow (e.g. as a HELOC repayment) has CRA consequences
 *   and stays a human decision.
 * - Decisions for unknown keys are ignored (the model must not invent items).
 * - Items with no decision keep the default: tranches checked, outflows unchecked.
 */
import type { ProposedItem } from "./smithCsvImport";

export interface PresortDecision {
  key: string;
  suggest_checked: boolean;
  reason: string;
}

export function applyPresortDecisions(
  items: ProposedItem[],
  decisions: PresortDecision[],
): { checked: Set<string>; notes: Record<string, string> } {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const checked = new Set<string>();
  const notes: Record<string, string> = {};
  for (const i of items) {
    if (i.kind === "tranche") checked.add(i.key);
  }
  for (const d of decisions) {
    const item = byKey.get(d.key);
    if (!item || item.kind !== "tranche") continue;
    if (d.suggest_checked) checked.add(d.key);
    else checked.delete(d.key);
    if (d.reason) notes[d.key] = d.reason;
  }
  return { checked, notes };
}
