import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  buildAnchoredComparison,
  completedMonthEnds,
  historyStartFor,
  monthEndHashes,
  validPrefix,
  type Snapshot,
} from "@/lib/snapshots";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Landmark, TrendingUp, Wallet } from "lucide-react";
import { usePortfolio } from "@/lib/portfolio";
import { getHistory } from "@/lib/history.functions";
import { Button } from "@/components/ui/button";
import {
  BENCHMARK_GROUPS,
  DEFAULT_BENCHMARKS,
  closeOn,
  contributionFlows,
  dateGrid,
  fxOn,
  includeStartFlowsForInterval,
  portfolioValueSeries,
  twrSubperiodReturn,
  type BenchmarkChoice,
  type SeriesMap,
} from "@/lib/benchmark";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  annualise,
  buildValuationSeries,
  cashBalance,
  cashTrackingIds,
  computePositions,
  formatCad,
  formatPct,
  xirr,
} from "@/lib/finance";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/performance")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Performance & Benchmarking — Apis Financial" },
      {
        name: "description",
        content:
          "Compare your portfolio against the S&P 500, S&P/TSX Composite and an all-equity global ETF using a cash-flow-matched simulation that buys the index on your exact deposit dates.",
      },
      { property: "og:title", content: "Performance & Benchmarking — Apis Financial" },
      {
        property: "og:description",
        content:
          "Cash-flow-matched benchmarking: see the real alpha of your portfolio versus the index.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PerformancePage,
});

const CHART_COLORS = ["var(--series-3)", "var(--series-4)", "var(--series-2)"];

const PERIODS: { id: string; label: string }[] = [
  { id: "YTD", label: "YTD" },
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "1Y", label: "1Y" },
  { id: "3Y", label: "3Y" },
  { id: "5Y", label: "5Y" },
  { id: "ALL", label: "Since inception" },
];

