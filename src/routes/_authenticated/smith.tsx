import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumInput } from "@/components/ui/num-input";
import { Switch } from "@/components/ui/switch";
import { formatCad, summariseAccount, type Account } from "@/lib/finance";
import { usePortfolio } from "@/lib/portfolio";
import type { ProvinceCode } from "@/lib/tax";
import {
  useProfile,
  useUpdateProfile,
  type SmithTranche,
  type DebtInput,
} from "@/lib/profile";
import { marginalRateAt } from "@/lib/retirement/marginalRate";
import { computeSmithSavings } from "@/lib/retirement/optimization/SmithSavings";
import { assessSmithLedger, CRA_FILING_DISCLAIMER } from "@/lib/retirement/optimization/SmithTracker";
import { computeRoomSegmented, type TermSegment } from "@/lib/retirement/optimization/SmithRoom";
import { SmithTrackerCard } from "@/components/retirement/DebtNetWorth";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";

export const Route = createFileRoute("/_authenticated/smith")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Home Equity Investing Tracker — Apis Financial" },
      {
        name: "description",
        content:
          "Track your home equity investing: draws from your readvanceable mortgage, per-tranche tax tracing, deductible interest for line 22100, and the tax savings you're building.",
      },
    ],
  }),
  component: SmithPage,
});

function LockedSection({
  locked,
  onUnlock,
  children,
  label,
}: {
  locked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
  label: string;
}) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-60" aria-hidden>
        {children}
      </div>
      <button
        type="button"
        onClick={onUnlock}
        className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/40 backdrop-blur-[1px]"
        aria-label={`${label} — Pro feature, click to upgrade`}
      >
        <span className="rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-sm">
          🔒 {label} — Pro feature
        </span>
      </button>
    </div>
  );
}

function SmithPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { entitlement } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // HELOC investing tracker is a Pro feature; free users see data read-only.
  const hasTrackerPro = entitlement.tier !== "free";

  // Real portfolio accounts (Accounts tab) — the primary source for linked investments.
  const {
    accounts: portfolioAccounts,
    holdings: portfolioHoldings,
    transactions: portfolioTransactions,
    quotes,
    fxUsdCad,
  } = usePortfolio();

  const p = profile ?? null;
  const tranches = p?.smith_tranches ?? [];
  const debts = p?.debts ?? [];
  const settings = p?.smith_settings ?? {
    priorInterestClaimed: 0,
    helocDebtId: "",
    mortgageDebtId: "",
    startDate: null,
    startMortgageBalance: 0,
    bocRateLastSeen: null,
    bocCheckedDate: null,
    openingDrawn: 0,
    openingDate: null,
    investmentAccountId: null,
    investmentHoldingIds: [],
    homeValue: null,
  };

  const save = (patch: Parameters<typeof updateProfile.mutate>[0]) =>
    updateProfile.mutate(patch);

  // Linked portfolio account (Accounts tab) — computed live from the real ledger.
  const linkedAccount = useMemo(
    () =>
      settings.investmentAccountId
        ? (portfolioAccounts.find((a) => a.id === settings.investmentAccountId) ?? null)
        : null,
    [portfolioAccounts, settings.investmentAccountId],
  );
  const linkedAccountValue = useMemo(() => {
    if (!linkedAccount) return null;
    const s = summariseAccount(
      linkedAccount,
      portfolioTransactions.filter((t) => t.account_id === linkedAccount.id),
      portfolioHoldings.filter((h) => h.account_id === linkedAccount.id),
      quotes,
      fxUsdCad,
    );
    return s.totalValue;
  }, [linkedAccount, portfolioTransactions, portfolioHoldings, quotes, fxUsdCad]);

  const province = (p?.province as ProvinceCode) ?? "AB";
  const salary = p?.cpp_future_income ?? 0;
  const marginalRate = marginalRateAt(salary, province, p?.current_age ?? 40);

  const mortgage = debts.find((d) => d.kind === "mortgage") ?? null;
  const heloc =
    debts.find((d) => d.id === settings.helocDebtId) ??
    debts.find((d) => d.kind === "heloc") ??
    null;

  // Readvanceable pair for the Smith flow
  const pairMortgage = debts.find((d) => d.id === settings.mortgageDebtId) ?? null;
  const pairHeloc = debts.find((d) => d.id === settings.helocDebtId) ?? null;
  const pairReady = !!(pairMortgage && pairHeloc && settings.startDate);

  const totalDrawn = tranches.reduce((s, t) => s + Math.max(0, t.principal), 0);
  // Opening position counts as drawn for room purposes.
  const totalDrawnWithOpening = totalDrawn + Math.max(0, settings.openingDrawn ?? 0);
  const room = useMemo(() => {
    if (!pairReady || !pairMortgage || !settings.startDate) return null;
    const today = new Date().toISOString().slice(0, 10);
    // Build term segments: prior terms from history, then current terms to today.
    // Old terms keep their own rate/payment so refinancing never rewrites history.
    const segments: TermSegment[] = [];
    const history = (pairMortgage.termHistory ?? [])
      .filter((t) => t.date && t.date >= settings.startDate!)
      .sort((a, b) => a.date.localeCompare(b.date));
    let segStart = settings.startDate;
    let segBalance = settings.startMortgageBalance;
    for (const t of history) {
      segments.push({
        startDate: segStart,
        endDate: t.date,
        startBalance: segBalance,
        rate: t.rate,
        payment: t.payment,
        frequency: t.paymentFrequency ?? pairMortgage.paymentFrequency ?? "monthly",
      });
      segStart = t.date;
      segBalance = t.balance;
    }
    segments.push({
      startDate: segStart,
      endDate: null,
      startBalance: segBalance,
      rate: pairMortgage.rate,
      payment: pairMortgage.payment,
      frequency: pairMortgage.paymentFrequency ?? "monthly",
    });
    return computeRoomSegmented(segments, totalDrawnWithOpening, today);
  }, [pairReady, pairMortgage, settings.startDate, settings.startMortgageBalance, settings.openingDrawn, totalDrawnWithOpening]);

  const interestPaidYtd = tranches.reduce((s, t) => s + Math.max(0, t.interestPaidYtd), 0);
  const deductibleOutstanding = tranches.reduce(
    (s, t) =>
      s +
      Math.max(
        0,
        t.principal - t.repayments.reduce((r, x) => r + Math.max(0, x.amount), 0),
      ),
    0,
  );
  const trancheRates = tranches.map((t) => t.rate).filter((r) => r > 0);
  const helocRate =
    heloc && heloc.rate > 0
      ? heloc.rate
      : trancheRates.length > 0
        ? trancheRates.reduce((s, r) => s + r, 0) / trancheRates.length
        : 0.055;

  const [stopRedraw, setStopRedraw] = useState(false);
  const [rateBump, setRateBump] = useState(false);

  const savings = useMemo(
    () =>
      computeSmithSavings({
        mortgageBalance: mortgage?.balance ?? 0,
        mortgageRate: mortgage?.rate ?? 0,
        mortgagePayment: mortgage?.payment ?? 0,
        helocRate,
        marginalRate,
        interestPaidYtd,
        interestClaimedPrior: settings.priorInterestClaimed,
        deductibleOutstanding,
        redraw: !stopRedraw,
        rateBump: rateBump ? 0.02 : 0,
      }),
    [mortgage, helocRate, marginalRate, interestPaidYtd, settings.priorInterestClaimed, deductibleOutstanding, stopRedraw, rateBump],
  );

  const ledger = useMemo(() => assessSmithLedger(tranches), [tranches]);

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason="The HELOC investing tracker is a Pro feature. Upgrade to set up your readvanceable mortgage pair, record draws, and keep per-tranche tax records."
      />
      <div>
        <h1 className="text-2xl font-bold">Home Equity Investing Tracker</h1>
        <p className="text-sm text-muted-foreground">
          Every mortgage principal dollar, re-borrowed and invested. Track the draws,
          keep the tracing clean, and watch the tax savings compound.
        </p>
      </div>

      {/* BoC rate nudge */}
      {pairHeloc ? (
        <BocNudge
          heloc={pairHeloc}
          lastChecked={settings.bocCheckedDate}
          onChecked={() =>
            save({
              smith_settings: {
                ...settings,
                bocCheckedDate: new Date().toISOString().slice(0, 10),
              },
            })
          }
        />
      ) : null}

      {/* Morale dashboard */}
      {tranches.length === 0 ? (
        <div className="rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">How the Home Equity Investing tracker works</h2>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">1</span>
              <span><strong>Add your HELOC</strong> below — it lands in your debts list automatically.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">2</span>
              <span><strong>Record each month's draw</strong> in the check-in: principal paid → room created → amount drawn → what it bought.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">3</span>
              <span><strong>Watch the dashboard</strong> — tax saved this year, all-time, and projected through payoff, plus a clean tracing ledger for tax time.</span>
            </li>
          </ol>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-emerald-50 p-4">
          <div className="text-xs text-muted-foreground">Tax saved this year</div>
          <div className="text-2xl font-bold text-emerald-800">{formatCad(savings.taxSavedYtd)}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(interestPaidYtd)} deductible interest × {(marginalRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Tax saved all-time</div>
          <div className="text-2xl font-bold">{formatCad(savings.taxSavedAllTime)}</div>
          <div className="text-[11px] text-muted-foreground">Realized, in your pocket</div>
        </div>
        <div className="rounded-xl border bg-sky-50 p-4">
          <div className="text-xs text-muted-foreground">Projected total by payoff</div>
          <div className="text-2xl font-bold text-sky-800">{formatCad(savings.totalProjected)}</div>
          <div className="text-[11px] text-muted-foreground">
            {savings.yearsToConvert > 0 ? `over ~${savings.yearsToConvert} years` : "add a mortgage to project"}
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Debt converted</div>
          <div className="text-2xl font-bold">{savings.conversionPct.toFixed(0)}%</div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${Math.min(100, savings.conversionPct)}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Borrowing now costs {(savings.effectiveRate * 100).toFixed(2)}% after tax
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Distributions received YTD</div>
          <div className="text-2xl font-bold">{formatCad(ledger.distributions.total)}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(ledger.distributions.mortgage)} to mortgage ·{" "}
            {formatCad(ledger.distributions.reinvested)} reinvested ·{" "}
            {formatCad(ledger.distributions.personal)} spent
          </div>
        </div>
        <SmithPerformanceCard
          tranches={tranches}
          holdings={p?.asset_holdings ?? []}
          drawn={deductibleOutstanding}
          distributionsYtd={ledger.distributions.total}
          investmentHoldingIds={settings.investmentHoldingIds ?? []}
          onLinkHolding={(id) =>
            save({
              smith_settings: {
                ...settings,
                investmentHoldingIds: [...(settings.investmentHoldingIds ?? []), id],
              },
            })
          }
          onUnlinkHolding={(id) =>
            save({
              smith_settings: {
                ...settings,
                investmentHoldingIds: (settings.investmentHoldingIds ?? []).filter((x) => x !== id),
              },
            })
          }
          accounts={portfolioAccounts}
          investmentAccountId={settings.investmentAccountId ?? null}
          onSelectAccount={(id) =>
            save({ smith_settings: { ...settings, investmentAccountId: id } })
          }
          linkedAccountName={linkedAccount?.account_name ?? null}
          linkedAccountValue={linkedAccountValue}
          locked={!hasTrackerPro}
          onUnlock={() => setUpgradeOpen(true)}
        />
      </div>

      {/* What-if toggles */}
      <div className="rounded-xl border p-4 space-y-2">
        <h3 className="text-sm font-semibold">What if…</h3>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={stopRedraw} onCheckedChange={setStopRedraw} />
            I stop redrawing
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={rateBump} onCheckedChange={setRateBump} />
            HELOC rate rises 2%
          </label>
        </div>
        {(stopRedraw || rateBump) ? (
          <p className="text-sm">
            Projected total by payoff:{" "}
            <span className="font-bold">{formatCad(savings.totalProjected)}</span>
            <span className="text-muted-foreground text-xs ml-2">
              {stopRedraw ? "no new draws; " : ""}
              {rateBump ? `rate ${(helocRate * 100).toFixed(2)}% → ${((helocRate + 0.02) * 100).toFixed(2)}%` : ""}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Flip a toggle to stress-test the projection above.
          </p>
        )}
      </div>

      {/* Smith flow: pair setup → room → draws */}
      {pairReady && pairMortgage && pairHeloc && room ? (
        <RoomDrawCard
          mortgage={pairMortgage}
          heloc={pairHeloc}
          room={room}
          tranches={tranches}
          openingDrawn={settings.openingDrawn ?? 0}
          homeValue={settings.homeValue ?? p?.net_worth?.homeValue ?? null}
          onHomeValue={(v) =>
            save({
              smith_settings: { ...settings, homeValue: v },
              net_worth: { ...(p?.net_worth ?? { homeValue: 0, otherPropertyValue: 0, cash: 0 }), homeValue: v ?? 0 },
            })
          }
          locked={!hasTrackerPro}
          onUnlock={() => setUpgradeOpen(true)}
          lastTranche={tranches.length > 0 ? tranches[tranches.length - 1] : null}
          onDraw={(tranche, drawnAmount) => {
            const next = [...tranches, tranche];
            save({
              smith_tranches: next,
              debts: debts.map((d) =>
                d.id === pairHeloc.id ? { ...d, balance: d.balance + drawnAmount } : d,
              ),
            });
          }}
          onRefinance={(snapshot, newTerms) => {
            save({
              debts: debts.map((d) =>
                d.id === pairMortgage.id
                  ? {
                      ...d,
                      ...newTerms,
                      termHistory: [...(d.termHistory ?? []), snapshot],
                    }
                  : d,
              ),
            });
          }}
          onUnlink={() =>
            save({
              smith_settings: { ...settings, mortgageDebtId: "", helocDebtId: "", startDate: null },
            })
          }
        />
      ) : (
        <LockedSection locked={!hasTrackerPro} onUnlock={() => setUpgradeOpen(true)} label="Setup">
          <PairSetupCard
            debts={debts}
            defaultHomeValue={p?.net_worth?.homeValue ?? null}
            onSetup={(args) =>
              save({
                smith_settings: {
                  ...settings,
                  mortgageDebtId: args.mortgageId,
                  helocDebtId: args.helocId,
                  startDate: args.startDate,
                  startMortgageBalance: args.startBalance,
                  openingDrawn: args.openingDrawn,
                  openingDate: args.openingDate,
                  homeValue: args.homeValue,
                },
                debts: debts.map((d) =>
                  d.id === args.mortgageId
                    ? { ...d, linkedDebtId: args.helocId }
                    : d.id === args.helocId
                      ? { ...d, linkedDebtId: args.mortgageId }
                      : d,
                ),
              })
            }
            onCreateDebt={(debt) => save({ debts: [...debts, debt] })}
          />
        </LockedSection>
      )}

      {/* Prior interest — entry action, Pro only */}
      <LockedSection locked={!hasTrackerPro} onUnlock={() => setUpgradeOpen(true)} label="Prior interest">
      <div className="rounded-xl border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Deductible interest claimed in prior years ($)</Label>
            <NumInput
              value={settings.priorInterestClaimed}
              onCommit={(n) =>
                save({ smith_settings: { ...settings, priorInterestClaimed: Math.max(0, n) } })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            One-time entry so your all-time savings include earlier years.
          </p>
        </div>
      </div>
      </LockedSection>

      {/* Tranche timeline — tranche data stays visible read-only; edits are Pro only */}
      {p ? (
        <SmithTrackerCard
          profile={p}
          onSave={(t) => save({ smith_tranches: t })}
          locked={!hasTrackerPro}
          onLocked={() => setUpgradeOpen(true)}
        />
      ) : null}

      {/* Tax summary */}
      <div className="rounded-xl border p-4 space-y-2">
        <h3 className="text-base font-semibold">Tax summary</h3>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">Deductible interest YTD (line 22100)</dt>
            <dd className="text-lg font-bold">{formatCad(ledger.totalDeductibleInterestYtd)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">Estimated tax saved</dt>
            <dd className="text-lg font-bold">{formatCad(savings.taxSavedYtd)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{ledger.disclaimer}</p>
        <p className="text-xs text-muted-foreground">{savings.disclaimer}</p>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-900">
          {CRA_FILING_DISCLAIMER}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        A summary also appears on the <Link to="/retirement" className="underline">retirement planner</Link>.
      </p>
    </div>
  );
}

function BocNudge({
  heloc,
  lastChecked,
  onChecked,
}: {
  heloc: DebtInput;
  lastChecked: string | null;
  onChecked: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const daysSince = lastChecked
    ? Math.floor((new Date(today).getTime() - new Date(lastChecked + "T00:00:00").getTime()) / 86_400_000)
    : 999;
  // BoC announces 8×/year (~every 6 weeks). Nudge if never checked or > 45 days.
  if (daysSince <= 45) return null;
  return (
    <div className="rounded-xl border border-sky-300 bg-sky-50 p-4 space-y-2">
      <h3 className="text-sm font-semibold">Has your HELOC rate changed?</h3>
      <p className="text-sm text-muted-foreground">
        The Bank of Canada sets rates 8 times a year, and banks usually follow within
        days. Your HELOC is at {(heloc.rate * 100).toFixed(2)}%
        {lastChecked ? ` (last confirmed ${lastChecked})` : ""}. If your bank moved
        it, update the rate on the{" "}
        <Link to="/debts" className="underline">Debts tab</Link> — future
        projections and the room math will use the new rate.
      </p>
      <Button size="sm" variant="outline" onClick={onChecked}>
        Rate is still correct
      </Button>
    </div>
  );
}

function SmithPerformanceCard({
  tranches,
  holdings,
  drawn,
  distributionsYtd,
  investmentHoldingIds,
  onLinkHolding,
  onUnlinkHolding,
  accounts,
  investmentAccountId,
  onSelectAccount,
  linkedAccountName,
  linkedAccountValue,
  locked,
  onUnlock,
}: {
  tranches: SmithTranche[];
  holdings: Array<{ id: string; name: string; value: number }>;
  drawn: number;
  distributionsYtd: number;
  investmentHoldingIds: string[];
  onLinkHolding: (id: string) => void;
  onUnlinkHolding: (id: string) => void;
  accounts: Account[];
  investmentAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  linkedAccountName: string | null;
  linkedAccountValue: number | null;
  locked: boolean;
  onUnlock: () => void;
}) {
  const [linkId, setLinkId] = useState("");

  const trancheLinkedIds = new Set(
    tranches.map((t) => t.holdingId).filter((id): id is string => !!id),
  );
  const allLinkedIds = new Set([...trancheLinkedIds, ...investmentHoldingIds]);
  const linkedHoldings = holdings.filter((h) => allLinkedIds.has(h.id));
  const unlinkedHoldings = holdings.filter((h) => !allLinkedIds.has(h.id));
  const linkedHoldingsValue = linkedHoldings.reduce((s, h) => s + Math.max(0, h.value), 0);
  // Account link is primary; per-holding links are optional detail as a fallback.
  const investmentValue = linkedAccountValue ?? linkedHoldingsValue;
  const gain = investmentValue - drawn;
  const gainPct = drawn > 0 ? (gain / drawn) * 100 : 0;
  const yieldPct = investmentValue > 0 ? (distributionsYtd / investmentValue) * 100 : 0;

  return (
    <div className="rounded-xl border p-4 space-y-2">
      <div className="text-xs text-muted-foreground">Investment account</div>
      {/* Portfolio account linking is an entry action — Pro only. Linked data stays visible read-only. */}
      <LockedSection locked={locked} onUnlock={onUnlock} label="Investment account">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={investmentAccountId ?? ""}
            onValueChange={(v) => onSelectAccount(v === "" ? null : v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Link an account from the Accounts tab" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {investmentAccountId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSelectAccount(null)}
              title={locked ? "Pro feature — click to upgrade" : undefined}
            >
              Unlink
            </Button>
          ) : null}
        </div>
      </LockedSection>
      {linkedAccountValue != null ? (
        <>
          <div className="text-2xl font-bold">{formatCad(linkedAccountValue)}</div>
          <div className="text-[11px] text-muted-foreground">{linkedAccountName}</div>
          <div className={`text-xs font-medium ${gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {gain >= 0 ? "+" : ""}{formatCad(gain)} ({gainPct.toFixed(1)}%) vs {formatCad(drawn)} drawn
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(distributionsYtd)} distributions YTD
            {yieldPct > 0 ? ` · ${yieldPct.toFixed(1)}% yield` : ""}
          </div>
        </>
      ) : linkedHoldings.length > 0 ? (
        <>
          <div className="text-2xl font-bold">{formatCad(linkedHoldingsValue)}</div>
          <div className={`text-xs font-medium ${gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {gain >= 0 ? "+" : ""}{formatCad(gain)} ({gainPct.toFixed(1)}%) vs {formatCad(drawn)} drawn
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(distributionsYtd)} distributions YTD
            {yieldPct > 0 ? ` · ${yieldPct.toFixed(1)}% yield` : ""}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          Link the account holding the investments bought with the borrowed money.
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Add investments normally in the{" "}
        <Link to="/accounts" className="text-primary underline">
          Accounts tab
        </Link>{" "}
        — they appear here once this account is linked.
      </p>
      {/* Link / unlink are entry actions — Pro only. Linked data stays visible read-only. */}
      <LockedSection locked={locked} onUnlock={onUnlock} label="Investment holdings">
      <div className="flex flex-wrap gap-1.5 pt-1">
        {linkedHoldings.map((h) => (
          <span key={h.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
            {h.name || "Holding"} — {formatCad(h.value)}
            {investmentHoldingIds.includes(h.id) ? (
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onUnlinkHolding(h.id)}
                aria-label={`Unlink ${h.name}`}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {unlinkedHoldings.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select value={linkId} onValueChange={setLinkId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Link existing holding" /></SelectTrigger>
            <SelectContent>
              {unlinkedHoldings.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.name || "Holding"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!linkId} onClick={() => { onLinkHolding(linkId); setLinkId(""); }}>
            Link
          </Button>
        </div>
      ) : null}
      </LockedSection>
    </div>
  );
}

function PairSetupCard({
  debts,
  defaultHomeValue,
  onSetup,
  onCreateDebt,
}: {
  debts: DebtInput[];
  defaultHomeValue: number | null;
  onSetup: (args: {
    mortgageId: string;
    helocId: string;
    startDate: string;
    startBalance: number;
    openingDrawn: number;
    openingDate: string | null;
    homeValue: number | null;
  }) => void;
  onCreateDebt: (debt: DebtInput) => void;
}) {
  const mortgages = debts.filter((d) => d.kind === "mortgage");
  const helocs = debts.filter((d) => d.kind === "heloc");
  const [mortgageId, setMortgageId] = useState("");
  const [helocId, setHelocId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [showNewMortgage, setShowNewMortgage] = useState(false);
  const [showNewHeloc, setShowNewHeloc] = useState(false);
  const [alreadyStarted, setAlreadyStarted] = useState(false);
  const [openingDrawn, setOpeningDrawn] = useState("");
  const [homeValue, setHomeValue] = useState(
    defaultHomeValue && defaultHomeValue > 0 ? String(defaultHomeValue) : "",
  );

  const mortgage = debts.find((d) => d.id === mortgageId) ?? null;

  const canStart = mortgageId && helocId && startDate;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Set up your HELOC investing flow</h3>
        <p className="text-sm text-muted-foreground">
          Link your readvanceable mortgage and HELOC. Every principal payment creates
          room you can draw — the debts stay in sync automatically.
        </p>
      </div>
      <div className="space-y-1 max-w-xs rounded-lg border border-primary/30 bg-primary/5 p-3">
        <Label className="text-xs font-medium">1. What is your home worth right now? ($)</Label>
        <NumInput value={homeValue === "" ? null : Number(homeValue)} onCommit={(n) => setHomeValue(String(Math.max(0, n)))} />
        <p className="text-[11px] text-muted-foreground">Your readvanceable limit is based on this value.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <h4 className="text-sm font-medium">Readvanceable mortgage</h4>
          {mortgages.length > 0 && !showNewMortgage ? (
            <Select value={mortgageId} onValueChange={setMortgageId}>
              <SelectTrigger><SelectValue placeholder="Select mortgage" /></SelectTrigger>
              <SelectContent>
                {mortgages.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name || "Mortgage"} — {formatCad(d.balance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {showNewMortgage ? (
            <NewDebtForm
              kind="mortgage"
              onCreate={(debt) => {
                onCreateDebt(debt);
                setMortgageId(debt.id);
                setShowNewMortgage(false);
              }}
              onCancel={() => setShowNewMortgage(false)}
            />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowNewMortgage(true)}>
              {mortgages.length > 0 ? "Add new mortgage" : "Add mortgage"}
            </Button>
          )}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <h4 className="text-sm font-medium">HELOC</h4>
          {helocs.length > 0 && !showNewHeloc ? (
            <Select value={helocId} onValueChange={setHelocId}>
              <SelectTrigger><SelectValue placeholder="Select HELOC" /></SelectTrigger>
              <SelectContent>
                {helocs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name || "HELOC"} — {formatCad(d.balance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {showNewHeloc ? (
            <NewDebtForm
              kind="heloc"
              onCreate={(debt) => {
                onCreateDebt(debt);
                setHelocId(debt.id);
                setShowNewHeloc(false);
              }}
              onCancel={() => setShowNewHeloc(false)}
            />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowNewHeloc(true)}>
              {helocs.length > 0 ? "Add new HELOC" : "Add HELOC"}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1 max-w-xs">
        <Label className="text-xs">Start date</Label>
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">Room accrues from this date.</p>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Switch checked={alreadyStarted} onCheckedChange={setAlreadyStarted} />
          <Label className="text-xs">Already doing this — I have draws from before</Label>
        </div>
        {alreadyStarted ? (
          <div className="space-y-1 max-w-xs">
            <Label className="text-xs">Already drawn for investing ($)</Label>
            <NumInput value={openingDrawn === "" ? null : Number(openingDrawn)} onCommit={(n) => setOpeningDrawn(String(Math.max(0, n)))} />
            <p className="text-[11px] text-muted-foreground">
              How much have you already drawn on this HELOC for investing? This becomes your
              opening position — new draws are tracked on top, not re-entered.
            </p>
          </div>
        ) : null}
      </div>
      <Button
        size="sm"
        disabled={!canStart}
        onClick={() =>
          canStart &&
          onSetup({
            mortgageId,
            helocId,
            startDate,
            startBalance: mortgage ? mortgage.balance : 0,
            openingDrawn: alreadyStarted ? Number(openingDrawn) || 0 : 0,
            openingDate: alreadyStarted ? startDate : null,
            homeValue: homeValue === "" ? null : Number(homeValue) || null,
          })
        }
      >
        Start tracking
      </Button>
    </div>
  );
}

function NewDebtForm({
  kind,
  onCreate,
  onCancel,
}: {
  kind: "mortgage" | "heloc";
  onCreate: (debt: DebtInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState(0);
  const [ratePct, setRatePct] = useState(kind === "mortgage" ? 5 : 5.5);
  const [payment, setPayment] = useState(0);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">("monthly");

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "mortgage" ? "e.g. Readvanceable mortgage" : "e.g. HELOC"}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Balance ($)</Label>
          <NumInput value={balance} onCommit={(n) => setBalance(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rate (%/yr)</Label>
          <NumInput value={ratePct} onCommit={(n) => setRatePct(Math.max(0, n))} />
        </div>
      </div>
      {kind === "mortgage" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Payment ($)</Label>
            <NumInput value={payment} onCommit={(n) => setPayment(Math.max(0, n))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onCreate({
              id: `d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              name: name.trim() || (kind === "mortgage" ? "Mortgage" : "HELOC"),
              kind,
              balance: Math.max(0, balance),
              rate: Math.max(0, ratePct) / 100,
              payment: Math.max(0, payment),
              deductible: kind === "heloc",
              paymentFrequency: kind === "mortgage" ? frequency : undefined,
              rateHistory:
                kind === "heloc"
                  ? [{ date: new Date().toISOString().slice(0, 10), rate: Math.max(0, ratePct) / 100 }]
                  : undefined,
            })
          }
        >
          Add
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Appears in your Debts tab automatically.
      </p>
    </div>
  );
}

function ReconciliationLine({
  helocBalance,
  openingDrawn,
  tranches,
}: {
  helocBalance: number;
  openingDrawn: number;
  tranches: SmithTranche[];
}) {
  const trancheTotal = tranches.reduce((s, t) => s + Math.max(0, t.principal), 0);
  const repayments = tranches.reduce(
    (s, t) => s + t.repayments.reduce((r, x) => r + Math.max(0, x.amount), 0),
    0,
  );
  const expected = Math.max(0, openingDrawn) + trancheTotal - repayments;
  const diff = helocBalance - expected;
  const matches = Math.abs(diff) < 0.01;

  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
      <span className="font-medium">HELOC check:</span>{" "}
      {formatCad(helocBalance)} balance
      {matches ? (
        <span className="text-emerald-700">
          {" "}= {formatCad(Math.max(0, openingDrawn))} opening + {formatCad(trancheTotal)} draws
          {repayments > 0 ? ` − ${formatCad(repayments)} repaid` : ""} ✓
        </span>
      ) : (
        <span className="text-amber-700">
          {" "}doesn&apos;t match the ledger ({formatCad(Math.max(0, openingDrawn))} opening +{" "}
          {formatCad(trancheTotal)} draws{repayments > 0 ? ` − ${formatCad(repayments)} repaid` : ""}{" "}
          = {formatCad(expected)}). Check the balance on the Debts tab.
        </span>
      )}
    </div>
  );
}

function RoomDrawCard({
  mortgage,
  heloc,
  room,
  tranches,
  openingDrawn,
  homeValue,
  onHomeValue,
  locked,
  onUnlock,
  lastTranche,
  onDraw,
  onRefinance,
  onUnlink,
}: {
  mortgage: DebtInput;
  heloc: DebtInput;
  room: { roomCreated: number; roomAvailable: number; paymentsCounted: number };
  tranches: SmithTranche[];
  openingDrawn: number;
  homeValue: number | null;
  onHomeValue: (v: number | null) => void;
  locked: boolean;
  onUnlock: () => void;
  lastTranche: SmithTranche | null;
  onDraw: (tranche: SmithTranche, drawnAmount: number) => void;
  onRefinance: (
    snapshot: { date: string; balance: number; rate: number; payment: number; propertyValue: number; paymentFrequency?: "weekly" | "biweekly" | "monthly" },
    newTerms: { balance: number; rate: number; payment: number; paymentFrequency: "weekly" | "biweekly" | "monthly" },
  ) => void;
  onUnlink: () => void;
}) {
  const [drawn, setDrawn] = useState(0);
  const [bought, setBought] = useState("");
  const [showRefinance, setShowRefinance] = useState(false);

  const repeatLast = () => {
    if (!lastTranche) return;
    setBought(lastTranche.useOfFunds);
  };

  const record = () => {
    if (drawn <= 0 || drawn > room.roomAvailable) return;
    const tranche: SmithTranche = {
      id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      facility: heloc.name || "HELOC",
      drawDate: new Date().toISOString().slice(0, 10),
      principal: drawn,
      rate: heloc.rate,
      useOfFunds: bought,
      eligible: true,
      purposeEvidence: "",
      interestPaidYtd: 0,
      repayments: [],
      personalUse: false,
      personalUseDate: null,
      commingled: false,
      disposition: null,
      s201Deemed: 0,
      holdingId: null,
      distributions: [],
      documents: "",
    };
    onDraw(tranche, drawn);
    setDrawn(0);
    setBought("");
  };

  const pct = room.roomCreated > 0 ? (room.roomAvailable / room.roomCreated) * 100 : 0;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">HELOC room</h3>
          <p className="text-sm text-muted-foreground">
            {mortgage.name || "Mortgage"} → {heloc.name || "HELOC"} ·{" "}
            {room.paymentsCounted} payments counted
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowRefinance((v) => !v)}>
            {showRefinance ? "Close" : "Refinance"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (locked ? onUnlock() : onUnlink())}
            title={locked ? "Pro feature — click to upgrade" : undefined}
          >
            {locked ? "🔒 Unlink" : "Unlink"}
          </Button>
        </div>
      </div>

      {showRefinance ? (
        <LockedSection locked={locked} onUnlock={onUnlock} label="Refinance">
          <RefinanceForm
            mortgage={mortgage}
            onRefinance={(snapshot, newTerms) => {
              onRefinance(snapshot, newTerms);
              setShowRefinance(false);
            }}
          />
        </LockedSection>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Home value</div>
          <div className="text-xl font-bold">{homeValue ? formatCad(homeValue) : "—"}</div>
          <div className="mt-1">
            <LockedSection locked={locked} onUnlock={onUnlock} label="Edit home value">
              <NumInput
                value={homeValue}
                onCommit={(n) => onHomeValue(Math.max(0, n) || null)}
              />
            </LockedSection>
          </div>
          <div className="text-[11px] text-muted-foreground">Equity base for readvanceable limit</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Room created</div>
          <div className="text-xl font-bold">{formatCad(room.roomCreated)}</div>
          <div className="text-[11px] text-muted-foreground">Principal repaid</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Drawn</div>
          <div className="text-xl font-bold">{formatCad(room.roomCreated - room.roomAvailable)}</div>
          <div className="text-[11px] text-muted-foreground">{tranches.length} draw(s)</div>
        </div>
        <div className="rounded-lg border bg-emerald-50 p-3">
          <div className="text-xs text-muted-foreground">Available to draw</div>
          <div className="text-xl font-bold text-emerald-800">{formatCad(room.roomAvailable)}</div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      </div>

      <ReconciliationLine
        helocBalance={heloc.balance}
        openingDrawn={openingDrawn}
        tranches={tranches}
      />

      <LockedSection locked={locked} onUnlock={onUnlock} label="Record a draw">
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Record a draw</h4>
            {lastTranche ? (
            <Button size="sm" variant="outline" onClick={repeatLast}>
              Repeat last purchase
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Amount ($)</Label>
            <NumInput value={drawn} onCommit={(n) => setDrawn(Math.max(0, n))} />
            <p className="text-[11px] text-muted-foreground">
              Up to {formatCad(room.roomAvailable)} — take all or part
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rate (%/yr)</Label>
            <NumInput value={Math.round(heloc.rate * 10000) / 100} onCommit={() => {}} />
            <p className="text-[11px] text-muted-foreground">From HELOC — update it on the Debts tab</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What it bought</Label>
            <Input
              value={bought}
              onChange={(e) => setBought(e.target.value)}
              placeholder="e.g. 100 XIU, non-reg"
            />
          </div>
        </div>
        {drawn > room.roomAvailable ? (
          <p className="text-xs text-red-700">
            More than the available room — lower the amount or wait for more principal payments.
          </p>
        ) : null}
        <Button size="sm" onClick={record} disabled={drawn <= 0 || drawn > room.roomAvailable}>
          Record draw
        </Button>
        <p className="text-[11px] text-muted-foreground">
          The HELOC balance on your Debts tab updates automatically.
        </p>
        </div>
      </LockedSection>
    </div>
  );
}

function RefinanceForm({
  mortgage,
  onRefinance,
}: {
  mortgage: DebtInput;
  onRefinance: (
    snapshot: { date: string; balance: number; rate: number; payment: number; propertyValue: number; paymentFrequency?: "weekly" | "biweekly" | "monthly" },
    newTerms: { balance: number; rate: number; payment: number; paymentFrequency: "weekly" | "biweekly" | "monthly" },
  ) => void;
}) {
  const [balance, setBalance] = useState(mortgage.balance);
  const [ratePct, setRatePct] = useState(mortgage.rate * 100);
  const [payment, setPayment] = useState(mortgage.payment);
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">(
    mortgage.paymentFrequency ?? "monthly",
  );
  const [propertyValue, setPropertyValue] = useState(0);

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <h4 className="text-sm font-medium">Refinance — update mortgage terms</h4>
      <p className="text-[11px] text-muted-foreground">
        Today's terms are snapshotted to history before the new ones take effect.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">New balance ($)</Label>
          <NumInput value={balance} onCommit={(n) => setBalance(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">New rate (%/yr)</Label>
          <NumInput value={ratePct} onCommit={(n) => setRatePct(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">New payment ($)</Label>
          <NumInput value={payment} onCommit={(n) => setPayment(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Frequency</Label>
          <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Biweekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1 max-w-xs">
        <Label className="text-xs">Property value at refinance ($)</Label>
        <NumInput value={propertyValue} onCommit={(n) => setPropertyValue(Math.max(0, n))} />
      </div>
      <Button
        size="sm"
        onClick={() =>
          onRefinance(
            {
              date: new Date().toISOString().slice(0, 10),
              balance: mortgage.balance,
              rate: mortgage.rate,
              payment: mortgage.payment,
              propertyValue,
              paymentFrequency: mortgage.paymentFrequency ?? "monthly",
            },
            {
              balance: Math.max(0, balance),
              rate: Math.max(0, ratePct) / 100,
              payment: Math.max(0, payment),
              paymentFrequency: frequency,
            },
          )
        }
      >
        Save new terms
      </Button>
      {mortgage.termHistory && mortgage.termHistory.length > 0 ? (
        <div className="text-[11px] text-muted-foreground space-y-1">
          <p className="font-medium">Past terms:</p>
          <ul className="list-disc pl-4">
            {mortgage.termHistory.map((t, i) => (
              <li key={i}>
                {t.date}: {formatCad(t.balance)} at {(t.rate * 100).toFixed(2)}%,{" "}
                {formatCad(t.payment)}/payment
                {t.propertyValue > 0 ? `, property ${formatCad(t.propertyValue)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

