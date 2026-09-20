import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  buildComparison,
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
  twrr,
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
        return { id: g.id, label: g.label, symbol: option.symbol, note: option.note };
      }),
    [picked],
  );

  const symbols = useMemo(() => {
    const own = holdings.map((h) => h.symbol.toUpperCase());
    const benches = selection.map((b) => b.symbol);
    return Array.from(new Set([...own, ...benches])).sort();
  }, [holdings, selection]);

  const history = useQuery({
    queryKey: ["history", symbols, start, end],
    enabled: transactions.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => fetchHistory({ data: { symbols, start, end } }),
  });

  const positions = useMemo(
    () => computePositions(holdings, transactions, quotes, fxUsdCad),
    [holdings, transactions, quotes, fxUsdCad],
  );
  const cashAccounts = useMemo(() => cashTrackingIds(accounts), [accounts]);
  // Cash is floored at zero: a buy recorded without a matching deposit is
  // treated as an implied contribution rather than a negative cash balance.
  const portfolioValue =
    positions.reduce((s, p) => s + p.marketValue, 0) +
    Math.max(0, cashBalance(transactions, cashAccounts));

  const valuation = useMemo(
    () => buildValuationSeries(transactions, holdings, quotes, fxUsdCad, cashAccounts),
    [transactions, holdings, quotes, fxUsdCad, cashAccounts],
  );
  const twrrTotal = twrr(valuation);
  const twrrAnnual = twrrTotal == null ? null : annualise(twrrTotal, valuation);

  const comparison = useMemo(() => {
    if (!history.data) return null;
    const map: SeriesMap = new Map();
    for (const s of history.data.series) {
      map.set(s.symbol.toUpperCase(), { currency: s.currency, points: s.points });
    }
    return buildComparison(
      transactions,
      holdings,
      map,
      history.data.fx,
      fxUsdCad,
      portfolioValue,
      selection,
      cashAccounts,
    );
  }, [history.data, transactions, holdings, fxUsdCad, portfolioValue, selection, cashAccounts]);

  const [period, setPeriod] = useState<string>("ALL");

  const periodStart = useMemo(() => {
    if (period === "ALL") return start;
    const d = new Date();
    if (period === "YTD") return `${d.getFullYear()}-01-01`;
    const months =
      period === "1M" ? 1
      : period === "3M" ? 3
      : period === "6M" ? 6
      : period === "1Y" ? 12
      : period === "3Y" ? 36
      : 60; // 5Y
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }, [period, start]);

  // Chart shows percentage change since the start of the chosen period so
  // portfolio and benchmarks are directly comparable over any window.
  const chartData = useMemo(() => {
    if (!comparison) return [];
    const firstIdx = comparison.grid.findIndex((d) => d >= periodStart);
    if (firstIdx < 0) return [];
    const base = (arr: number[]) => {
      const v = arr[firstIdx] ?? 0;
      return v > 0 ? v : null;
    };
    const portBase = base(comparison.portfolio);
    const benchBases = comparison.benchmarks.map((b) => base(b.values));
    const rows: Record<string, string | number>[] = [];
    for (let i = firstIdx; i < comparison.grid.length; i++) {
      const row: Record<string, string | number> = { date: comparison.grid[i]! };
      if (portBase) row.Portfolio = +(((comparison.portfolio[i] ?? 0) / portBase - 1) * 100).toFixed(2);
      comparison.benchmarks.forEach((b, bi) => {
        const bb = benchBases[bi];
        if (b.available && bb) row[b.label] = +(((b.values[i] ?? 0) / bb - 1) * 100).toFixed(2);
      });
      rows.push(row);
    }
    return rows;
  }, [comparison, periodStart]);

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  };

  const gainPct =
    comparison && comparison.invested > 0
      ? ((comparison.portfolioEnd - comparison.invested) / comparison.invested) * 100
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance &amp; benchmarking</h1>
          <p className="text-sm text-muted-foreground">
            Each benchmark buys the index ETF with your exact deposit dates and amounts, so the gap
            you see is real alpha — not a static overlay.
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
          hint={comparison ? `${formatCad(comparison.invested)} contributed` : undefined}
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
          value={formatPct(twrrAnnual ?? twrrTotal)}
          hint={twrrAnnual == null ? "Total since first trade" : "Annualised"}
        />
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label="Gain on contributions"
          value={formatPct(gainPct)}
          hint={
            comparison ? formatCad(comparison.portfolioEnd - comparison.invested) : undefined
          }
        />
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your portfolio vs the benchmarks
          </h2>
          <span className="text-xs text-muted-foreground">
            {Math.max(start, periodStart)} → {end}
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

        {loading || history.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading market history…</p>
        ) : transactions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Add some transactions and this chart will compare them against the index.
          </p>
        ) : history.isError || !history.data ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-destructive">
              {history.error instanceof Error && history.error.message
                ? history.error.message
                : "Market history could not be loaded right now."}
            </p>
            <Button size="sm" variant="secondary" onClick={() => history.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={56}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}%`, undefined]}
                  contentStyle={tooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="Portfolio"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={false}
                />
                {(comparison?.benchmarks ?? [])
                  .filter((b) => b.available)
                  .map((b, i) => (
                    <Line
                      key={b.id}
                      type="monotone"
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
          Head-to-head
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
            {(comparison?.benchmarks ?? selection.map((b) => ({ ...b, available: false, endValue: 0, mwrr: null, values: [] }))).map(
              (b) => {
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
              },
            )}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Simulation assumes every deposit bought the benchmark ETF at that day's closing price, in
          Canadian dollars, with no dividends reinvested on either side beyond what your ledger
          records. Holdings are valued at the actual market close on each date, so an early point
          can differ from the price you typed in the ledger. Canadian-listed prices go back 25
          years; US-listed prices go back 10.
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
