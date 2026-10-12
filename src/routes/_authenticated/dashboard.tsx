import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownRight, ArrowUpRight, Check, PiggyBank, TrendingUp } from "lucide-react";
import {
  assessTaxLocation,
  totalActionableDrag,
  type TaxLocationAssessment,
} from "@/lib/taxLocation";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile } from "@/lib/profile";
import { NetWorthCard } from "@/components/retirement/DebtNetWorth";
import {
  computeNetWorth,
  splitDebtsByOwner,
} from "@/lib/retirement/optimization/NetWorth";
import {
  annualise,
  buildValuationSeries,
  cashTrackingIds,
  computePositions,
  externalFlows,
  formatCad,
  formatPct,
  formatUnits,
  summariseAccount,
  twrr,
  xirr,
  type Account,
  type Holding,
  type Quote,
  type Transaction,
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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Which accounts the dashboard figures cover. Children never appear in the main stats. */
export type FamilyView = "mine" | "household" | "family";

const FAMILY_VIEW_LABELS: Record<FamilyView, string> = {
  mine: "Mine",
  household: "Household",
  family: "Family",
};

const FAMILY_VIEW_KEY = "apis-dashboard-family-view";

function loadFamilyView(): FamilyView {
  try {
    const v = localStorage.getItem(FAMILY_VIEW_KEY);
    if (v === "household" || v === "family") return v;
  } catch {
    /* storage unavailable — fall through */
  }
  return "mine";
}

/** True when an account belongs in the main figures for the given view. */
export function accountInMainView(ownerType: string | undefined | null, view: FamilyView): boolean {
  const o = ownerType ?? "self";
  if (view === "mine") return o === "self";
  // household AND family main views cover self + partner; children are fenced off
  return o === "self" || o === "partner";
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Dashboard — Apis Financial" },
      {
        name: "description",
        content:
          "Your Canadian portfolio at a glance: market value in CAD, adjusted cost base, day change, money-weighted and time-weighted returns.",
      },
      { property: "og:title", content: "Dashboard — Apis Financial" },
      {
        property: "og:description",
        content:
          "Portfolio value, ACB, MWRR and TWRR across all your registered and taxable accounts.",
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

/** Small label telling the reader which currency a number is expressed in. */
function CurrencyBadge({ code }: { code: string }) {
  const label = (code || "CAD").toUpperCase();
  return (
    <span className="rounded bg-muted px-1 py-px text-[10px] font-medium tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

function NetWorthStrip({
  selfInvestments,
  partnerInvestments,
  netWorth,
  debts,
  familyView,
}: {
  selfInvestments: number;
  partnerInvestments: number;
  netWorth: { homeValue: number; otherPropertyValue: number; cash: number } | null;
  debts: Array<{ balance: number; owner?: "self" | "partner" | "joint" }>;
  familyView: FamilyView;
}) {
  if (!netWorth && debts.length === 0 && selfInvestments === 0 && partnerInvestments === 0)
    return null;
  const nw = netWorth ?? { homeValue: 0, otherPropertyValue: 0, cash: 0 };
  // Joint debts split 50/50; untagged default to self. Children have no debts here.
  const { selfDebts, partnerDebts, totalDebts } = splitDebtsByOwner(debts);

  // Home value, other property and cash are household-level inputs; they sit in
  // the "yours" figure (as today) and count once in the household total.
  const mine = computeNetWorth({
    cash: nw.cash,
    investments: selfInvestments,
    homeValue: nw.homeValue,
    otherPropertyValue: nw.otherPropertyValue,
    debts: [{ balance: selfDebts }],
  });
  const partner = computeNetWorth({
    cash: 0,
    investments: partnerInvestments,
    homeValue: 0,
    otherPropertyValue: 0,
    debts: [{ balance: partnerDebts }],
  });
  const householdNetWorth = mine.netWorth + partner.netWorth;

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Net worth
        </h2>
        <Link to="/retirement" search={{ tab: "planner" }} className="text-xs text-primary underline">
          Edit values
        </Link>
      </div>
      {familyView === "mine" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Liquid assets</div>
            <div className="text-lg font-semibold">{formatCad(mine.liquidAssets)}</div>
            <div className="text-[11px] text-muted-foreground">Investments + cash</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Illiquid assets</div>
            <div className="text-lg font-semibold">{formatCad(mine.illiquidAssets)}</div>
            <div className="text-[11px] text-muted-foreground">
              Home {formatCad(nw.homeValue)}
              {nw.otherPropertyValue > 0 ? ` + other ${formatCad(nw.otherPropertyValue)}` : ""}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total debts</div>
            <div className="text-lg font-semibold">{formatCad(mine.totalDebts)}</div>
            <div className="text-[11px] text-muted-foreground">
              {debts.length} debt(s){totalDebts !== mine.totalDebts ? " · joint split 50/50" : ""}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 p-3">
            <div className="text-xs text-muted-foreground">Net worth</div>
            <div className="text-xl font-bold text-emerald-800 dark:text-emerald-300">{formatCad(mine.netWorth)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Your net worth</div>
            <div className="text-xl font-bold">{formatCad(mine.netWorth)}</div>
            <div className="text-[11px] text-muted-foreground">
              Investments {formatCad(selfInvestments)} · debts {formatCad(mine.totalDebts)}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Partner&apos;s net worth</div>
            <div className="text-xl font-bold">{formatCad(partner.netWorth)}</div>
            <div className="text-[11px] text-muted-foreground">
              Investments {formatCad(partnerInvestments)} · debts {formatCad(partner.totalDebts)}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 p-3">
            <div className="text-xs text-muted-foreground">Household net worth</div>
            <div className="text-xl font-bold text-emerald-800 dark:text-emerald-300">
              {formatCad(householdNetWorth)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Combined · home {formatCad(nw.homeValue)} · joint debts split 50/50
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Children&apos;s accounts are excluded from all net worth figures.
      </p>
    </div>
  );
}

/** Per-child performance card: value + TWRR, fenced off from the user's figures. */
function ChildCard({
  name,
  childAccounts,
  holdings,
  transactions,
  quotes,
  fxUsdCad,
}: {
  name: string;
  childAccounts: Account[];
  holdings: Holding[];
  transactions: Transaction[];
  quotes: Record<string, Quote>;
  fxUsdCad: number;
}) {
  const stats = useMemo(() => {
    const ids = new Set(childAccounts.map((a) => a.id));
    const marketValue = childAccounts
      .map(
        (a) =>
          summariseAccount(
            a,
            transactions.filter((t) => t.account_id === a.id),
            holdings.filter((h) => h.account_id === a.id),
            quotes,
            fxUsdCad,
          ).totalValue,
      )
      .reduce((sum, v) => sum + v, 0);
    const tx = transactions.filter((t) => ids.has(t.account_id));
    const hd = holdings.filter((h) => ids.has(h.account_id));
    const series = buildValuationSeries(tx, hd, quotes, fxUsdCad, cashTrackingIds(childAccounts));
    const total = twrr(series);
    const annual = total != null ? annualise(total, series) : null;
    return { marketValue, twrr: annual ?? total };
  }, [childAccounts, holdings, transactions, quotes, fxUsdCad]);

  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium">{name}</div>
      <div className="text-xs text-muted-foreground">
        {childAccounts.map((a) => a.account_type).join(" · ")}
      </div>
      <div className="num mt-2 text-xl font-semibold">{formatCad(stats.marketValue)}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Time-weighted return {formatPct(stats.twrr)}
      </div>
    </div>
  );
}

/** Children's accounts, grouped by member name. Performance only — never in net worth. */
function FamilySection({
  accounts,
  holdings,
  transactions,
  quotes,
  fxUsdCad,
}: {
  accounts: Account[];
  holdings: Holding[];
  transactions: Transaction[];
  quotes: Record<string, Quote>;
  fxUsdCad: number;
}) {
  const childGroups = useMemo(() => {
    const groups = new Map<string, Account[]>();
    for (const a of accounts) {
      if ((a.owner_type ?? "self") !== "child") continue;
      const name = a.member_name?.trim() || "Child";
      const list = groups.get(name);
      if (list) list.push(a);
      else groups.set(name, [a]);
    }
    return [...groups.entries()];
  }, [accounts]);

  if (childGroups.length === 0) return null;

  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Family
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Children&apos;s accounts — tracked for performance only. Excluded from your figures and
        net worth.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {childGroups.map(([name, childAccounts]) => (
          <ChildCard
            key={name}
            name={name}
            childAccounts={childAccounts}
            holdings={holdings}
            transactions={transactions}
            quotes={quotes}
            fxUsdCad={fxUsdCad}
          />
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const { accounts, holdings, transactions, quotes, fxUsdCad, pricesAsOf, loading } =
    usePortfolio();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();

  // Total invested across accounts — feeds the NetWorthCard hero.
  const investedTotal = useMemo(() => {
    let total = 0;
    for (const a of accounts) {
      const s = summariseAccount(
        a,
        transactions.filter((t) => t.account_id === a.id),
        holdings.filter((h) => h.account_id === a.id),
        quotes,
        fxUsdCad,
      );
      total += s.marketValue + Math.max(0, s.cash);
    }
    return total;
  }, [accounts, holdings, transactions, quotes, fxUsdCad]);

  const [familyView, setFamilyViewState] = useState<FamilyView>(loadFamilyView);
  const setFamilyView = (v: FamilyView) => {
    setFamilyViewState(v);
    try {
      localStorage.setItem(FAMILY_VIEW_KEY, v);
    } catch {
      /* storage unavailable — view still applies for this session */
    }
  };

  // Accounts in the main figures for this view. Children are always fenced off
  // into the Family section (family view) or hidden (mine/household views).
  const viewAccounts = useMemo(
    () => accounts.filter((a) => accountInMainView(a.owner_type, familyView)),
    [accounts, familyView],
  );
  const viewAccountIds = useMemo(() => new Set(viewAccounts.map((a) => a.id)), [viewAccounts]);

  const positions = useMemo(
    () => computePositions(holdings, transactions, quotes, fxUsdCad),
    [holdings, transactions, quotes, fxUsdCad],
  );

  const openPositions = useMemo(
    () =>
      positions
        .filter((p) => p.units > 0 && viewAccountIds.has(p.accountId))
        .sort((a, b) => b.marketValue - a.marketValue),
    [positions, viewAccountIds],
  );

  const [accountFilter, setAccountFilter] = useState("all");

  const visiblePositions = useMemo(
    () =>
      accountFilter === "all"
        ? openPositions
        : openPositions.filter((p) => p.accountId === accountFilter),
    [openPositions, accountFilter],
  );

  const summaries = useMemo(
    () =>
      viewAccounts.map((a) =>
        summariseAccount(
          a,
          transactions.filter((t) => t.account_id === a.id),
          holdings.filter((h) => h.account_id === a.id),
          quotes,
          fxUsdCad,
        ),
      ),
    [viewAccounts, transactions, holdings, quotes, fxUsdCad],
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
    const viewIds = new Set(viewAccounts.map((a) => a.id));
    const viewTransactions = transactions.filter((t) => viewIds.has(t.account_id));
    const viewHoldings = holdings.filter((h) => viewIds.has(h.account_id));
    const cashAccounts = cashTrackingIds(viewAccounts);
    const flows = externalFlows(viewTransactions, cashAccounts);
    const cashAdded = flows.reduce((sum, flow) => sum + Math.max(0, -flow.amount), 0);
    const cashWithdrawn = flows.reduce((sum, flow) => sum + Math.max(0, flow.amount), 0);
    const profitLoss = totalValue - cashAdded + cashWithdrawn;
    const mwrr =
      flows.length > 0 && totalValue !== 0
        ? xirr([...flows, { date: new Date(), amount: totalValue }])
        : null;
    const series = buildValuationSeries(viewTransactions, viewHoldings, quotes, fxUsdCad, cashAccounts);
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
      cashAdded,
      cashWithdrawn,
      profitLoss,
      mwrr,
      twrrTotal,
      twrrAnnual,
    };
  }, [summaries, viewAccounts, transactions, holdings, quotes, fxUsdCad]);

  const investmentsByOwner = useMemo(() => {
    let self = 0;
    let partner = 0;
    for (const s of summaries) {
      if ((s.account.owner_type ?? "self") === "partner") partner += s.totalValue;
      else self += s.totalValue;
    }
    return { self, partner };
  }, [summaries]);

  // Tax-location assessment per visible position. Respects the family toggle:
  // only positions in the current view are assessed.
  const hasTreatyExemptAccount = useMemo(
    () =>
      viewAccounts.some((a) =>
        ["RRSP", "SPOUSAL RRSP", "LIRA", "LRSP", "RRIF", "LIF", "PRIF", "RLIF"].includes(
          (a.account_type ?? "").trim().toUpperCase(),
        ),
      ),
    [viewAccounts],
  );

  const taxAssessments = useMemo(() => {
    const map = new Map<string, TaxLocationAssessment>();
    for (const pos of visiblePositions) {
      const account = accounts.find((a) => a.id === pos.accountId);
      const quote = quotes[pos.symbol.toUpperCase()];
      map.set(
        pos.holdingId,
        assessTaxLocation({
          currency: pos.currency,
          marketValueCad: pos.marketValue,
          dividendYieldPct: quote?.dividendYield,
          accountType: account?.account_type,
          hasTreatyExemptAccount,
        }),
      );
    }
    return map;
  }, [visiblePositions, accounts, quotes, hasTreatyExemptAccount]);

  const actionableTaxDrag = useMemo(
    () => totalActionableDrag([...taxAssessments.values()]),
    [taxAssessments],
  );

  const pieData = summaries
    .filter((s) => s.totalValue > 0)
    .map((s) => ({
      name: `${s.account.account_type} · ${s.account.account_name}`,
      value: s.totalValue,
    }));

  if (!loading && accounts.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-4 p-12 text-center">
        <PiggyBank className="h-10 w-10 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Let&apos;s set up your first account</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Add a TFSA, RRSP, FHSA, or non-registered account, then record your trades. Apis
            Financial handles the CAD conversion, adjusted cost base and return math for you.
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
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-lg border bg-muted/60 p-0.5"
            role="group"
            aria-label="Whose accounts to show"
          >
            {(Object.keys(FAMILY_VIEW_LABELS) as FamilyView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFamilyView(v)}
                aria-pressed={familyView === v}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  familyView === v
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {FAMILY_VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <Button asChild variant="outline">
            <Link to="/ledger">Add a transaction</Link>
          </Button>
        </div>
      </div>

      {profile ? (
        <NetWorthCard
          profile={profile}
          investments={investedTotal}
          onSave={(v) => updateProfile.mutate({ net_worth: v })}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total value"
          value={formatCad(totals.totalValue)}
          hint={`Cash ${formatCad(totals.cash)}`}
        />
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

      <NetWorthStrip
        selfInvestments={investmentsByOwner.self}
        partnerInvestments={investmentsByOwner.partner}
        netWorth={profile?.net_worth ?? null}
        debts={profile?.debts ?? []}
        familyView={familyView}
      />

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
              note={
                totals.twrrAnnual != null
                  ? "Annualised, deposit-timing neutral"
                  : "Since first trade"
              }
            />
            <ReturnStat
              label="Total profit / loss"
              value={formatCad(totals.profitLoss)}
              note="Current value plus withdrawals, less contributions"
              tone={totals.profitLoss >= 0 ? "gain" : "loss"}
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
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={78}
                    paddingAngle={2}
                  >
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
                    labelStyle={{ color: "var(--accent)", fontWeight: 600 }}
                    itemStyle={{ color: "var(--accent)" }}
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
        <div className="max-h-[37.5rem] overflow-auto">
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Holdings
            </h2>
            {actionableTaxDrag >= 25 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                You could save{" "}
                <span className="font-semibold text-foreground">
                  ~{formatCad(Math.round(actionableTaxDrag))}/yr
                </span>{" "}
                by holding these in the right accounts.{" "}
                <span title="Withholding estimates from distribution yields; for information only — consider your full situation.">
                  Estimates for information only.
                </span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="h-8 w-56 text-xs" aria-label="Filter holdings by account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {viewAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_name} · {a.account_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Prices as of {pricesAsOf ?? "—"} · refreshed once daily after market close · USD/CAD{" "}
              {fxUsdCad.toFixed(4)}
              {visiblePositions.length > 10
                ? ` · scrolling to see all ${visiblePositions.length}`
                : ""}
            </span>
          </div>
        </div>
        <div className="max-h-[37.5rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Price (traded)</TableHead>
                <TableHead className="text-right">Market value (CAD)</TableHead>
                <TableHead className="text-right">ACB / unit (CAD)</TableHead>
                <TableHead className="text-right">Day (CAD)</TableHead>
                <TableHead className="text-right">Total return (CAD)</TableHead>
                <TableHead className="text-right">Tax location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePositions.map((p) => {
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
                        {p.price != null ? (
                          <span
                            className="inline-flex items-baseline gap-1"
                            title={
                              p.priceEstimated
                                ? "No market feed for this symbol — valued at your own recorded price"
                                : undefined
                            }
                          >
                            {p.price.toFixed(2)}
                            <CurrencyBadge code={p.currency} />
                            {p.priceEstimated ? <CurrencyBadge code="your price" /> : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="num text-right">
                        <span className="inline-flex items-baseline gap-1">
                          {formatCad(p.marketValue)}
                          <CurrencyBadge code="CAD" />
                        </span>
                      </TableCell>
                      <TableCell className="num text-right">
                        <span className="inline-flex items-baseline gap-1">
                          {formatCad(p.acbPerUnit)}
                          <CurrencyBadge code="CAD" />
                        </span>
                      </TableCell>
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
                      <TableCell className="text-right">
                        {(() => {
                          const a = taxAssessments.get(p.holdingId);
                          if (!a || a.status === "unknown")
                            return (
                              <span
                                className="text-xs text-muted-foreground"
                                title="Not enough data to assess tax location."
                              >
                                —
                              </span>
                            );
                          if (a.status === "ok")
                            return (
                              <span title={a.tooltip} className="inline-flex justify-end">
                                <Check className="h-4 w-4 text-gain" aria-label="Well placed" />
                              </span>
                            );
                          return (
                            <span
                              title={a.tooltip}
                              className={`text-xs font-medium ${
                                a.status === "flag" ? "text-amber-600" : "text-muted-foreground"
                              }`}
                            >
                              {a.message}
                            </span>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              {visiblePositions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No open positions in this account.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {familyView === "family" ? (
        <FamilySection
          accounts={accounts}
          holdings={holdings}
          transactions={transactions}
          quotes={quotes}
          fxUsdCad={fxUsdCad}
        />
      ) : null}
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

function ReturnStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="rounded-md bg-muted/60 p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        {label}
      </p>
      <p
        className={`num mt-2 text-xl font-semibold ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
