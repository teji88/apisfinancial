import { createFileRoute, Link, redirect } from "@tanstack/react-router";
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
import { formatCad, summariseAccount, type Account, type Holding, type Transaction } from "@/lib/finance";
import { useAddTransactions, usePortfolio } from "@/lib/portfolio";
import {
  inferProposals,
  parseSmithCsv,
  proposedTrancheNote,
  proposalCategory,
  type OutflowClassification,
  type ProposedItem,
  type ProposedOutflow,
  type ProposedTranche,
  type ProposalCategory,
  type SmithCsvRow,
} from "@/lib/retirement/smithCsvImport";
import { ledgerTransactionsToSmithRows, parsedStatementToSmithRows } from "@/lib/retirement/smithLedgerImport";
import { applyPresortDecisions } from "@/lib/retirement/smithPresort";
import { presortSmithProposals } from "@/lib/smith-presort.functions";
import { useServerFn } from "@tanstack/react-start";
import { learnCsvMapping } from "@/lib/csv-learn.functions";
import { parseStatement } from "@/lib/import.functions";
import { classifyFile } from "@/lib/file-kind";
import {
  buildLearnedProfile,
  saveLearnedProfile,
} from "@/lib/csv-learn";
import type { ProvinceCode } from "@/lib/tax";
import {
  useProfile,
  useUpdateProfile,
  monthlyEquivalentPayment,
  type SmithTranche,
  type DebtInput,
  type DebtPaymentFrequency,
} from "@/lib/profile";
import { marginalRateAt } from "@/lib/retirement/marginalRate";
import { computeSmithSavings } from "@/lib/retirement/optimization/SmithSavings";
import { assessSmithLedger, CRA_FILING_DISCLAIMER, totalReturnGain, withdrawnDistributionsTotal } from "@/lib/retirement/optimization/SmithTracker";
import { computeRoomSegmented, type TermSegment } from "@/lib/retirement/optimization/SmithRoom";
import { SmithTrackerCard } from "@/components/retirement/DebtNetWorth";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";
import { AiQuotaNote } from "@/components/AiQuotaNote";

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
  component: SmithRedirect,
});

// HELOC Investing now lives under the "Debts" tab — keep the old URL working.
function SmithRedirect() {
  throw redirect({ to: "/debts", search: { tab: "heloc" } });
}

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

