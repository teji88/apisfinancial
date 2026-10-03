/**
 * Web Worker for retirement simulations.
 *
 * Runs the heavy engine calculations (projection, earliest-age optimizer,
 * strategy comparison) off the main thread so typing in the UI never freezes.
 *
 * Message protocol:
 *   In:  { id, kind: 'project' | 'earliest' | 'compare', inputs, objective? }
 *   Out: { id, kind, ok: true, result } | { id, kind, ok: false, error }
 */
import {
  projectRetirement,
  earliestRetirementAge,
  compareWithdrawalStrategies,
  type PlannerInputs,
  type StrategyObjective,
} from "../adapter/oldApiAdapter";

type Request =
  | { id: number; kind: "project"; inputs: PlannerInputs }
  | { id: number; kind: "earliest"; inputs: PlannerInputs }
  | { id: number; kind: "compare"; inputs: PlannerInputs; objective: StrategyObjective };

type Response =
  | { id: number; kind: string; ok: true; result: unknown }
  | { id: number; kind: string; ok: false; error: string };

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, kind, inputs } = e.data;
  try {
    let result: unknown;
    if (kind === "project") {
      result = projectRetirement(inputs);
    } else if (kind === "earliest") {
      result = earliestRetirementAge(inputs);
    } else if (kind === "compare") {
      result = compareWithdrawalStrategies(inputs, e.data.objective);
    } else {
      throw new Error(`Unknown job kind: ${kind}`);
    }
    const res: Response = { id, kind, ok: true, result };
    self.postMessage(res);
  } catch (err) {
    const res: Response = {
      id,
      kind,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