function PerformancePage() {
  const {
    accounts,
    holdings: allHoldings,
    transactions: allTransactions,
    quotes,
    fxUsdCad,
    loading,
  } = usePortfolio();
  const fetchHistory = useServerFn(getHistory);
  const { user } = useAuth();

  const [accountFilter, setAccountFilter] = useState<string>("all");

  const holdings = useMemo(
    () =>
      accountFilter === "all"
        ? allHoldings
        : allHoldings.filter((h) => h.account_id === accountFilter),
    [allHoldings, accountFilter],
  );
  const transactions = useMemo(
    () =>
      accountFilter === "all"
        ? allTransactions
        : allTransactions.filter((t) => t.account_id === accountFilter),
    [allTransactions, accountFilter],
  );

  const start = useMemo(() => {
    const dates = transactions.map((t) => t.transaction_date).sort();
    return dates[0] ?? new Date().toISOString().slice(0, 10);
  }, [transactions]);
  const end = new Date().toISOString().slice(0, 10);

  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(DEFAULT_BENCHMARKS.map((b) => [b.id, b.symbol])),
  );

  const selection: BenchmarkChoice[] = useMemo(
    () =>
      BENCHMARK_GROUPS.map((g) => {
        const symbol = picked[g.id] ?? g.options[0]!.symbol;
        const option = g.options.find((o) => o.symbol === symbol) ?? g.options[0]!;
        return {
          id: g.id,
          label: g.label,
          symbol: option.symbol,
          note: option.note,
          annualYield: option.annualYield,
        };
      }),
    [picked],
  );

  const positions = useMemo(
    () => computePositions(holdings, transactions, quotes, fxUsdCad),
    [holdings, transactions, quotes, fxUsdCad],
  );

  /**
   * Only positions still held need a price curve: a holding sold years ago is
   * already realised as cash, so pulling its daily closes is pure waste.
   */
  const symbols = useMemo(() => {
    const own = positions
      .filter((p) => Math.abs(p.units) > 1e-9)
      .map((p) => p.symbol.toUpperCase());
    const benches = selection.map((b) => b.symbol);
    return Array.from(new Set([...own, ...benches])).sort();
  }, [positions, selection]);

  const cashAccounts = useMemo(() => cashTrackingIds(accounts), [accounts]);

  // Month-end anchors: completed months come from stored snapshots, only the
  // months after the last valid one are valued live.
  const monthEnds = useMemo(() => completedMonthEnds(start, end), [start, end]);
  const hashes = useMemo(
    () => monthEndHashes(monthEnds, transactions, holdings, cashAccounts, accountFilter),
    [monthEnds, transactions, holdings, cashAccounts, accountFilter],
  );
  const stored = useQuery({
    queryKey: ["snapshots", user?.id, accountFilter],
    enabled: !!user && transactions.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<Snapshot[]> => {
      const out: Snapshot[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("portfolio_monthly_snapshots")
          .select("month_end, ledger_hash, portfolio_value, benchmarks")
          .eq("scope", accountFilter)
          .order("month_end")
          .range(from, from + 999);
        if (error) return out; // fall back to a full live calculation
        out.push(...((data ?? []) as unknown as Snapshot[]));
        if (!data || data.length < 1000) return out;
      }
    },
  });
  const benchSymbols = useMemo(() => selection.map((b) => b.symbol), [selection]);
  const [period, setPeriod] = useState<string>("ALL");
  const [mode, setMode] = useState<"TWR" | "MWR">("TWR");
  const periodStart = useMemo(() => {
    if (period === "ALL") return start;
    const now = new Date();
    if (period === "YTD") return `${now.getFullYear()}-01-01`;
    const months =
      period === "1M"
        ? 1
        : period === "3M"
          ? 3
          : period === "6M"
            ? 6
            : period === "1Y"
              ? 12
              : period === "3Y"
                ? 36
                : 60; // 5Y
    const day = now.getDate();
    const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    target.setUTCMonth(target.getUTCMonth() - months);
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target.toISOString().slice(0, 10);
  }, [period, start]);
  const anchors = useMemo(
    () => (stored.data ? validPrefix(monthEnds, hashes, stored.data, benchSymbols) : []),
    [stored.data, monthEnds, hashes, benchSymbols],
  );
  const historyStart = historyStartFor(anchors[anchors.length - 1], start);

  const history = useQuery({
    queryKey: ["history", symbols, historyStart, end],
    enabled: transactions.length > 0 && (!user || !stored.isLoading),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => fetchHistory({ data: { symbols, start: historyStart, end } }),
  });
  const benchmarkHistoryStart = useMemo(() => {
    const base = period === "ALL" ? start : periodStart;
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [period, periodStart, start]);
  const benchmarkHistory = useQuery({
    queryKey: ["benchmark-chart-history", benchSymbols, benchmarkHistoryStart, end],
    enabled: transactions.length > 0 && period === "ALL",
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async () =>
      fetchHistory({ data: { symbols: benchSymbols, start: benchmarkHistoryStart, end } }),
  });
  const chartHistory = useQuery({
    queryKey: ["performance-chart-history", symbols, benchmarkHistoryStart, end],
    enabled: transactions.length > 0 && period !== "ALL",
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => fetchHistory({ data: { symbols, start: benchmarkHistoryStart, end } }),
  });
  // Cash is floored at zero: a buy recorded without a matching deposit is
  // treated as an implied contribution rather than a negative cash balance.
  const portfolioValue =
    positions.reduce((s, p) => s + p.marketValue, 0) +
    Math.max(0, cashBalance(transactions, cashAccounts));

  const anchored = useMemo(() => {
    if (!history.data) return null;
    const map: SeriesMap = new Map();
    for (const s of history.data.series) {
      map.set(s.symbol.toUpperCase(), { currency: s.currency, points: s.points });
    }
    return buildAnchoredComparison({
      transactions,
      holdings,
      history: map,
      fx: history.data.fx,
      fxNow: fxUsdCad,
      portfolioEndValue: portfolioValue,
      selection,
      cashAccounts,
      windowStart: periodStart,
      anchors,
      monthEnds,
      hashes,
      benchmarkHistory: new Map(
        (benchmarkHistory.data?.series ?? []).map((s) => [
          s.symbol.toUpperCase(),
          { currency: s.currency, points: s.points },
        ]),
      ),
      benchmarkFx: benchmarkHistory.data?.fx ?? [],
    });
  }, [
    history.data,
    transactions,
    holdings,
    fxUsdCad,
    portfolioValue,
    selection,
    cashAccounts,
    periodStart,
    anchors,
    monthEnds,
    hashes,
    benchmarkHistory.data,
  ]);
  const comparison = anchored?.comparison ?? null;
  const costBasis = positions.reduce((sum, position) => sum + position.acb, 0);

  // Save newly completed months so the next visit starts from them.
  useEffect(() => {
    const fresh = anchored?.fresh ?? [];
    if (!user || fresh.length === 0) return;
    const existing = new Map((stored.data ?? []).map((s) => [s.month_end, s]));
    const rows = fresh.map((f) => {
      const old = existing.get(f.month_end);
      const benchmarks =
        old && old.ledger_hash === f.ledger_hash
          ? { ...old.benchmarks, ...f.benchmarks }
          : f.benchmarks;
      return { user_id: user.id, scope: accountFilter, ...f, benchmarks };
    });
    (async () => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("portfolio_monthly_snapshots")
          .upsert(rows.slice(i, i + 500), { onConflict: "user_id,scope,month_end" });
        if (error) {
          console.warn("[snapshots] save failed", error.message);
          return;
        }
      }
    })();
  }, [anchored, user, accountFilter, stored.data]);

  /** Both return charts use the same historical-close portfolio series. */
  const chartData = useMemo(() => {
    if (!comparison) return [];

    // Period views get their own valuation grid and history window. The
    // snapshot-backed comparison is intentionally coarse before its live tail;
    // using that grid here can pull the first chart point weeks before the
    // selected period and can include cash flows outside the requested range.
    if (period !== "ALL" && chartHistory.data) {
      const chartStart = periodStart > start ? new Date(`${periodStart}T00:00:00Z`) : null;
      chartStart?.setUTCDate(chartStart.getUTCDate() - 1);
      const baseDate = chartStart ? chartStart.toISOString().slice(0, 10) : start;
      const historyMap: SeriesMap = new Map(
        chartHistory.data.series.map((s) => [
          s.symbol.toUpperCase(),
          { currency: s.currency, points: s.points },
        ]),
      );
      const flows = contributionFlows(transactions, cashAccounts);
      const dates = new Set(dateGrid(baseDate, end, 100));
      dates.add(baseDate);
      dates.add(periodStart);
      for (const flow of flows) {
        if (flow.date >= baseDate && flow.date <= end) dates.add(flow.date);
      }
      const grid = [...dates].sort();
      const values = portfolioValueSeries(
        grid,
        transactions,
        holdings,
        historyMap,
        chartHistory.data.fx,
        fxUsdCad,
        cashAccounts,
      );
      const selected = grid.findIndex((date) => date >= periodStart);
      const base = Math.max(0, selected - 1);
      const rebase = (series: number[]): (number | null)[] => {
        const out: (number | null)[] = [];
        let chain = 1;
        for (let i = base; i < grid.length; i++) {
          if (i === base) {
            out.push(0);
            continue;
          }
          const previous = series[i - 1] ?? 0;
          const current = series[i] ?? 0;
          const periodReturn = twrSubperiodReturn(
            previous,
            current,
            flows,
            grid[i - 1]!,
            grid[i]!,
            includeStartFlowsForInterval(grid, series, start, i),
          );
          if (periodReturn != null) chain *= 1 + periodReturn;
          out.push(Math.round((chain - 1) * 10000) / 100);
        }
        return out;
      };
      const portfolioSeries =
        mode === "TWR" ? rebase(values) : values.slice(base).map((value) => value);
      const benchmarkSeries = selection.flatMap((benchmark) => {
        const hist = historyMap.get(benchmark.symbol.toUpperCase());
        if (!hist?.points.length) return [];
        const priceCad = (date: string): number | null => {
          const close = closeOn(hist.points, date);
          if (close == null) return null;
          return (
            close * (hist.currency === "USD" ? fxOn(chartHistory.data!.fx, date, fxUsdCad) : 1)
          );
        };
        const basePrice = priceCad(grid[base]!);
        if (basePrice == null || basePrice <= 0) return [];
        const annualYield = benchmark.annualYield ?? 0;
        const series: (number | null)[] = Array(grid.length).fill(null);
        if (mode === "TWR") {
          const baseTime = Date.parse(grid[base]!);
          for (let i = base; i < grid.length; i++) {
            const price = priceCad(grid[i]!);
            if (price == null) continue;
            const years = (Date.parse(grid[i]!) - baseTime) / (365 * 86_400_000);
            const growth = (price / basePrice) * Math.exp(annualYield * years);
            series[i] = Math.round((growth - 1) * 10000) / 100;
          }
        } else {
          const initial = values[base] ?? 0;
          if (initial > 0) {
            let units = initial / basePrice;
            let lastDate = grid[base]!;
            let flowIndex = flows.findIndex((flow) => flow.date > lastDate);
            // No later flows: without this the loop below reads flows[-1] and throws.
            if (flowIndex === -1) flowIndex = flows.length;
            for (let i = base; i < grid.length; i++) {
              const date = grid[i]!;
              if (i > base && annualYield > 0) {
                const days = (Date.parse(date) - Date.parse(lastDate)) / 86_400_000;
                units *= Math.exp((annualYield * days) / 365);
              }
              while (flowIndex < flows.length && flows[flowIndex]!.date <= date) {
                const flow = flows[flowIndex]!;
                if (flow.date > grid[base]!) {
                  const flowPrice = priceCad(flow.date);
                  if (flowPrice != null && flowPrice > 0) units += flow.amount / flowPrice;
                }
                flowIndex++;
              }
              const value = priceCad(date);
              if (value != null) series[i] = units * value;
              lastDate = date;
            }
          }
        }
        return [{ label: benchmark.label, series }];
      });
      const rows: Record<string, string | number>[] = [];
      for (let i = base; i < grid.length; i++) {
        const row: Record<string, string | number> = {
          date: grid[i]!,
          ts: Date.parse(`${grid[i]}T00:00:00Z`),
        };
        const portfolio = portfolioSeries[i - base];
        if (portfolio != null) row["Portfolio"] = portfolio;
        for (const benchmark of benchmarkSeries) {
          const value = benchmark.series[i];
          if (value != null) row[benchmark.label] = value;
        }
        rows.push(row);
      }
      return rows;
    }

    const grid = comparison.grid;
    const found = grid.findIndex((d) => d >= periodStart);
    if (found < 0) return [];
    const base = Math.max(0, found - 1);
    const flows = contributionFlows(transactions, cashAccounts);

    const rebase = (values: number[]): (number | null)[] => {
      const out: (number | null)[] = [];
      let chain = 1;
      for (let i = base; i < grid.length; i++) {
        if (i === base) {
          out.push(0);
          continue;
        }
        const prev = values[i - 1] ?? 0;
        const cur = values[i] ?? 0;
        const periodReturn = twrSubperiodReturn(
          prev,
          cur,
          flows,
          grid[i - 1]!,
          grid[i]!,
          includeStartFlowsForInterval(grid, values, start, i),
        );
        if (periodReturn != null) chain *= 1 + periodReturn;
        out.push(Math.round((chain - 1) * 10000) / 100);
      }
      return out;
    };

    /**
     * In time-weighted mode the benchmark curve is the ETF's pure total
     * return over the window — price change plus reinvested distributions —
     * with no cash-flow simulation, so a mid-window deposit can't distort
     * the index line the way it would the portfolio's own value series.
     */
    const histMap: SeriesMap = new Map();
    for (const s of benchmarkHistory.data?.series ?? []) {
      histMap.set(s.symbol.toUpperCase(), { currency: s.currency, points: s.points });
    }
    const benchTwr = (symbol: string, annualYield: number): (number | null)[] => {
      const hist = histMap.get(symbol.toUpperCase());
      const empty = grid.slice(base).map(() => null);
      if (!hist || hist.points.length === 0) return empty;
      const fx = benchmarkHistory.data?.fx ?? [];
      const priceCad = (date: string): number | null => {
        const close = closeOn(hist.points, date);
        if (close == null) return null;
        return close * (hist.currency === "USD" ? fxOn(fx, date, fxUsdCad) : 1);
      };
      const basePrice = priceCad(grid[base]!);
      if (basePrice == null || basePrice <= 0) return empty;
      const baseTs = Date.parse(grid[base]!);
      return grid.slice(base).map((date) => {
        const p = priceCad(date);
        if (p == null) return null;
        const years = Math.max(0, (Date.parse(date) - baseTs) / 86_400_000) / 365;
        const totalReturn = (p / basePrice) * Math.exp(annualYield * years);
        return Math.round((totalReturn - 1) * 10000) / 100;
      });
    };

    const portfolioSeries =
      mode === "TWR"
        ? rebase(comparison.portfolio)
        : comparison.portfolio.slice(base).map((value) => value);
    const benchSeries = comparison.benchmarks
      .filter((b) => b.available)
      .map((b) => ({
        label: b.label,
        series:
          mode === "TWR"
            ? benchTwr(b.symbol, b.annualYield ?? 0)
            : b.values.slice(base).map((value) => value),
      }));

    const rows: Record<string, string | number>[] = [];
    for (let i = base; i < grid.length; i++) {
      const k = i - base;
      const row: Record<string, string | number> = {
        date: grid[i]!,
        ts: Date.parse(grid[i]!),
      };
      const pv = portfolioSeries[k];
      if (pv != null) row["Portfolio"] = pv;
      for (const b of benchSeries) {
        const v = b.series[k];
        if (v != null) row[b.label] = v;
      }
      rows.push(row);
    }
    return rows;
  }, [
    comparison,
    period,
    periodStart,
    start,
    end,
    mode,
    benchmarkHistory.data,
    chartHistory.data,
    fxUsdCad,
    transactions,
    holdings,
    cashAccounts,
    selection,
  ]);
  const chartBenchmarks =
    period !== "ALL" && chartHistory.data
      ? selection.filter((benchmark) =>
          chartHistory.data!.series.some(
            (series) => series.symbol.toUpperCase() === benchmark.symbol.toUpperCase(),
          ),
        )
      : (comparison?.benchmarks ?? []).filter((benchmark) => benchmark.available);

  const allTimeReturns = useMemo(() => {
    if (!comparison || comparison.portfolio.length < 2) return { total: null, annual: null };
    const values = comparison.portfolio;
    let chain = 1;
    const flows = contributionFlows(transactions, cashAccounts);
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1] ?? 0;
      const cur = values[i] ?? 0;
      const periodReturn = twrSubperiodReturn(
        prev,
        cur,
        flows,
        comparison.grid[i - 1]!,
        comparison.grid[i]!,
        includeStartFlowsForInterval(comparison.grid, values, start, i),
      );
      if (periodReturn != null) chain *= 1 + periodReturn;
    }
    const total = (chain - 1) * 100;
    const years =
      (Date.parse(comparison.grid.at(-1)!) - Date.parse(comparison.grid[0]!)) /
      (365.25 * 86_400_000);
    return {
      total,
      annual: years >= 1 && chain > 0 ? (Math.pow(chain, 1 / years) - 1) * 100 : null,
    };
  }, [comparison, transactions, cashAccounts]);

  /** Give each chart mode an appropriate value range and breathing room. */
  const yDomain = useMemo((): [number, number] => {
    let min = mode === "TWR" ? 0 : Number.POSITIVE_INFINITY;
    let max = mode === "TWR" ? 0 : Number.NEGATIVE_INFINITY;
    for (const row of chartData) {
      for (const [k, v] of Object.entries(row)) {
        if (k === "date" || k === "ts" || typeof v !== "number") continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    const span = Math.max(max - min, mode === "TWR" ? 1 : Math.abs(max) * 0.02, 1);
    const padding = span * 0.08;
    return [min - padding, max + padding];
  }, [chartData, mode]);

  const spanDays =
    chartData.length > 1
      ? ((chartData[chartData.length - 1]!["ts"] as number) - (chartData[0]!["ts"] as number)) /
        86_400_000
      : 0;
  const formatTick = (ts: number) =>
    new Date(ts).toLocaleDateString("en-CA", {
      timeZone: "UTC",
      ...(spanDays > 400
        ? { month: "short", year: "2-digit" }
        : { month: "short", day: "numeric" }),
    });
  const formatChartValue = (v: number) =>
    mode === "TWR" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%` : formatCad(v);

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  };

  const netGain = comparison ? comparison.portfolioEnd - comparison.invested : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance &amp; benchmarking</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "TWR"
              ? "Time-weighted mode compares market performance without the timing effect of deposits or withdrawals."
              : "Money-weighted mode shows your portfolio value in CAD alongside a benchmark funded by the same cash flows."}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Account</p>
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts together</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_name} · {a.account_type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="Portfolio value"
          value={formatCad(portfolioValue)}
          hint={`Cost basis ${formatCad(costBasis)}`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Money-weighted return"
          value={formatPct(comparison?.portfolioMwrr ?? null)}
          hint="Annualised, exact cash-flow timing"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Time-weighted return"
          value={formatPct(allTimeReturns.annual ?? allTimeReturns.total)}
          hint={
            allTimeReturns.annual == null
              ? "Total since first transaction"
              : "Annualised, using historical closes"
          }
        />
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label="Net investment gain"
          value={netGain == null ? "—" : formatCad(netGain)}
          hint="Portfolio value less net cash added"
        />
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your portfolio vs the benchmarks
          </h2>
          <span className="text-xs text-muted-foreground">
            {periodStart > start ? periodStart : start} → {end}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                period === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "TWR", label: "Time-weighted (%)" },
              { id: "MWR", label: "Money-weighted value ($)" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                mode === m.id
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">
            {mode === "TWR"
              ? "Pure market performance, starting at 0% for this window."
              : "CAD value of your portfolio and the cash-flow-matched benchmark investments."}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {BENCHMARK_GROUPS.map((g) => (
            <div key={g.id} className="space-y-1">
              <p className="text-xs text-muted-foreground">{g.label}</p>
              <Select
                value={picked[g.id] ?? g.options[0]!.symbol}
                onValueChange={(v) => setPicked((prev) => ({ ...prev, [g.id]: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {g.options.map((o) => (
                    <SelectItem key={o.symbol} value={o.symbol}>
                      {o.symbol} · {o.note}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {loading ||
        history.isLoading ||
        (period === "ALL" && benchmarkHistory.isLoading) ||
        (period !== "ALL" && chartHistory.isLoading) ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading market history…</p>
        ) : transactions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Add some transactions and this chart will compare them against the index.
          </p>
        ) : history.isError ||
          !history.data ||
          (period === "ALL" && (benchmarkHistory.isError || !benchmarkHistory.data)) ||
          (period !== "ALL" && (chartHistory.isError || !chartHistory.data)) ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-destructive">
              {history.error instanceof Error && history.error.message
                ? history.error.message
                : benchmarkHistory.error instanceof Error && benchmarkHistory.error.message
                  ? benchmarkHistory.error.message
                  : chartHistory.error instanceof Error && chartHistory.error.message
                    ? chartHistory.error.message
                    : "Market history could not be loaded right now."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void history.refetch();
                if (period === "ALL") void benchmarkHistory.refetch();
                if (period !== "ALL") void chartHistory.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  minTickGap={40}
                  tickFormatter={formatTick}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={72}
                  domain={yDomain}
                  tickFormatter={(v: number) =>
                    mode === "TWR" ? `${v.toFixed(0)}%` : formatCad(v, 0)
                  }
                />
                {mode === "TWR" ? (
                  <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                ) : null}
                <Tooltip
                  formatter={(v: number, name: string) => [formatChartValue(v), name]}
                  labelFormatter={(ts: number) =>
                    new Date(ts).toLocaleDateString("en-CA", {
                      timeZone: "UTC",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  }
                  contentStyle={tooltipStyle}
                />

                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="linear"
                  dataKey="Portfolio"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={false}
                />
                {chartBenchmarks.map((b, i) => (
                  <Line
                    key={b.id}
                    type="linear"
                    dataKey={b.label}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Head-to-head (all-time)
        </h2>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Strategy</TableHead>
              <TableHead>Proxy</TableHead>
              <TableHead className="text-right">Value today</TableHead>
              <TableHead className="text-right">Annualised return</TableHead>
              <TableHead className="text-right">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Your portfolio</TableCell>
              <TableCell className="text-muted-foreground">Actual holdings</TableCell>
              <TableCell className="num text-right">{formatCad(portfolioValue)}</TableCell>
              <TableCell className="num text-right">
                {formatPct(comparison?.portfolioMwrr ?? null)}
              </TableCell>
              <TableCell className="num text-right text-muted-foreground">—</TableCell>
            </TableRow>
            {(
              comparison?.benchmarks ??
              selection.map((b) => ({
                ...b,
                available: false,
                endValue: 0,
                mwrr: null,
                values: [],
              }))
            ).map((b) => {
              const diff = b.available ? portfolioValue - b.endValue : null;
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.symbol} · {b.note}
                  </TableCell>
                  <TableCell className="num text-right">
                    {b.available ? formatCad(b.endValue) : "—"}
                  </TableCell>
                  <TableCell className="num text-right">{formatPct(b.mwrr)}</TableCell>
                  <TableCell
                    className={`num text-right ${
                      diff == null ? "" : diff >= 0 ? "text-emerald-500" : "text-destructive"
                    }`}
                  >
                    {diff == null ? "—" : `${diff >= 0 ? "+" : "−"}${formatCad(Math.abs(diff))}`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Simulation assumes every deposit bought the benchmark ETF at that day's closing price, in
          Canadian dollars. Benchmarks estimate total return by accruing the fund's indicative
          distribution yield; actual historical distribution payments may differ. Your own side
          counts the dividends recorded in your ledger. Holdings are valued at the actual market
          close on each date, so an early point can differ from the price you typed in the ledger.
          Canadian-listed prices go back 25 years; US-listed prices go back 10.
          {history.data?.missing?.length
            ? ` No price history found for ${history.data.missing.join(", ")} — those holdings are valued at your last recorded price.`
            : ""}
        </p>
      </div>
    </div>
  );
}



function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="num mt-2 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
