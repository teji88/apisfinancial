import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Plus, Sparkle, Trash2, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { simulateBenchmark } from "@/lib/simulator.functions";
import {
  SIM_MAX_HOLDINGS,
  SIM_PERIODS,
  SIM_START_AMOUNT,
  type SimPeriod,
  type SimResult,
} from "@/lib/simulator";

const cad = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

type Row = { symbol: string; weight: string };

export function BenchmarkSimulator() {
  const run = useServerFn(simulateBenchmark);
  const [rows, setRows] = useState<Row[]>([
    { symbol: "", weight: "" },
    { symbol: "", weight: "" },
    { symbol: "", weight: "" },
  ]);
  const [period, setPeriod] = useState<SimPeriod>("5Y");
  const [withDividends, setWithDividends] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function submit() {
    const holdings = rows
      .map((r) => ({ symbol: r.symbol.trim().toUpperCase(), weight: Number(r.weight) || 0 }))
      .filter((r) => r.symbol.length > 0)
      .map((r) => ({ ...r, weight: r.weight > 0 ? r.weight : 1 }));
    if (holdings.length === 0) {
      setError("Add at least one ticker — for example ENB.TO or AAPL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await run({ data: { holdings, period } });
      if ("error" in res) {
        setError(res.error);
        setResult(null);
      } else {
        setResult(res);
      }
    } catch {
      setError("Something went wrong pulling market history. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const mode = withDividends ? "total" : "price";

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.dates.map((date, i) => {
      const point: Record<string, string | number> = { date, you: result.you[mode][i]! };
      for (const b of result.benchmarks) point[b.key] = b[mode][i]!;
      return point;
    });
  }, [result, mode]);

  const summary = useMemo(() => {
    if (!result) return null;
    const last = (values: number[]) => values[values.length - 1]!;
    const years = Math.max(
      0.25,
      (Date.parse(result.end) - Date.parse(result.start)) / (365.25 * 86_400_000),
    );
    const cagr = (v: number) => (Math.pow(v / result.amount, 1 / years) - 1) * 100;
    const you = last(result.you[mode]);
    return {
      years,
      you,
      youCagr: cagr(you),
      lines: result.benchmarks.map((b) => {
        const value = last(b[mode]);
        return { ...b, value, cagr: cagr(value), diff: you - value };
      }),
    };
  }, [result, mode]);

  return (
    <div className="honey-card overflow-hidden">
      <div className="border-b border-border/60 bg-accent/10 p-5 md:p-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-background/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-primary">
          <Sparkle className="h-3.5 w-3.5" /> No sign-in needed
        </p>
        <h2 className="mt-3 font-display text-2xl font-semibold md:text-3xl">
          Did you beat XEQT?
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Put in up to {SIM_MAX_HOLDINGS} of your biggest holdings and see how {cad(SIM_START_AMOUNT)}{" "}
          would have grown against Canada&apos;s all-in-one funds and the S&amp;P 500 — in Canadian
          dollars, with distributions reinvested.
        </p>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:p-6">
        <div className="space-y-4">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={row.symbol}
                  onChange={(e) => setRow(i, { symbol: e.target.value })}
                  placeholder={i === 0 ? "ENB.TO" : i === 1 ? "AAPL" : "Ticker"}
                  className="uppercase"
                  aria-label={`Holding ${i + 1} ticker`}
                />
                <Input
                  value={row.weight}
                  onChange={(e) => setRow(i, { weight: e.target.value })}
                  placeholder="%"
                  inputMode="decimal"
                  className="w-20"
                  aria-label={`Holding ${i + 1} weight`}
                />
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove holding"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {rows.length < SIM_MAX_HOLDINGS && (
              <Button
                variant="outline"
                size="sm"
                className="border-accent/50"
                onClick={() => setRows((prev) => [...prev, { symbol: "", weight: "" }])}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add a holding
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Canadian listings end in .TO. Leave the percentages blank to split evenly.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              How far back
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {SIM_PERIODS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={period === p.id ? "default" : "outline"}
                  className={period === p.id ? "honey-fill" : "border-accent/40"}
                  onClick={() => setPeriod(p.id)}
                >
                  {p.id === "MAX" ? "Max" : p.id}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/50 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Include dividends</p>
              <p className="text-xs text-muted-foreground">
                {withDividends ? "Total return" : "Share price only"}
              </p>
            </div>
            <Switch checked={withDividends} onCheckedChange={setWithDividends} />
          </div>

          <Button className="honey-fill w-full" onClick={() => void submit()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pulling market history
              </>
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" /> Compare
              </>
            )}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="min-h-[300px]">
          {!result && !busy && (
            <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border border-dashed border-accent/40 p-6 text-center text-sm text-muted-foreground">
              Your comparison will appear here.
            </div>
          )}

          {result && summary && (
            <div className="space-y-4">
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      minTickGap={48}
                      tickFormatter={(d: string) => d.slice(0, 7)}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={70}
                      tickFormatter={(v: number) => cad(v)}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) => [cad(v), name]}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        color: "hsl(var(--popover-foreground))",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="you"
                      name="Your picks"
                      stroke={result.you.color}
                      strokeWidth={2.5}
                      dot={false}
                    />
                    {result.benchmarks.map((b) => (
                      <Line
                        key={b.key}
                        type="monotone"
                        dataKey={b.key}
                        name={b.label}
                        stroke={b.color}
                        strokeWidth={1.6}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Your picks</p>
                  <p className="num text-xl font-semibold">{cad(summary.you)}</p>
                  <p className="text-xs text-muted-foreground">
                    {summary.youCagr.toFixed(1)}% a year
                  </p>
                </div>
                {summary.lines.map((b) => (
                  <div key={b.key} className="rounded-lg border border-border/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {b.label}
                    </p>
                    <p className="num text-xl font-semibold">{cad(b.value)}</p>
                    <p
                      className={`text-xs ${b.diff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                    >
                      You {b.diff >= 0 ? "beat" : "trail"} it by {cad(Math.abs(b.diff))} ·{" "}
                      {b.cagr.toFixed(1)}% a year
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {cad(result.amount)} invested on {result.start}, valued {result.end}. US prices are
                converted to Canadian dollars at the rate of each day.{" "}
                {withDividends
                  ? "Distributions are reinvested at each fund's indicative yield."
                  : "Share price only — distributions are excluded."}
                {result.missing.length > 0 && ` We have no history for ${result.missing.join(", ")}.`}
                {withDividends &&
                  result.noDividendData.length > 0 &&
                  ` No distribution data for ${result.noDividendData.join(", ")}, so they are treated as paying nothing.`}
              </p>

              <div className="rounded-lg border border-accent/50 bg-accent/15 p-4 text-center">
                <p className="text-sm font-medium">
                  Save this comparison and track live returns with cash-flow matching
                </p>
                <Button asChild className="honey-fill mt-3">
                  <Link to="/auth">Sign up for free</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
