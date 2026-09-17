import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownRight, ArrowUpRight, PiggyBank, TrendingUp } from "lucide-react";
import { usePortfolio } from "@/lib/portfolio";
import {
  annualise,
  buildValuationSeries,
  computePositions,
  externalFlows,
  formatCad,
  formatPct,
  formatUnits,
  summariseAccount,
  twrr,
  xirr,
} from "@/lib/finance";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — MapleWealth" },
      {
        name: "description",
        content:
          "Your Canadian portfolio at a glance: market value in CAD, adjusted cost base, day change, money-weighted and time-weighted returns.",
      },
      { property: "og:title", content: "Dashboard — MapleWealth" },
      {
        property: "og:description",
        content: "Portfolio value, ACB, MWRR and TWRR across all your registered and taxable accounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function Dashboard() {
  const {
    accounts,
    holdings,
    transactions,
    quotes,
    fxUsdCad,
    pricesAsOf,
    missingPrices,
    loading,
  } = usePortfolio();


  const positions = useMemo(
    () => computePositions(holdings, transactions, quotes, fxUsdCad),
    [holdings, transactions, quotes, fxUsdCad],
  );

  const summaries = useMemo(
    () =>
      accounts.map((a) =>
        summariseAccount(
          a,
          transactions.filter((t) => t.account_id === a.id),
          holdings.filter((h) => h.account_id === a.id),
          quotes,
          fxUsdCad,
        ),
      ),
    [accounts, transactions, holdings, quotes, fxUsdCad],
  );

  const totals = useMemo(() => {
    const marketValue = summaries.reduce((s, x) => s + x.marketValue, 0);
    const cash = summaries.reduce((s, x) => s + x.cash, 0);
    const totalValue = marketValue + cash;
    const acb = summaries.reduce((s, x) => s + x.acb, 0);
    const unrealized = summaries.reduce((s, x) => s + x.unrealizedGain, 0);
    const realized = summaries.reduce((s, x) => s + x.realizedGain, 0);
    const dividends = summaries.reduce((s, x) => s + x.dividends, 0);
    const dayChange = summaries.reduce((s, x) => s + x.dayChange, 0);
    const netDeposits = summaries.reduce((s, x) => s + x.netDeposits, 0);

    const flows = externalFlows(transactions);
    const mwrr =
      flows.length > 0 && totalValue !== 0
        ? xirr([...flows, { date: new Date(), amount: totalValue }])
        : null;
    const series = buildValuationSeries(transactions, holdings, quotes, fxUsdCad);
    const twrrTotal = twrr(series);
    const twrrAnnual = twrrTotal != null ? annualise(twrrTotal, series) : null;

    return {
      marketValue,
      cash,
      totalValue,
      acb,
      unrealized,
      realized,
      dividends,
      dayChange,
      netDeposits,
      mwrr,
      twrrTotal,
      twrrAnnual,
    };
  }, [summaries, transactions, holdings, quotes, fxUsdCad]);

  const pieData = summaries
    .filter((s) => s.totalValue > 0)
    .map((s) => ({ name: `${s.account.account_type} · ${s.account.account_name}`, value: s.totalValue }));

  if (!loading && accounts.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-4 p-12 text-center">
        <PiggyBank className="h-10 w-10 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Let&apos;s set up your first account</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Add a TFSA, RRSP, FHSA, or non-registered account, then record your trades. MapleWealth
            handles the CAD conversion, adjusted cost base and return math for you.
          </p>
        </div>
        <Button asChild>
          <Link to="/accounts">Add an account</Link>
        </Button>
      </div>
    );
  }

  const dayPct =
    totals.totalValue - totals.dayChange !== 0
      ? (totals.dayChange / (totals.totalValue - totals.dayChange)) * 100
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">All values in Canadian dollars.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/ledger">Add a transaction</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total value" value={formatCad(totals.totalValue)} hint={`Cash ${formatCad(totals.cash)}`} />
        <StatCard
          label="Day change"
          value={formatCad(totals.dayChange)}
          hint={formatPct(dayPct)}
          tone={totals.dayChange >= 0 ? "gain" : "loss"}
        />
        <StatCard
          label="Unrealized gain"
          value={formatCad(totals.unrealized)}
          hint={`ACB ${formatCad(totals.acb)}`}
          tone={totals.unrealized >= 0 ? "gain" : "loss"}
        />
        <StatCard
          label="Realized + dividends"
          value={formatCad(totals.realized + totals.dividends)}
          hint={`Dividends ${formatCad(totals.dividends)}`}
          tone={totals.realized + totals.dividends >= 0 ? "gain" : "loss"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Returns
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <ReturnStat
              label="Money-weighted (MWRR)"
              value={formatPct(totals.mwrr)}
              note="Annualised IRR on your actual deposit timing"
            />
            <ReturnStat
              label="Time-weighted (TWRR)"
              value={formatPct(totals.twrrAnnual ?? totals.twrrTotal)}
              note={totals.twrrAnnual != null ? "Annualised, deposit-timing neutral" : "Since first trade"}
            />
            <ReturnStat
              label="Net deposits"
              value={formatCad(totals.netDeposits)}
              note="Contributions less withdrawals"
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            TWRR is reconstructed from prices in your ledger between cash flows, and from live
            quotes today.
          </p>
        </div>

        <div className="panel p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            By account
          </h2>
          {pieData.length > 0 ? (
            <div className="mt-2 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatCad(v)}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No positions yet.</p>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Accounts
          </h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Market value</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">ACB</TableHead>
                <TableHead className="text-right">Unrealized</TableHead>
                <TableHead className="text-right">MWRR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((s) => (
                <TableRow key={s.account.id}>
                  <TableCell>
                    <div className="font-medium">{s.account.account_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.account.account_type} · {s.account.currency}
                      {s.account.institution ? ` · ${s.account.institution}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="num text-right">{formatCad(s.marketValue)}</TableCell>
                  <TableCell className="num text-right">{formatCad(s.cash)}</TableCell>
                  <TableCell className="num text-right">{formatCad(s.acb)}</TableCell>
                  <TableCell
                    className={`num text-right ${s.unrealizedGain >= 0 ? "text-gain" : "text-loss"}`}
                  >
                    {formatCad(s.unrealizedGain)}
                  </TableCell>
                  <TableCell className="num text-right">{formatPct(s.mwrr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Holdings
          </h2>
          <span className="text-xs text-muted-foreground">
            Prices as of {pricesAsOf ?? "—"} · refreshed once daily after market close ·
            USD/CAD {fxUsdCad.toFixed(4)}
            {missingPrices.length > 0
              ? ` · no price available for ${missingPrices.join(", ")}`
              : ""}

          </span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Market value</TableHead>
                <TableHead className="text-right">ACB / unit</TableHead>
                <TableHead className="text-right">Day</TableHead>
                <TableHead className="text-right">Total return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions
                .filter((p) => p.units > 0)
                .sort((a, b) => b.marketValue - a.marketValue)
                .map((p) => {
                  const account = accounts.find((a) => a.id === p.accountId);
                  return (
                    <TableRow key={p.holdingId}>
                      <TableCell>
                        <div className="font-medium">{p.symbol}</div>
                        <div className="text-xs text-muted-foreground">
                          {account?.account_type ?? ""} · {p.currency}
                        </div>
                      </TableCell>
                      <TableCell className="num text-right">{formatUnits(p.units)}</TableCell>
                      <TableCell className="num text-right">
                        {p.price != null ? p.price.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="num text-right">{formatCad(p.marketValue)}</TableCell>
                      <TableCell className="num text-right">{formatCad(p.acbPerUnit)}</TableCell>
                      <TableCell
                        className={`num text-right ${p.dayChange >= 0 ? "text-gain" : "text-loss"}`}
                      >
                        {formatCad(p.dayChange)}
                      </TableCell>
                      <TableCell
                        className={`num text-right ${p.totalReturn >= 0 ? "text-gain" : "text-loss"}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {p.totalReturn >= 0 ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          )}
                          {formatCad(p.totalReturn)} ({formatPct(p.totalReturnPct)})
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {positions.filter((p) => p.units > 0).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No open positions yet — record a buy in the ledger.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`num mt-2 text-2xl font-semibold ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReturnStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md bg-muted/60 p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="num mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
