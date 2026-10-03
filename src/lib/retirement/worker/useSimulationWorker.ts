import { useEffect, useRef, useState, useCallback } from "react";
import type {
  PlannerInputs,
  Projection,
  StrategyComparison,
  StrategyObjective,
  StressScenario,
  StressSeverity,
  StressTestResult,
  WithdrawalPolicy,
} from "@/lib/retirement/adapter/oldApiAdapter";

type JobKind = "project" | "project-quick" | "earliest" | "compare" | "stress";

/**
 * Runs retirement engine jobs in a Web Worker so the UI thread never blocks.
 *
 * - `project` runs automatically (debounced) whenever inputs change — this is
 *   the live preview the user watches while editing.
 * - `earliest` and `compare` only run when explicitly requested via
 *   `runEarliest()` / `runCompare()` (on-demand).
 * - Stale responses are ignored: only the latest request per kind updates state.
 */
export function useSimulationWorker() {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const latestRef = useRef<Record<JobKind, number>>({ project: 0, "project-quick": 0, earliest: 0, compare: 0, stress: 0 });
  // Stress jobs are fired as a batch (one per scenario), so their replies must
  // accumulate instead of the single-latest-wins filter used by other kinds.
  const pendingStressRef = useRef<Set<number>>(new Set());
  // Fallback timers for when the worker doesn't respond (e.g. Safari issue).
  const compareFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stressFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Severities for the current stress batch (for main-thread fallback).
  const stressSeveritiesRef = useRef<Record<string, StressSeverity>>({});

  const [projection, setProjection] = useState<Projection | null>(null);
  const [projecting, setProjecting] = useState(false);
  const [earliest, setEarliest] = useState<number | null>(null);
  const [earliestLoading, setEarliestLoading] = useState(false);
  const [comparison, setComparison] = useState<{
    results: StrategyComparison[];
    best: WithdrawalPolicy;
  } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [stressResults, setStressResults] = useState<Record<string, StressTestResult>>({});
  const [stressing, setStressing] = useState(false);
  const [earliestProgress, setEarliestProgress] = useState<{ completed: number; total: number } | null>(null);
  const [compareProgress, setCompareProgress] = useState<{ completed: number; total: number } | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./simulationWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { id, kind, ok, result, error, progress } = e.data as {
        id: number;
        kind: JobKind;
        ok?: boolean;
        result?: unknown;
        error?: string;
        progress?: { completed: number; total: number };
      };
      // Ignore stale responses. Single-shot kinds (project, earliest, compare)
      // only honour the latest request; stress jobs accumulate as a batch, so
      // any reply whose id is still pending counts.
      if (kind === "stress") {
        if (!pendingStressRef.current.has(id)) {
          if (pendingStressRef.current.size === 0) setStressing(false);
          return;
        }
      } else if (id !== latestRef.current[kind]) {
        return;
      }

      // Progress updates (not final results)
      if (progress !== undefined) {
        if (kind === "earliest") setEarliestProgress(progress);
        if (kind === "compare") setCompareProgress(progress);
        return;
      }

      if (!ok) {
        setWorkerError(error ?? "Simulation failed");
        if (kind === "project") setProjecting(false);
        if (kind === "project-quick") setProjecting(false);
        if (kind === "earliest") setEarliestLoading(false);
        if (kind === "compare") setComparing(false);
        if (kind === "stress") {
          pendingStressRef.current.delete(id);
          if (pendingStressRef.current.size === 0) setStressing(false);
        }
        return;
      }

      if (kind === "project") {
        setProjection(result as Projection);
        setProjecting(false);
        // Full result arrived — any pending quick result is now stale.
        // (Quick uses its own id tracking, so this is just for clarity.)
      } else if (kind === "project-quick") {
        // Only use quick result if a full projection isn't already in flight
        // for newer inputs. The full projection will overwrite when done.
        setProjection(result as Projection);
        // Don't clear projecting — the full version is still coming.
      } else if (kind === "earliest") {
        setEarliest(result as number | null);
        setEarliestLoading(false);
      } else if (kind === "compare") {
        if (compareFallbackRef.current) {
          clearTimeout(compareFallbackRef.current);
          compareFallbackRef.current = null;
        }
        setComparison(
          result as { results: StrategyComparison[]; best: WithdrawalPolicy },
        );
        setComparing(false);
      } else if (kind === "stress") {
        const r = result as StressTestResult;
        pendingStressRef.current.delete(id);
        setStressResults((prev) => ({ ...prev, [`${r.scenarioId}-${r.severity}`]: r }));
        if (pendingStressRef.current.size === 0) {
          if (stressFallbackRef.current) {
            clearTimeout(stressFallbackRef.current);
            stressFallbackRef.current = null;
          }
          setStressing(false);
        }
      }
    };

    worker.onerror = (e) => {
      setWorkerError(e.message || "Worker error");
      setProjecting(false);
      setEarliestLoading(false);
      setComparing(false);
      setStressing(false);
    };

    return () => {
      if (compareFallbackRef.current) clearTimeout(compareFallbackRef.current);
      if (stressFallbackRef.current) clearTimeout(stressFallbackRef.current);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const post = useCallback((kind: JobKind, inputs: PlannerInputs, objective?: StrategyObjective, extra?: { scenarioId?: StressScenario["id"]; severity?: StressSeverity }) => {
    const worker = workerRef.current;
    if (!worker) return -1;
    const id = ++seqRef.current;
    latestRef.current[kind] = id;
    setWorkerError(null);
    worker.postMessage({ id, kind, inputs, objective, ...extra });
    return id;
  }, []);

  /** Live projection — call on every input change (debounced by caller). */
  const runProject = useCallback(
    (inputs: PlannerInputs) => {
      setProjecting(true);
      post("project", inputs);
    },
    [post],
  );

  /** Fast estimate — call immediately on input change (no debounce needed). */
  const runProjectQuick = useCallback(
    (inputs: PlannerInputs) => {
      // Don't set projecting — the full version controls the loading state.
      post("project-quick", inputs);
    },
    [post],
  );

  /** On-demand: find earliest sustainable retirement age. */
  const runEarliest = useCallback(
    (inputs: PlannerInputs) => {
      setEarliestLoading(true);
      setEarliestProgress(null);
      post("earliest", inputs);
    },
    [post],
  );

  /** On-demand: compare withdrawal strategies. */
  const runCompare = useCallback(
    (inputs: PlannerInputs, objective: StrategyObjective) => {
      setComparing(true);
      setWorkerError(null);
      const workerId = post("compare", inputs, objective);
      // Fallback: if the worker doesn't respond in 20s (e.g. Safari worker
      // issue), compute on the main thread instead.
      const fallbackTimer = setTimeout(async () => {
        // Check if still waiting (comparing still true and no result yet)
        let stillWaiting = false;
        setComparing((prev) => {
          stillWaiting = prev;
          return prev;
        });
        if (!stillWaiting) return;
        try {
          const { compareWithdrawalStrategies } = await import(
            "@/lib/retirement/adapter/oldApiAdapter"
          );
          const result = compareWithdrawalStrategies(inputs, objective);
          setComparison(result);
          setComparing(false);
        } catch (err) {
          setWorkerError(err instanceof Error ? err.message : "Comparison failed");
          setComparing(false);
        }
      }, 20000);
      // Clear the fallback timer if the worker responds (handled in onmessage
      // via setComparing(false) — but we need to clear the timer too).
      // We store it on a ref so onmessage can clear it.
      compareFallbackRef.current = fallbackTimer;
    },
    [post],
  );

  /** Clear a stale comparison (inputs changed). */
  const clearComparison = useCallback(() => {
    if (compareFallbackRef.current) {
      clearTimeout(compareFallbackRef.current);
      compareFallbackRef.current = null;
    }
    setComparison(null);
  }, []);

  /** On-demand: run a single stress test scenario. */
  const runStress = useCallback(
    (inputs: PlannerInputs, scenarioId: StressScenario["id"], severity: StressSeverity) => {
      const isFirstOfBatch = pendingStressRef.current.size === 0;
      if (isFirstOfBatch) stressSeveritiesRef.current = {};
      stressSeveritiesRef.current[scenarioId] = severity;
      setStressing(true);
      setWorkerError(null);
      const id = post("stress", inputs, undefined, { scenarioId, severity });
      if (id > 0) pendingStressRef.current.add(id);
      // Fallback: if the worker doesn't respond in 25s, compute on the main thread.
      if (isFirstOfBatch) {
        if (stressFallbackRef.current) clearTimeout(stressFallbackRef.current);
        const batchInputs = inputs;
        stressFallbackRef.current = setTimeout(async () => {
          if (pendingStressRef.current.size === 0) return;
          try {
            const { runStressTest, STRESS_SCENARIOS } = await import(
              "@/lib/retirement/adapter/oldApiAdapter"
            );
            const severities = stressSeveritiesRef.current;
            const results: Record<string, StressTestResult> = {};
            for (const s of STRESS_SCENARIOS) {
              const r = runStressTest(batchInputs, s.id, severities[s.id] ?? "moderate");
              results[`${r.scenarioId}-${r.severity}`] = r;
            }
            pendingStressRef.current.clear();
            setStressResults(results);
            setStressing(false);
          } catch (err) {
            setWorkerError(err instanceof Error ? err.message : "Stress test failed");
            pendingStressRef.current.clear();
            setStressing(false);
          }
        }, 25000);
      }
    },
    [post],
  );

  /** Clear stress test results (e.g. when inputs change). */
  const clearStress = useCallback(() => {
    pendingStressRef.current.clear();
    if (stressFallbackRef.current) {
      clearTimeout(stressFallbackRef.current);
      stressFallbackRef.current = null;
    }
    setStressResults({});
  }, []);

  return {
    projection,
    projecting,
    earliest,
    earliestLoading,
    runEarliest,
    comparison,
    comparing,
    runCompare,
    clearComparison,
    runProject,
    runProjectQuick,
    stressResults,
    stressing,
    runStress,
    clearStress,
    earliestProgress,
    compareProgress,
    workerError,
  };
}
