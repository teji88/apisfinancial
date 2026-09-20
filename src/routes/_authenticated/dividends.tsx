import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, Coins, Percent, Sprout } from "lucide-react";
import { toast } from "sonner";
import { usePortfolio, useAddTransaction } from "@/lib/portfolio";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";

import { computePositions, formatCad, formatPct, formatUnits } from "@/lib/finance";
import {
  buildDividendRows,
  monthlyIncome,
  pendingDividends,
  projectIncome,
} from "@/lib/dividends";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dividends")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Dividends — Apis Financial" },
      {
        name: "description",
        content:
          "Forward annual dividend income, portfolio yield, yield on cost, trailing 12-month income and a ten-year compounder projection for your Canadian portfolio.",
      },
      { property: "og:title", content: "Dividends — Apis Financial" },
      {
        property: "og:description",
        content: "Track dividend income, yield on cost and project ten years of compounding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DividendsPage,
});

type ReviewDraft = {
  key: string;
  holdingId: string;
  accountId: string;
  symbol: string;
  currency: string;
  date: string;
  units: number;
  perShare: number;
  amount: number;
};

const DISMISSED_KEY = "maplewealth.dismissedDividends";

function loadDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function DividendsPage() {
  const { accounts, holdings, transactions, quotes, fxUsdCad, pricesAsOf, loading } =
    usePortfolio();
  const addTransaction = useAddTransaction();
  const { entitlement } = useEntitlement();
  const [recording, setRecording] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);


  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const saveDismissed = (next: string[]) => {
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — dismissal lasts for this visit only */
    }
  };


  const [growth, setGrowth] = useState(6);
  const [priceGrowth, setPriceGrowth] = useState(6);
  const [monthly, setMonthly] = useState(500);
  const [drip, setDrip] = useState(true);

  const positions = useMemo(
    () => computePositions(holdings, transactions, quotes, fxUsdCad),
    [holdings, transactions, quotes, fxUsdCad],
  );

  const rows = useMemo(
    () => buildDividendRows(positions, quotes, transactions, fxUsdCad),
    [positions, quotes, transactions, fxUsdCad],
  );

  const months = useMemo(() => monthlyIncome(transactions), [transactions]);
  const allPending = useMemo(
    () => pendingDividends(rows, transactions, holdings),
    [rows, transactions, holdings],
  );
  const pending = useMemo(
    () => allPending.filter((p) => !dismissed.includes(p.holdingId + p.exDivDate)),
    [allPending, dismissed],
  );
  const hiddenCount = allPending.length - pending.length;

  const totals = useMemo(() => {
    const marketValue = rows.reduce((s, r) => s + r.marketValue, 0);
    const acb = rows.reduce((s, r) => s + r.acb, 0);
    const forward = rows.reduce((s, r) => s + r.forwardIncome, 0);
    const received = months.reduce((s, m) => s + m.amount, 0);
    return {
      marketValue,
      acb,
      forward,
      received,
      yieldPct: marketValue > 0 ? (forward / marketValue) * 100 : null,
      yocPct: acb > 0 ? (forward / acb) * 100 : null,
    };
  }, [rows, months]);

  const projection = useMemo(
    () =>
      projectIncome({
        startingValue: totals.marketValue,
        startingIncome: totals.forward,
        dividendGrowthPct: growth,
        priceGrowthPct: priceGrowth,
        monthlyContribution: monthly,
        drip,
      }),
    [totals.marketValue, totals.forward, growth, priceGrowth, monthly, drip],
  );

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.account_type} · ${a.account_name}` : "—";
  };

  const openReview = (p: (typeof pending)[number]) => {
    if (entitlement.readOnly) {
      setUpgradeOpen(true);
      return;
    }
    setReview({
      key: p.holdingId + p.exDivDate,
      holdingId: p.holdingId,
      accountId: p.accountId,
      symbol: p.symbol,
      currency: p.currency,
      date: p.exDivDate,
      units: p.units,
      perShare: p.perShare,
      amount: Number(p.amount.toFixed(2)),
    });
  };

  const record = async (draft: ReviewDraft) => {
    setRecording(draft.key);
    try {
      const holding = holdings.find((h) => h.id === draft.holdingId);
      await addTransaction.mutateAsync({
        accountId: draft.accountId,
        symbol: draft.symbol,
        name: holding?.name ?? null,
        assetType: holding?.asset_type ?? "Stock",
        transactionType: "DIVIDEND",
        units: 0,
        pricePerUnit: 0,
        amount: Number(draft.amount.toFixed(2)),
        currency: draft.currency,
        fxRate: draft.currency === "USD" ? fxUsdCad : 1,
        fee: 0,
        date: draft.date,
      });
      toast.success(`Recorded ${formatCad(draft.amount)} of ${draft.symbol} dividends`);
      setReview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record that dividend");
    } finally {
      setRecording(null);
    }
  };

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dividends</h1>
        <p className="text-sm text-muted-foreground">
          Income figures are converted to Canadian dollars
          {pricesAsOf ? ` · dividend data as of ${pricesAsOf}` : ""}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="Forward annual income"
          value={formatCad(totals.forward)}
          hint={`${formatCad(totals.forward / 12)} per month`}
        />
        <StatCard
          icon={<Percent className="h-4 w-4" />}
          label="Portfolio yield"
          value={totals.yieldPct == null ? "—" : `${totals.yieldPct.toFixed(2)}%`}
          hint={`On ${formatCad(totals.marketValue)} of holdings`}
        />
        <StatCard
          icon={<Sprout className="h-4 w-4" />}
          label="Yield on cost"
          value={totals.yocPct == null ? "—" : `${totals.yocPct.toFixed(2)}%`}
          hint={`On ${formatCad(totals.acb)} invested`}
        />
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Received (12 months)"
          value={formatCad(totals.received)}
          hint="From your ledger"
        />
      </div>

      <div className="panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Income received, last 12 months
        </h2>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={60} />
              <Tooltip formatter={(v: number) => formatCad(v)} contentStyle={tooltipStyle} />
              <Bar dataKey="amount" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ex-dividend events to record
          </h2>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            {pending.length} not yet in your ledger
            {hiddenCount > 0 ? (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => saveDismissed([])}
              >
                {hiddenCount} skipped · restore
              </button>
            ) : null}
          </span>
        </div>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing outstanding — every reported ex-dividend date for your holdings is already
            recorded{hiddenCount > 0 ? " or skipped" : ""}.
          </p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Ex-date</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Per share</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.holdingId + p.exDivDate}>
                  <TableCell className="font-medium">{p.symbol}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {accountName(p.accountId)}
                  </TableCell>
                  <TableCell className="num">{p.exDivDate}</TableCell>
                  <TableCell className="num text-right">{formatUnits(p.units)}</TableCell>
                  <TableCell className="num text-right">
                    {p.perShare.toFixed(4)} {p.currency}
                  </TableCell>
                  <TableCell className="num text-right">
                    {p.amount.toFixed(2)} {p.currency}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={recording === p.holdingId + p.exDivDate}
                        onClick={() => openReview(p)}
                      >
                        Review &amp; record
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          saveDismissed([...dismissed, p.holdingId + p.exDivDate]);
                          toast.message(`Skipped the ${p.symbol} payment`);
                        }}
                      >
                        Skip
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dividends by holding
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No holdings yet. Add trades in the ledger or import a statement.
          </p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Rate / share</TableHead>
                <TableHead className="text-right">Forward income</TableHead>
                <TableHead className="text-right">Yield</TableHead>
                <TableHead className="text-right">Yield on cost</TableHead>
                <TableHead className="text-right">Received 12m</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.holdingId}>
                  <TableCell className="font-medium">
                    {r.symbol}
                    <span className="ml-2 text-xs text-muted-foreground">{r.currency}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {accountName(r.accountId)}
                  </TableCell>
                  <TableCell className="num text-right">{formatUnits(r.units)}</TableCell>
                  <TableCell className="num text-right">
                    {r.ratePerShare == null ? "—" : r.ratePerShare.toFixed(4)}
                  </TableCell>
                  <TableCell className="num text-right">{formatCad(r.forwardIncome)}</TableCell>
                  <TableCell className="num text-right">
                    {r.yieldPct == null ? "—" : `${r.yieldPct.toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="num text-right">
                    {r.yieldOnCostPct == null ? "—" : `${r.yieldOnCostPct.toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="num text-right">{formatCad(r.received12m)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Forward income assumes today&apos;s payout rate stays flat for the next twelve months.
          Holdings with no published dividend show a dash.
        </p>
      </div>

      <div className="panel p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ten-year compounder
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="growth">Dividend growth %/yr</Label>
            <Input
              id="growth"
              type="number"
              step="0.1"
              value={growth}
              onChange={(e) => setGrowth(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price">Price growth %/yr</Label>
            <Input
              id="price"
              type="number"
              step="0.1"
              value={priceGrowth}
              onChange={(e) => setPriceGrowth(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monthly">Monthly contribution</Label>
            <Input
              id="monthly"
              type="number"
              step="50"
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end gap-3 pb-1">
            <Switch id="drip" checked={drip} onCheckedChange={setDrip} />
            <Label htmlFor="drip">Reinvest dividends (DRIP)</Label>
          </div>
        </div>

        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                tickFormatter={(y: number) => `Yr ${y}`}
              />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={70} />
              <Tooltip
                formatter={(v: number, key) => [
                  formatCad(v),
                  key === "annualIncome" ? "Annual income" : "Portfolio value",
                ]}
                labelFormatter={(y) => `Year ${y}`}
                contentStyle={tooltipStyle}
              />
              <Line
                type="monotone"
                dataKey="annualIncome"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ProjStat
            label="Income in year 10"
            value={formatCad(projection[projection.length - 1]?.annualIncome ?? 0)}
          />
          <ProjStat
            label="Portfolio value in year 10"
            value={formatCad(projection[projection.length - 1]?.portfolioValue ?? 0)}
          />
          <ProjStat
            label="Cumulative dividends"
            value={formatCad(projection[projection.length - 1]?.cumulativeIncome ?? 0)}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Starting point: {formatCad(totals.marketValue)} of holdings yielding{" "}
          {formatPct(totals.yieldPct, 2)}. A projection, not a forecast.
        </p>
      </div>

      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Check this dividend before it is saved</DialogTitle>
            <DialogDescription>
              {review ? `${review.symbol} · ${accountName(review.accountId)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {review ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="div-date">Payment date</Label>
                <Input
                  id="div-date"
                  type="date"
                  value={review.date}
                  onChange={(e) => setReview({ ...review, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-units">Units held</Label>
                <Input
                  id="div-units"
                  type="number"
                  step="0.0001"
                  value={review.units}
                  onChange={(e) => {
                    const units = Number(e.target.value);
                    setReview({
                      ...review,
                      units,
                      amount: Number((units * review.perShare).toFixed(2)),
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-per">Amount per share ({review.currency})</Label>
                <Input
                  id="div-per"
                  type="number"
                  step="0.0001"
                  value={review.perShare}
                  onChange={(e) => {
                    const perShare = Number(e.target.value);
                    setReview({
                      ...review,
                      perShare,
                      amount: Number((review.units * perShare).toFixed(2)),
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="div-total">Total ({review.currency})</Label>
                <Input
                  id="div-total"
                  type="number"
                  step="0.01"
                  value={review.amount}
                  onChange={(e) => setReview({ ...review, amount: Number(e.target.value) })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              disabled={!review || recording === review.key || !review.amount}
              onClick={() => review && void record(review)}
            >
              Record dividend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason="Apis Financial is view-only right now, so dividends cannot be recorded. Restart Pro to make changes again."
      />
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
  hint?: string;
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

function ProjStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="num mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
