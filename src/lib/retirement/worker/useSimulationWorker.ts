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
        setComparison(
          result as { results: StrategyComparison[]; best: WithdrawalPolicy },
        );
        setComparing(false);
      } else if (kind === "stress") {
        const r = result as StressTestResult;
        pendingStressRef.current.delete(id);
        setStressResults((prev) => ({ ...prev, [`${r.scenarioId}-${r.severity}`]: r }));
        if (pendingStressRef.current.size === 0) setStressing(false);
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
      post("compare", inputs, objective);
    },
    [post],
  );

  /** On-demand: run a single stress test scenario. */
  const runStress = useCallback(
    (inputs: PlannerInputs, scenarioId: StressScenario["id"], severity: StressSeverity) => {
      setStressing(true);
      const id = post("stress", inputs, undefined, { scenarioId, severity });
      if (id > 0) pendingStressRef.current.add(id);
    },
    [post],
  );

  /** Clear stress test results (e.g. when inputs change). */
  const clearStress = useCallback(() => {
    pendingStressRef.current.clear();
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