export function SmithPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { hasStatementAi } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // The HELOC tracker is free for everyone. Only AI features (statement
  // reading, AI pre-sort, layout learning) stay behind Pro — they cost
  // money to run. hasStatementAi gates exactly those.

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
  // Ledger rows of the linked account, shaped for tranche reconstruction
  // (reuses the CSV inference rules — no upload needed).
  const linkedSmithRows = useMemo(() => {
    if (!linkedAccount) return [];
    const symbolByHoldingId = new Map(portfolioHoldings.map((h) => [h.id, h.symbol]));
    return ledgerTransactionsToSmithRows(
      portfolioTransactions.filter((t) => t.account_id === linkedAccount.id),
      symbolByHoldingId,
    );
  }, [linkedAccount, portfolioTransactions, portfolioHoldings]);
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
  const helocRateEstimated = !(heloc && heloc.rate > 0) && trancheRates.length === 0;

  const [stopRedraw, setStopRedraw] = useState(false);
  const [rateBump, setRateBump] = useState(false);

  const savings = useMemo(
    () =>
      computeSmithSavings({
        mortgageBalance: mortgage?.balance ?? 0,
        mortgageRate: mortgage?.rate ?? 0,
        mortgagePayment: monthlyEquivalentPayment(mortgage?.payment ?? 0, mortgage?.paymentFrequency),
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
        reason="AI statement reading is the one paid feature ($10 a year) — it's what costs us to run. Everything else in the tracker is free."
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
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300">1</span>
              <span><strong>Add your HELOC</strong> below — it lands in your debts list automatically.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300">2</span>
              <span><strong>Record each month's draw</strong> in the check-in: principal paid → room created → amount drawn → what it bought.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300">3</span>
              <span><strong>Watch the dashboard</strong> — tax saved this year, all-time, and projected through payoff, plus a clean tracing ledger for tax time.</span>
            </li>
          </ol>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950 p-4">
          <div className="text-xs text-muted-foreground">Tax saved this year</div>
          <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-300">{formatCad(savings.taxSavedYtd)}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(interestPaidYtd)} deductible interest × {(marginalRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Tax saved all-time</div>
          <div className="text-2xl font-bold">{formatCad(savings.taxSavedAllTime)}</div>
          <div className="text-[11px] text-muted-foreground">Realized, in your pocket</div>
        </div>
        <div className="rounded-xl border bg-sky-50 dark:bg-sky-950 p-4">
          <div className="text-xs text-muted-foreground">Projected total by payoff</div>
          <div className="text-2xl font-bold text-sky-800 dark:text-sky-300">{formatCad(savings.totalProjected)}</div>
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
            {helocRateEstimated ? (
              <span className="text-amber-800 dark:text-amber-300">
                {" "}· using a 5.50% HELOC rate estimate — set the actual rate on the debt in the Debts tab.
              </span>
            ) : null}
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
          withdrawnDistributions={withdrawnDistributionsTotal(ledger.distributions)}
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
          lastTranche={tranches.length > 0 ? tranches[tranches.length - 1] : null}
          linkedAccountId={settings.investmentAccountId ?? null}
          linkedAccountName={portfolioAccounts.find((a) => a.id === settings.investmentAccountId)?.account_name ?? null}
          fxUsdCad={fxUsdCad}
          transactions={portfolioTransactions}
          holdings={portfolioHoldings}
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
      )}

      {/* Prior interest — one-time entry so all-time savings include earlier years */}
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

      {/* Tranche timeline */}
      {p && pairHeloc ? (
        <SmithCsvImportCard
          heloc={pairHeloc}
          tranches={tranches}
          onImport={(newTranches, repaymentAdds) => {            const withRepayments = [...tranches, ...newTranches].map((t) => {
              const adds = repaymentAdds.filter((r) => r.trancheId === t.id);
              if (adds.length === 0) return t;
              return {
                ...t,
                repayments: [
                  ...t.repayments,
                  ...adds.map((a) => ({ date: a.date, amount: a.amount })),
                ],
              };
            });
            save({ smith_tranches: withRepayments });
          }}
          hasAi={hasStatementAi}
          onUnlockAi={() => setUpgradeOpen(true)}
          linkedAccountName={linkedAccount?.account_name ?? null}
          linkedRows={linkedSmithRows}
        />
      ) : null}
      {p ? (
        <SmithTrackerCard
          profile={p}
          onSave={(t) => save({ smith_tranches: t })}
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
        <p className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 text-xs font-medium text-amber-900 dark:text-amber-100">
          {CRA_FILING_DISCLAIMER}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        A summary also appears on the <Link to="/retirement" search={{ tab: "planner" }} className="underline">retirement planner</Link>.
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
    <div className="rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 p-4 space-y-2">
      <h3 className="text-sm font-semibold">Has your HELOC rate changed?</h3>
      <p className="text-sm text-muted-foreground">
        The Bank of Canada sets rates 8 times a year, and banks usually follow within
        days. Your HELOC is at {(heloc.rate * 100).toFixed(2)}%
        {lastChecked ? ` (last confirmed ${lastChecked})` : ""}. If your bank moved
        it, update the rate on the{" "}
        <Link to="/debts" search={{ tab: "debts" }} className="underline">Debts tab</Link> — future
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
  withdrawnDistributions,
  investmentHoldingIds,
  onLinkHolding,
  onUnlinkHolding,
  accounts,
  investmentAccountId,
  onSelectAccount,
  linkedAccountName,
  linkedAccountValue,
}: {
  tranches: SmithTranche[];
  holdings: Array<{ id: string; name: string; value: number }>;
  drawn: number;
  distributionsYtd: number;
  /** Cash withdrawn from the investments (to mortgage / spent) — counts toward total return. */
  withdrawnDistributions: number;
  investmentHoldingIds: string[];
  onLinkHolding: (id: string) => void;
  onUnlinkHolding: (id: string) => void;
  accounts: Account[];
  investmentAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  linkedAccountName: string | null;
  linkedAccountValue: number | null;
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
  // Total return: current value + cash already withdrawn from the account, vs drawn.
  // Withdrawing dividends/sale proceeds no longer makes performance look worse.
  const gain = totalReturnGain(investmentValue, withdrawnDistributions, drawn);
  const gainPct = drawn > 0 ? (gain / drawn) * 100 : 0;
  const yieldPct = investmentValue > 0 ? (distributionsYtd / investmentValue) * 100 : 0;
  const withdrawnNote =
    withdrawnDistributions > 0 ? ` · incl. ${formatCad(withdrawnDistributions)} withdrawn` : "";

  return (
    <div className="rounded-xl border p-4 space-y-2">
      <div className="text-xs text-muted-foreground">Investment account</div>
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
            >
              Unlink
            </Button>
          ) : null}
      </div>
      {linkedAccountValue != null ? (
        <>
          <div className="text-2xl font-bold">{formatCad(linkedAccountValue)}</div>
          <div className="text-[11px] text-muted-foreground">{linkedAccountName}</div>
          <div className={`text-xs font-medium ${gain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
            {gain >= 0 ? "+" : ""}{formatCad(gain)} ({gainPct.toFixed(1)}%) vs {formatCad(drawn)} drawn{withdrawnNote}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(distributionsYtd)} distributions YTD
            {yieldPct > 0 ? ` · ${yieldPct.toFixed(1)}% yield` : ""}
          </div>
        </>
      ) : linkedHoldings.length > 0 ? (
        <>
          <div className="text-2xl font-bold">{formatCad(linkedHoldingsValue)}</div>
          <div className={`text-xs font-medium ${gain >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
            {gain >= 0 ? "+" : ""}{formatCad(gain)} ({gainPct.toFixed(1)}%) vs {formatCad(drawn)} drawn{withdrawnNote}
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
      {investmentAccountId ? (
        <p className="text-[11px] text-muted-foreground">
          Using every holding in {linkedAccountName ?? "the linked account"} — add or edit
          investments normally in the{" "}
          <Link to="/accounts" className="text-primary underline">
            Accounts tab
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            Add investments normally in the{" "}
            <Link to="/accounts" className="text-primary underline">
              Accounts tab
            </Link>{" "}
            — they appear here once this account is linked. Or link individual holdings below.
          </p>
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
        </>
      )}
    </div>
  );
}

const OUTFLOW_LABELS: Record<OutflowClassification, string> = {
  heloc_repayment: "HELOC repayment",
  mortgage_prepayment: "Mortgage prepayment",
  personal: "Personal use",
  moved_elsewhere: "Moved elsewhere",
};

/**
 * Import past Smith activity from a brokerage CSV. Every inferred item must
 * be reviewed and confirmed — nothing is recorded silently. Pro-gated.
 */
function SmithCsvImportCard({
  heloc,
  tranches,
  onImport,
  hasAi,
  onUnlockAi,
  linkedAccountName,
  linkedRows,
}: {
  heloc: DebtInput;
  tranches: SmithTranche[];
  onImport: (
    newTranches: SmithTranche[],
    repaymentAdds: Array<{ trancheId: string; date: string; amount: number }>,
  ) => void;
  /** AI features (statement reading, pre-sort, layout learning) stay Pro-gated. */
  hasAi: boolean;
  onUnlockAi: () => void;
  linkedAccountName: string | null;
  linkedRows: SmithCsvRow[];
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposedItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [classifications, setClassifications] = useState<Record<string, OutflowClassification>>({});
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [source, setSource] = useState<"csv" | "ledger" | "statement">("csv");
  const [unreadable, setUnreadable] = useState<{ fileName: string; text: string } | null>(null);
  const [learning, setLearning] = useState(false);
  const [learnError, setLearnError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [presorting, setPresorting] = useState(false);
  const [presortNotes, setPresortNotes] = useState<Record<string, string>>({});
  const [aiPresorted, setAiPresorted] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | "tranche" | "outflow">("all");
  const [catFilter, setCatFilter] = useState<"all" | ProposalCategory>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [bulkClass, setBulkClass] = useState<OutflowClassification | "">("");
  const learnMapping = useServerFn(learnCsvMapping);
  const parseStatementFn = useServerFn(parseStatement);
  const presortFn = useServerFn(presortSmithProposals);

  const showProposals = (items: ProposedItem[], label: string, warn: string[], src: "csv" | "ledger" | "statement") => {
    setFileName(label);
    setProposals(items);
    setWarnings(warn);
    setSource(src);
    setUnreadable(null);
    // Tranches are pre-checked (still user-confirmable); outflows need
    // classification first, so they start unchecked.
    setChecked(new Set(items.filter((i) => i.kind === "tranche").map((i) => i.key)));
    setClassifications({});
    setPresortNotes({});
    setAiPresorted(false);
    setKindFilter("all");
    setCatFilter("all");
    setSortBy("date");
    setBulkClass("");
  };

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    setDoneMsg(null);
    setLearnError(null);
    // Route by content, not extension: PDFs/images go to the AI statement
    // reader (bank prompt); text files go through the deterministic CSV parser.
    const kind = classifyFile(new Uint8Array(await f.slice(0, 32).arrayBuffer()), f.name, f.type);
    if (kind === "pdf" || kind === "image") {
      if (!hasAi) {
        onUnlockAi();
        return;
      }
      await handleStatementFile(f);
      return;
    }
    const text = await f.text();
    const parsed = parseSmithCsv(text);
    if (parsed.rows.length === 0) {
      // Keep the file around so "Learn this layout with AI" can use it.
      setUnreadable({ fileName: f.name, text });
      setProposals(null);
      setWarnings(parsed.warnings);
      return;
    }
    const items = inferProposals(parsed.rows);
    showProposals(items, f.name, parsed.warnings, "csv");
  };

  /** Read a PDF/image bank or HELOC statement with AI, then propose tranches. */
  const handleStatementFile = async (f: File) => {
    setReading(true);
    setWarnings([]);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Could not read that file."));
        r.readAsDataURL(f);
      });
      const result = await parseStatementFn({
        data: { fileName: f.name, mimeType: f.type, dataUrl, text: null, statementKind: "bank" },
      });
      const rows = parsedStatementToSmithRows(result.transactions);
      if (rows.length === 0) {
        setProposals(null);
        setWarnings(["The AI couldn't find any usable transactions in that statement."]);
        return;
      }
      showProposals(inferProposals(rows), f.name, [], "statement");
    } catch (e) {
      setProposals(null);
      setWarnings([e instanceof Error ? e.message : "Could not read that statement."]);
    } finally {
      setReading(false);
    }
  };

  /** AI pre-sort: suggest which proposed tranches look like Smith money. */
  const handlePresort = async () => {
    if (!proposals || presorting) return;
    setPresorting(true);
    try {
      const result = await presortFn({
        data: {
          items: proposals.map((i) => ({
            key: i.key,
            kind: i.kind,
            date: i.date,
            amount: i.amount,
            symbol: i.symbol,
            note: i.note,
          })),
          existingTranches: tranches.map((t) => ({ drawDate: t.drawDate, principal: t.principal })),
          helocName: heloc.name || "HELOC",
        },
      });
      const { checked: next, notes } = applyPresortDecisions(proposals, result.decisions);
      setChecked(next);
      setPresortNotes(notes);
      setAiPresorted(true);
    } catch (e) {
      setWarnings((w) => [...w, e instanceof Error ? e.message : "AI pre-sort failed."]);
    } finally {
      setPresorting(false);
    }
  };
  /** Reconstruct proposals from the already-imported linked account — no CSV needed. */
  const handleLedgerReconstruct = () => {
    if (linkedRows.length === 0) return;
    setDoneMsg(null);
    setLearnError(null);
    const items = inferProposals(linkedRows);
    showProposals(
      items,
      linkedAccountName ?? "Linked account",
      [],
      "ledger",
    );
  };

  /** Teach the parser this CSV's layout with AI (Pro), then re-parse deterministically. */
  const handleLearnLayout = async () => {
    if (!unreadable || learning) return;
    setLearning(true);
    setLearnError(null);
    try {
      const sample = unreadable.text.split("\n").slice(0, 30).join("\n");
      const mapping = await learnMapping({ data: { fileName: unreadable.fileName, sample } });
      const headerLine = unreadable.text.split("\n")[0] ?? "";
      const headers = headerLine.split(",").map((h) => h.replace(/^"|"$/g, ""));
      saveLearnedProfile(
        buildLearnedProfile({
          name: mapping.institution_name,
          headers,
          columns: mapping.columns,
          typeMap: mapping.type_map,
        }),
      );
      // Re-parse: parseSmithCsv picks up the just-saved profile automatically.
      const parsed = parseSmithCsv(unreadable.text);
      if (parsed.rows.length === 0) {
        setLearnError("The layout was saved, but no usable rows were found. Check the file and try again.");
        setWarnings(parsed.warnings);
        return;
      }
      showProposals(inferProposals(parsed.rows), unreadable.fileName, parsed.warnings, "csv");
    } catch (e) {
      setLearnError(e instanceof Error ? e.message : "Could not learn this layout.");
    } finally {
      setLearning(false);
    }
  };

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmedTranches = (proposals ?? []).filter(
    (i): i is ProposedTranche => i.kind === "tranche" && checked.has(i.key),
  );
  const confirmedOutflows = (proposals ?? []).filter(
    (i): i is ProposedOutflow =>
      i.kind === "outflow" && checked.has(i.key) && !!classifications[i.key],
  );
  const outflowsMissingClass = (proposals ?? []).filter(
    (i): i is ProposedOutflow =>
      i.kind === "outflow" && checked.has(i.key) && !classifications[i.key],
  );
  const canConfirm = confirmedTranches.length + confirmedOutflows.length > 0 && outflowsMissingClass.length === 0;

  /** Filtered + sorted view of the proposals (review only — confirm uses the full list). */
  const visibleProposals = (proposals ?? [])
    .filter((i) => kindFilter === "all" || i.kind === kindFilter)
    .filter((i) => catFilter === "all" || proposalCategory(i.rawType) === catFilter)
    .sort((a, b) =>
      sortBy === "amount" ? b.amount - a.amount : a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

  /** Apply one classification to every checked outflow missing one. */
  const applyBulkClassify = () => {
    if (!bulkClass) return;
    setClassifications((prev) => {
      const next = { ...prev };
      for (const o of outflowsMissingClass) next[o.key] = bulkClass;
      return next;
    });
    setBulkClass("");
  };

  const handleConfirm = () => {
    const today = new Date().toISOString().slice(0, 10);
    const newTranches: SmithTranche[] = confirmedTranches.map((item, n) => ({
      id: `s-csv-${Date.now()}-${n}`,
      facility: heloc.name || "HELOC",
      drawDate: item.date,
      principal: item.amount,
      rate: heloc.rate,
      useOfFunds: item.symbol ?? "Investment account",
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
      ledgerTransactionIds: [],
      documents: proposedTrancheNote(
        item,
        today,
        source === "ledger"
          ? "linked investment account"
          : source === "statement"
            ? "bank statement (AI-read)"
            : "brokerage CSV",
      ),
    }));

    // HELOC repayments apply FIFO across tranches (oldest draw first).
    const repaymentAdds: Array<{ trancheId: string; date: string; amount: number }> = [];
    const helocRepayments = confirmedOutflows.filter(
      (o) => classifications[o.key] === "heloc_repayment",
    );
    if (helocRepayments.length > 0) {
      const all = [...tranches, ...newTranches].sort((a, b) =>
        a.drawDate < b.drawDate ? -1 : a.drawDate > b.drawDate ? 1 : 0,
      );
      for (const o of helocRepayments) {
        let remaining = o.amount;
        for (const t of all) {
          const alreadyRepaid =
            t.repayments.reduce((s, r) => s + r.amount, 0) +
            repaymentAdds.filter((r) => r.trancheId === t.id).reduce((s, r) => s + r.amount, 0);
          const outstanding = t.principal - alreadyRepaid;
          if (outstanding <= 0) continue;
          const apply = Math.min(remaining, outstanding);
          repaymentAdds.push({ trancheId: t.id, date: o.date, amount: apply });
          remaining -= apply;
          if (remaining <= 0) break;
        }
      }
    }

    onImport(newTranches, repaymentAdds);
    const other = confirmedOutflows.filter((o) => classifications[o.key] !== "heloc_repayment");
    setDoneMsg(
      `Added ${newTranches.length} tranche(s)` +
        (repaymentAdds.length > 0 ? ` and ${repaymentAdds.length} repayment(s)` : "") +
        (other.length > 0
          ? `. ${other.length} outflow(s) classified (${other
              .map((o) => OUTFLOW_LABELS[classifications[o.key]!])
              .join(", ")}) — update the related balances manually.`
          : "."),
    );
    setProposals(null);
    setFileName(null);
    setChecked(new Set());
    setClassifications({});
  };

  const reset = () => {
    setProposals(null);
    setFileName(null);
    setWarnings([]);
    setChecked(new Set());
    setClassifications({});
    setDoneMsg(null);
    setSource("csv");
    setUnreadable(null);
    setLearnError(null);
    setReading(false);
    setPresorting(false);
    setPresortNotes({});
    setAiPresorted(false);
    setKindFilter("all");
    setCatFilter("all");
    setSortBy("date");
    setBulkClass("");
  };

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div>
        <h3 className="text-base font-semibold">Import past activity</h3>
        <p className="text-sm text-muted-foreground">
          Been running this strategy for years? Reconstruct tranches from your linked
          investment account — or upload that account's CSV and we'll propose tranches
          from it. You review and confirm each one.
        </p>
      </div>
        {doneMsg ? (
          <p className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-3 text-sm text-emerald-900 dark:text-emerald-100">
            {doneMsg}
          </p>
        ) : null}
        {proposals === null ? (
          <div className="space-y-4">
            {linkedAccountName && linkedRows.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">1 · From your ledger (recommended)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={handleLedgerReconstruct}>
                    Reconstruct from {linkedAccountName}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {linkedRows.length} transaction{linkedRows.length === 1 ? "" : "s"} already
                    in your ledger — no upload needed.
                  </span>
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                {linkedAccountName && linkedRows.length > 0 ? "2 · From a file" : "From a file"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept=".csv,text/csv,.pdf,application/pdf,image/png,image/jpeg"
                  className="max-w-xs"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
                {reading ? <span className="text-xs text-muted-foreground">Reading statement with AI…</span> : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                CSVs parse instantly on your device. PDF or image statements are read with AI
                (Pro) — draws become proposed tranches, payments become outflows for review.{" "}
                {hasAi ? <AiQuotaNote /> : null}
              </p>
            </div>
            {proposals === null && warnings.length > 0 && !unreadable
              ? warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-800 dark:text-amber-300">{w}</p>
                ))
              : null}
            {unreadable ? (
              <div className="space-y-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3">
                <p className="text-sm">
                  We couldn't read <span className="font-medium">{unreadable.fileName}</span> —
                  the column layout wasn't recognized.
                </p>
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-800 dark:text-amber-300">{w}</p>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <LockedSection locked={!hasAi} onUnlock={onUnlockAi} label="AI layout learning">
                    <Button size="sm" onClick={() => void handleLearnLayout()} disabled={learning}>
                      {learning ? "Learning…" : "Learn this layout with AI"}
                    </Button>
                  </LockedSection>
                  <Button size="sm" variant="ghost" onClick={reset}>
                    Dismiss
                  </Button>
                  {hasAi ? <AiQuotaNote /> : null}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  AI reads only the header row and a few sample lines to learn the column
                  mapping — never your full file. The layout is saved on this device, so
                  future files with the same layout parse instantly with no AI involved.
                </p>
                {learnError ? <p className="text-xs text-red-700 dark:text-red-400">{learnError}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Review proposals from {fileName} — {proposals.length} item(s)
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {source === "ledger" ? "From your ledger" : source === "statement" ? "From statement" : "From CSV"}
                </span>
                {source === "statement" || aiPresorted ? (
                  <span className="ml-1 rounded-full bg-violet-100 dark:bg-violet-900 px-2 py-0.5 text-[11px] text-violet-900 dark:text-violet-100">
                    AI-assisted
                  </span>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                <LockedSection locked={!hasAi} onUnlock={onUnlockAi} label="AI pre-sort">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePresort()}
                    disabled={presorting}
                    title="Let AI suggest which tranches look like Smith-manoeuvre money. You still confirm each one."
                  >
                    {presorting ? "Pre-sorting…" : "AI pre-sort"}
                  </Button>
                </LockedSection>
                <Button size="sm" variant="ghost" onClick={reset}>
                  Cancel
                </Button>
                {hasAi ? <AiQuotaNote /> : null}
              </div>
            </div>
            {aiPresorted ? (
              <p className="text-[11px] text-muted-foreground">
                AI suggested the initial checks from draw amounts and timing — outflows are
                never pre-checked. You still confirm each item.
              </p>
            ) : null}
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                {w}
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  <SelectItem value="tranche">Tranches</SelectItem>
                  <SelectItem value="outflow">Outflows</SelectItem>
                </SelectContent>
              </Select>
              <Select value={catFilter} onValueChange={(v) => setCatFilter(v as typeof catFilter)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {(["Buy", "Sell", "Deposit", "Withdrawal", "Distribution", "Other"] as const).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Sort: date</SelectItem>
                  <SelectItem value="amount">Sort: amount</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">
                Showing {visibleProposals.length} of {proposals.length}
              </span>
            </div>
            {outflowsMissingClass.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
                <span className="text-muted-foreground">
                  {outflowsMissingClass.length} checked outflow{outflowsMissingClass.length === 1 ? "" : "s"} need{outflowsMissingClass.length === 1 ? "s" : ""} tagging:
                </span>
                <Select value={bulkClass} onValueChange={(v) => setBulkClass(v as OutflowClassification)}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Classify all as…" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(OUTFLOW_LABELS) as OutflowClassification[]).map((c) => (
                      <SelectItem key={c} value={c}>{OUTFLOW_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!bulkClass} onClick={applyBulkClassify}>
                  Apply to all
                </Button>
              </div>
            ) : null}
            <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {visibleProposals.map((item) => {
                const isOutflow = item.kind === "outflow";
                return (
                  <div
                    key={item.key}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${
                      isOutflow ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(item.key)}
                      onChange={() => toggle(item.key)}
                      aria-label={`Confirm ${item.note}`}
                    />
                    <span className="font-medium">{formatCad(item.amount)}</span>
                    <span className="text-muted-foreground">{item.date}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        isOutflow
                          ? "bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100"
                          : "bg-sky-100 dark:bg-sky-900 text-sky-900 dark:text-sky-100"
                      }`}
                    >
                      {isOutflow ? "Outflow" : "Tranche"} · {proposalCategory(item.rawType)}
                    </span>
                    <span className="text-xs text-muted-foreground">{item.note}</span>
                    {presortNotes[item.key] ? (
                      <span className="w-full text-[11px] text-violet-800 dark:text-violet-300">
                        AI: {presortNotes[item.key]}
                      </span>
                    ) : null}
                    {isOutflow && checked.has(item.key) ? (
                      <Select
                        value={classifications[item.key] ?? ""}
                        onValueChange={(v) =>
                          setClassifications((prev) => ({
                            ...prev,
                            [item.key]: v as OutflowClassification,
                          }))
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="Classify outflow…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(OUTFLOW_LABELS) as OutflowClassification[]).map((c) => (
                            <SelectItem key={c} value={c}>
                              {OUTFLOW_LABELS[c]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {outflowsMissingClass.length > 0 ? (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Classify each checked outflow before adding.
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Inferred items are proposals only — nothing is recorded until you confirm.
              This import reconstructs your records; it is not tax advice. Check each item
              against your statements.
            </p>
            <Button size="sm" disabled={!canConfirm} onClick={handleConfirm}>
              Add confirmed ({confirmedTranches.length + confirmedOutflows.length})
            </Button>
          </div>
        )}
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
  const [frequency, setFrequency] = useState<DebtPaymentFrequency>("monthly");

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
                <SelectItem value="accelerated-weekly">Accelerated weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="accelerated-biweekly">Accelerated biweekly</SelectItem>
                <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
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
        <span className="text-emerald-700 dark:text-emerald-400">
          {" "}= {formatCad(Math.max(0, openingDrawn))} opening + {formatCad(trancheTotal)} draws
          {repayments > 0 ? ` − ${formatCad(repayments)} repaid` : ""} ✓
        </span>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">
          {" "}doesn&apos;t match the ledger ({formatCad(Math.max(0, openingDrawn))} opening +{" "}
          {formatCad(trancheTotal)} draws{repayments > 0 ? ` − ${formatCad(repayments)} repaid` : ""}{" "}
          = {formatCad(expected)}). Check the balance on the Debts tab.
        </span>
      )}
    </div>
  );
}

/** One purchase row in the record-a-draw form — mirrors the ledger's BUY fields. */
type PurchaseRow = {
  key: string;
  symbol: string;
  units: string;
  price: string;
  currency: string;
  fee: string;
  date: string;
  assetType: string;
  fxRate: string;
};

const emptyPurchaseRow = (): PurchaseRow => ({
  key: `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  symbol: "",
  units: "",
  price: "",
  currency: "CAD",
  fee: "",
  date: new Date().toISOString().slice(0, 10),
  assetType: "ETF",
  fxRate: "1",
});

const isValidPurchaseRow = (r: PurchaseRow) =>
  r.symbol.trim() !== "" && Number(r.units) > 0 && Number(r.price) > 0;

function RoomDrawCard({
  mortgage,
  heloc,
  room,
  tranches,
  openingDrawn,
  homeValue,
  onHomeValue,
  lastTranche,
  linkedAccountId,
  linkedAccountName,
  fxUsdCad,
  transactions,
  holdings,
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
  lastTranche: SmithTranche | null;
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  fxUsdCad: number;
  /** Ledger transactions (for reconstructing the last purchase set). */
  transactions: Transaction[];
  /** Ledger holdings (to resolve symbols for the repeat-last lookup). */
  holdings: Holding[];
  onDraw: (tranche: SmithTranche, drawnAmount: number) => void;
  onRefinance: (
    snapshot: { date: string; balance: number; rate: number; payment: number; propertyValue: number; paymentFrequency?: DebtPaymentFrequency },
    newTerms: { balance: number; rate: number; payment: number; paymentFrequency: DebtPaymentFrequency },
  ) => void;
  onUnlink: () => void;
}) {
  const [drawn, setDrawn] = useState(0);
  const [memo, setMemo] = useState("");
  const [showRefinance, setShowRefinance] = useState(false);
  // Purchase capture: mirrors the ledger's add-transaction fields so the draw
  // and the investment stay in sync in one step. One draw can fund several buys.
  const [recordPurchase, setRecordPurchase] = useState(true);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([emptyPurchaseRow()]);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const addTransactions = useAddTransactions();

  // "What it bought" is redundant once the ledger holds the purchases: the
  // free-text memo only appears in draw-only mode (no linked account, or the
  // purchase capture is unchecked).
  const showPurchaseCapture = linkedAccountId != null && recordPurchase;
  const drawOnlyMode = !showPurchaseCapture;

  const validPurchases = showPurchaseCapture ? purchases.filter(isValidPurchaseRow) : [];
  const purchaseTotalCad = validPurchases.reduce(
    (sum, r) =>
      sum + (Number(r.units) * Number(r.price) + (Number(r.fee) || 0)) * (Number(r.fxRate) || 1),
    0,
  );
  // Soft warning only: untraced cash is a CRA question, not a blocker.
  const purchaseMismatch =
    validPurchases.length > 0 &&
    drawn > 0 &&
    Math.abs(purchaseTotalCad - drawn) > Math.max(1, drawn * 0.01);

  const updateRow = (key: string, patch: Partial<PurchaseRow>) =>
    setPurchases(purchases.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const repeatLast = () => {
    if (!lastTranche) return;
    const ids = lastTranche.ledgerTransactionIds ?? [];
    if (ids.length > 0 && showPurchaseCapture) {
      // Rebuild the full purchase set from the linked ledger transactions.
      const holdingById = new Map(holdings.map((h) => [h.id, h]));
      const rows: PurchaseRow[] = [];
      for (const id of ids) {
        const t = transactions.find((x) => x.id === id);
        if (!t || t.transaction_type !== "BUY") continue;
        const h = t.holding_id ? holdingById.get(t.holding_id) : undefined;
        rows.push({
          key: `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${rows.length}`,
          symbol: h?.symbol ?? "",
          units: String(t.units),
          price: String(t.price_per_unit),
          currency: t.currency,
          fee: String(t.fee ?? 0),
          date: t.transaction_date,
          assetType: h?.asset_type ?? "ETF",
          fxRate: String(t.fx_rate ?? 1),
        });
      }
      if (rows.length > 0) {
        setPurchases(rows);
        return;
      }
    }
    // Fallback for older tranches (or draw-only mode): restore the memo text.
    if (drawOnlyMode) setMemo(lastTranche.useOfFunds);
  };

  const record = async () => {
    if (drawn <= 0 || drawn > room.roomAvailable || recording) return;
    setDrawError(null);
    const today = new Date().toISOString().slice(0, 10);
    // Record the purchases in the linked ledger first: all BUYs in a single
    // call so they succeed or fail together. If anything fails, nothing is
    // recorded and the tracker and ledger can never drift apart.
    let ledgerTransactionIds: string[] = [];
    if (validPurchases.length > 0) {
      setRecording(true);
      try {
        const result = await addTransactions.mutateAsync({
          inputs: validPurchases.map((r) => ({
            accountId: linkedAccountId!,
            symbol: r.symbol.trim().toUpperCase(),
            name: null,
            assetType: r.assetType,
            transactionType: "BUY",
            units: Number(r.units),
            pricePerUnit: Number(r.price),
            amount: null,
            currency: r.currency,
            fxRate: Number(r.fxRate) || 1,
            fee: Number(r.fee) || 0,
            date: r.date || today,
          })),
        });
        if (result.failed.length > 0 || result.saved !== validPurchases.length) {
          throw new Error(
            result.failed[0]?.message ?? "Could not record all purchases in the ledger.",
          );
        }
        ledgerTransactionIds = result.ids;
      } catch (e) {
        setDrawError(e instanceof Error ? e.message : "Could not record the purchases in the ledger.");
        setRecording(false);
        return;
      }
      setRecording(false);
    }
    const useOfFunds =
      memo.trim() !== ""
        ? memo
        : validPurchases.length > 0
          ? validPurchases
              .map((r) => `${r.units.trim()} ${r.symbol.trim().toUpperCase()} @ $${r.price.trim()}`)
              .join(" + ")
          : "";
    const tranche: SmithTranche = {
      id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      facility: heloc.name || "HELOC",
      drawDate: today,
      principal: drawn,
      rate: heloc.rate,
      useOfFunds,
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
      ledgerTransactionIds,
      documents: "",
    };
    onDraw(tranche, drawn);
    setDrawn(0);
    setMemo("");
    setPurchases([emptyPurchaseRow()]);
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
            onClick={() => onUnlink()}
          >
            Unlink
          </Button>
        </div>
      </div>

      {showRefinance ? (
          <RefinanceForm
            mortgage={mortgage}
            onRefinance={(snapshot, newTerms) => {
              onRefinance(snapshot, newTerms);
              setShowRefinance(false);
            }}
          />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Home value</div>
          <div className="text-xl font-bold">{homeValue ? formatCad(homeValue) : "—"}</div>
          <div className="mt-1">
            <NumInput
              value={homeValue}
              onCommit={(n) => onHomeValue(Math.max(0, n) || null)}
            />
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
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950 p-3">
          <div className="text-xs text-muted-foreground">Available to draw</div>
          <div className="text-xl font-bold text-emerald-800 dark:text-emerald-300">{formatCad(room.roomAvailable)}</div>
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
            <p className="text-sm font-medium">{Math.round(heloc.rate * 10000) / 100}%</p>
            <p className="text-[11px] text-muted-foreground">From HELOC — update it on the Debts tab</p>
          </div>
          {drawOnlyMode ? (
            <div className="space-y-1">
              <Label className="text-xs">Memo</Label>
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. bridging until the next buy"
              />
            </div>
          ) : null}
        </div>
        {drawn > room.roomAvailable ? (
          <p className="text-xs text-red-700 dark:text-red-400">
            More than the available room — lower the amount or wait for more principal payments.
          </p>
        ) : null}
        {linkedAccountId ? (
          <div className="space-y-2 rounded-lg border p-2.5">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={recordPurchase}
                onChange={(e) => setRecordPurchase(e.target.checked)}
              />
              Record the purchase(s) in {linkedAccountName ?? "the linked account"}
            </label>
            {showPurchaseCapture ? (
              <div className="space-y-2">
                {purchases.map((row, idx) => (
                  <div key={row.key} className="rounded-lg border p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Purchase {idx + 1}
                      </span>
                      {purchases.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs underline text-muted-foreground"
                          onClick={() =>
                            setPurchases(purchases.filter((r) => r.key !== row.key))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5">
                      <div className="space-y-1">
                        <Label className="text-xs">Symbol</Label>
                        <Input
                          value={row.symbol}
                          onChange={(e) => updateRow(row.key, { symbol: e.target.value.toUpperCase() })}
                          placeholder="XIU"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Units</Label>
                        <Input
                          type="number"
                          step="any"
                          value={row.units}
                          onChange={(e) => updateRow(row.key, { units: e.target.value })}
                          placeholder="100"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Price per unit</Label>
                        <Input
                          type="number"
                          step="any"
                          value={row.price}
                          onChange={(e) => updateRow(row.key, { price: e.target.value })}
                          placeholder="32.50"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Currency</Label>
                        <Select
                          value={row.currency}
                          onValueChange={(v) =>
                            updateRow(row.key, {
                              currency: v,
                              fxRate: v === "USD" ? String(fxUsdCad) : "1",
                            })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CAD">CAD</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Asset type</Label>
                        <Select
                          value={row.assetType}
                          onValueChange={(v) => updateRow(row.key, { assetType: v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Stock">Stock</SelectItem>
                            <SelectItem value="ETF">ETF</SelectItem>
                            <SelectItem value="Cash">Cash</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">FX rate</Label>
                        <Input
                          type="number"
                          step="any"
                          value={row.fxRate}
                          onChange={(e) => updateRow(row.key, { fxRate: e.target.value })}
                          placeholder="1"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fee ($)</Label>
                        <Input
                          type="number"
                          step="any"
                          value={row.fee}
                          onChange={(e) => updateRow(row.key, { fee: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Date</Label>
                        <Input
                          type="date"
                          value={row.date}
                          onChange={(e) => updateRow(row.key, { date: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Cost</Label>
                        <p className="text-sm font-medium">
                          {Number(row.units) > 0 && Number(row.price) > 0
                            ? formatCad(
                                (Number(row.units) * Number(row.price) + (Number(row.fee) || 0)) *
                                  (Number(row.fxRate) || 1),
                              )
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPurchases([...purchases, emptyPurchaseRow()])}
                  >
                    Add another purchase
                  </Button>
                  {validPurchases.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Purchases total {formatCad(purchaseTotalCad)} vs {formatCad(drawn)} drawn
                    </p>
                  ) : null}
                </div>
                {purchaseMismatch ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    ⚠ Purchases total {formatCad(purchaseTotalCad)} but the draw is{" "}
                    {formatCad(drawn)} — untraced cash is a CRA question. You can still
                    record; the difference stays visible on the tranche.
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Saved as BUY(s) with the dates above. Uncheck to record the draw only —
              you can add the investment later from the Accounts tab.
            </p>
          </div>
        ) : null}
        {drawError ? <p className="text-xs text-red-700 dark:text-red-400">{drawError}</p> : null}
        <Button size="sm" onClick={() => void record()} disabled={drawn <= 0 || drawn > room.roomAvailable || recording}>
          {recording ? "Recording…" : "Record draw"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          The HELOC balance on your Debts tab updates automatically.
          {validPurchases.length > 0
            ? ` The BUY${validPurchases.length === 1 ? "" : "s"} appear${validPurchases.length === 1 ? "s" : ""} in ${linkedAccountName ?? "the linked account"}'s ledger.`
            : ""}
        </p>
        </div>
    </div>
  );
}

function RefinanceForm({
  mortgage,
  onRefinance,
}: {
  mortgage: DebtInput;
  onRefinance: (
    snapshot: { date: string; balance: number; rate: number; payment: number; propertyValue: number; paymentFrequency?: DebtPaymentFrequency },
    newTerms: { balance: number; rate: number; payment: number; paymentFrequency: DebtPaymentFrequency },
  ) => void;
}) {
  const [balance, setBalance] = useState(mortgage.balance);
  const [ratePct, setRatePct] = useState(mortgage.rate * 100);
  const [payment, setPayment] = useState(mortgage.payment);
  const [frequency, setFrequency] = useState<DebtPaymentFrequency>(
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
              <SelectItem value="accelerated-weekly">Accelerated weekly</SelectItem>
              <SelectItem value="biweekly">Biweekly</SelectItem>
              <SelectItem value="accelerated-biweekly">Accelerated biweekly</SelectItem>
              <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
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

