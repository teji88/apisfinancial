/**
 * Web Worker for retirement simulations.
 *
 * Runs the heavy engine calculations (projection, earliest-age optimizer,
 * strategy comparison) off the main thread so typing in the UI never freezes.
 *
 * Message protocol:
 *   In:  { id, kind: 'project' | 'earliest' | 'compare', inputs, objective? }
 *   Out: { id, kind, ok: true, result, cached? } | { id, kind, ok: false, error }
 *
 * Results are cached by input hash (LRU, 50 entries) so toggling inputs
 * back and forth doesn't recompute.
 */
import {
  projectRetirement,
  projectQuick,
  earliestRetirementAge,
  compareWithdrawalStrategies,
  runStressTest,
  type PlannerInputs,
  type StrategyObjective,
  type StressScenario,
  type StressSeverity,
} from "../adapter/oldApiAdapter";

type Request =
  | { id: number; kind: "project"; inputs: PlannerInputs }
  | { id: number; kind: "project-quick"; inputs: PlannerInputs }
  | { id: number; kind: "earliest"; inputs: PlannerInputs }
  | { id: number; kind: "compare"; inputs: PlannerInputs; objective: StrategyObjective }
  | { id: number; kind: "stress"; inputs: PlannerInputs; scenarioId: StressScenario["id"]; severity: StressSeverity };

type Response =
  | { id: number; kind: string; ok: true; result: unknown; cached?: boolean }
  | { id: number; kind: string; ok: false; error: string }
  | { id: number; kind: string; progress: { completed: number; total: number } };

// Simple LRU cache: Map preserves insertion order, delete+re-set moves to end.
const CACHE_LIMIT = 50;
const cache = new Map<string, unknown>();

function hashRequest(data: Request): string {
  // Stable hash of kind + relevant params + inputs.
  // JSON.stringify is deterministic for our plain-object inputs.
  const key = data.kind === "compare"
    ? { kind: data.kind, objective: data.objective, inputs: data.inputs }
    : data.kind === "stress"
      ? { kind: data.kind, scenarioId: data.scenarioId, severity: data.severity, inputs: data.inputs }
      : { kind: data.kind, inputs: data.inputs };
  return JSON.stringify(key);
}

function cacheGet(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Refresh LRU position
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_LIMIT) {
    // Evict oldest (first key in insertion order)
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, kind, inputs } = e.data;
  try {
    // Check cache first (skip for streaming kinds when we add them)
    const cacheKey = hashRequest(e.data);
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) {
      const res: Response = { id, kind, ok: true, result: cached, cached: true };
      self.postMessage(res);
      return;
    }

    let result: unknown;
    if (kind === "project") {
      result = projectRetirement(inputs);
    } else if (kind === "project-quick") {
      result = projectQuick(inputs);
    } else if (kind === "earliest") {
      result = earliestRetirementAge(inputs, (completed, total) => {
        const progressRes: Response = { id, kind, progress: { completed, total } };
        self.postMessage(progressRes);
      });
    } else if (kind === "compare") {
      result = compareWithdrawalStrategies(inputs, e.data.objective);
    } else if (kind === "stress") {
      result = runStressTest(inputs, e.data.scenarioId, e.data.severity);
    } else {
      throw new Error(`Unknown job kind: ${kind}`);
    }
    cacheSet(cacheKey, result);
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
