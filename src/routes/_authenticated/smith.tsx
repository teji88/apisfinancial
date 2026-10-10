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
import { formatCad } from "@/lib/finance";
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
import { SmithTrackerCard } from "@/components/retirement/DebtNetWorth";

export const Route = createFileRoute("/_authenticated/smith")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Smith Manoeuvre — Apis Financial" },
      {
        name: "description",
        content:
          "Track your Smith Manoeuvre: monthly draws, per-tranche tax tracing, deductible interest for line 22100, and the tax savings you're building.",
      },
    ],
  }),
  component: SmithPage,
});

function SmithPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  const p = profile ?? null;
  const tranches = p?.smith_tranches ?? [];
  const debts = p?.debts ?? [];
  const settings = p?.smith_settings ?? { priorInterestClaimed: 0, helocDebtId: "" };

  const save = (patch: Parameters<typeof updateProfile.mutate>[0]) =>
    updateProfile.mutate(patch);

  const province = (p?.province as ProvinceCode) ?? "AB";
  const salary = p?.cpp_future_income ?? 0;
  const marginalRate = marginalRateAt(salary, province, p?.current_age ?? 40);

  const mortgage = debts.find((d) => d.kind === "mortgage") ?? null;
  const heloc =
    debts.find((d) => d.id === settings.helocDebtId) ??
    debts.find((d) => d.kind === "heloc") ??
    null;

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
      <div>
        <h1 className="text-2xl font-bold">Smith Manoeuvre</h1>
        <p className="text-sm text-muted-foreground">
          Every mortgage principal dollar, re-borrowed and invested. Track the draws,
          keep the tracing clean, and watch the tax savings compound.
        </p>
      </div>

      {/* Morale dashboard */}
      {tranches.length === 0 ? (
        <div className="rounded-xl border p-6 space-y-4">
          <h2 className="text-lg font-semibold">How the Smith Manoeuvre tracker works</h2>
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

      {/* Monthly check-in */}
      <CheckInCard
        heloc={heloc}
        debts={debts}
        helocDebtId={settings.helocDebtId}
        lastTranche={tranches.length > 0 ? tranches[tranches.length - 1] : null}
        onHelocChange={(id) => save({ smith_settings: { ...settings, helocDebtId: id } })}
        onCreateHeloc={(debt) => {
          save({
            debts: [...debts, debt],
            smith_settings: { ...settings, helocDebtId: debt.id },
          });
        }}
        onRateChange={(debtId, newRate) => {
          const today = new Date().toISOString().slice(0, 10);
          save({
            debts: debts.map((d) =>
              d.id === debtId
                ? {
                    ...d,
                    rate: newRate,
                    rateHistory: [...(d.rateHistory ?? []), { date: today, rate: newRate }],
                  }
                : d,
            ),
          });
        }}
        onDraw={(tranche, drawnAmount) => {
          const next = [...tranches, tranche];
          const patch: Parameters<typeof updateProfile.mutate>[0] = { smith_tranches: next };
          if (heloc) {
            patch.debts = debts.map((d) =>
              d.id === heloc.id ? { ...d, balance: d.balance + drawnAmount } : d,
            );
          }
          save(patch);
        }}
      />

      {/* Prior interest */}
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

function SmithPerformanceCard({
  tranches,
  holdings,
  drawn,
}: {
  tranches: SmithTranche[];
  holdings: Array<{ id: string; name: string; value: number }>;
  drawn: number;
}) {
  const linkedIds = new Set(
    tranches.map((t) => t.holdingId).filter((id): id is string => !!id),
  );
  const linkedValue = holdings
    .filter((h) => linkedIds.has(h.id))
    .reduce((s, h) => s + Math.max(0, h.value), 0);
  const gain = linkedValue - drawn;
  if (linkedIds.size === 0) {
    return (
      <div className="rounded-xl border p-4">
        <div className="text-xs text-muted-foreground">Borrowed money performance</div>
        <div className="text-sm text-muted-foreground mt-1">
          Link tranches to investment holdings to see how the borrowed money is doing.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs text-muted-foreground">Borrowed money performance</div>
      <div className="text-2xl font-bold">{formatCad(linkedValue)}</div>
      <div className={`text-[11px] font-medium ${gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
        {gain >= 0 ? "+" : ""}{formatCad(gain)} vs {formatCad(drawn)} drawn
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">
        Current value of linked holdings against the deductible balance.
      </div>
    </div>
  );
}

function CheckInCard({
  heloc,
  debts,
  helocDebtId,
  lastTranche,
  onHelocChange,
  onCreateHeloc,
  onRateChange,
  onDraw,
}: {
  heloc: { id: string; name: string; rate: number; balance: number; rateHistory?: Array<{ date: string; rate: number }> } | null;
  debts: Array<{ id: string; name: string; kind: string }>;
  helocDebtId: string;
  lastTranche: SmithTranche | null;
  onHelocChange: (id: string) => void;
  onCreateHeloc: (debt: DebtInput) => void;
  onRateChange: (debtId: string, newRate: number) => void;
  onDraw: (tranche: SmithTranche, drawnAmount: number) => void;
}) {
  const [principalPaid, setPrincipalPaid] = useState(0);
  const [drawn, setDrawn] = useState(0);
  const [bought, setBought] = useState("");
  const [ratePct, setRatePct] = useState(heloc && heloc.rate > 0 ? heloc.rate * 100 : 5.5);
  const [showHelocForm, setShowHelocForm] = useState(false);
  const [helocName, setHelocName] = useState("");
  const [helocRatePct, setHelocRatePct] = useState(5.5);
  const [helocBalance, setHelocBalance] = useState(0);

  const helocDebts = debts.filter((d) => d.kind === "heloc");
  const rateChanged =
    heloc && Math.abs(ratePct / 100 - heloc.rate) > 0.0001 && drawn > 0;

  const repeatLast = () => {
    if (!lastTranche) return;
    setRatePct(Math.round(lastTranche.rate * 1000) / 10);
    setBought(lastTranche.useOfFunds);
  };

  const createHeloc = () => {
    const debt: DebtInput = {
      id: `d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: helocName.trim() || "HELOC",
      kind: "heloc",
      balance: Math.max(0, helocBalance),
      rate: Math.max(0, helocRatePct) / 100,
      payment: 0,
      deductible: true,
      rateHistory: [
        { date: new Date().toISOString().slice(0, 10), rate: Math.max(0, helocRatePct) / 100 },
      ],
    };
    onCreateHeloc(debt);
    setShowHelocForm(false);
    setHelocName("");
    setHelocBalance(0);
  };

  const record = () => {
    if (drawn <= 0) return;
    const newRate = Math.max(0, ratePct) / 100;
    if (heloc && Math.abs(newRate - heloc.rate) > 0.0001) {
      onRateChange(heloc.id, newRate);
    }
    const tranche: SmithTranche = {
      id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      facility: heloc?.name || "HELOC",
      drawDate: new Date().toISOString().slice(0, 10),
      principal: drawn,
      rate: newRate,
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
    setPrincipalPaid(0);
    setDrawn(0);
    setBought("");
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Monthly check-in</h3>
        <p className="text-sm text-muted-foreground">
          Paid principal → new room → draw → invest. Record the draw and the tranche
          ledger fills itself.
        </p>
      </div>
      {helocDebts.length > 0 ? (
        <div className="space-y-1">
          <Label className="text-xs">HELOC facility</Label>
          <Select value={helocDebtId || heloc?.id || ""} onValueChange={onHelocChange}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select HELOC" /></SelectTrigger>
            <SelectContent>
              {helocDebts.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name || "HELOC"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : showHelocForm ? (
        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="text-sm font-medium">Add your HELOC</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={helocName}
                onChange={(e) => setHelocName(e.target.value)}
                placeholder="e.g. Readvanceable HELOC"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate (%/yr)</Label>
              <NumInput value={helocRatePct} onCommit={(n) => setHelocRatePct(Math.max(0, n))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Current balance ($)</Label>
              <NumInput value={helocBalance} onCommit={(n) => setHelocBalance(Math.max(0, n))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={createHeloc}>Add HELOC</Button>
            <Button size="sm" variant="outline" onClick={() => setShowHelocForm(false)}>Cancel</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            It lands in your debts list automatically — draws will update its balance.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            No HELOC in your debts yet.
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowHelocForm(true)}>
            Add HELOC
          </Button>
        </div>
      )}
      {lastTranche ? (
        <Button size="sm" variant="outline" onClick={repeatLast}>
          Repeat last month
        </Button>
      ) : null}
      {heloc && heloc.rateHistory && heloc.rateHistory.length > 1 ? (
        <p className="text-[11px] text-muted-foreground">
          Rate history: {heloc.rateHistory.map((h) => `${h.date} → ${(h.rate * 100).toFixed(2)}%`).join(" · ")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Principal paid this month ($)</Label>
          <NumInput value={principalPaid} onCommit={(n) => setPrincipalPaid(Math.max(0, n))} />
          <p className="text-[11px] text-muted-foreground">Room created: {formatCad(principalPaid)}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Amount drawn ($)</Label>
          <NumInput value={drawn} onCommit={(n) => setDrawn(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rate (%/yr)</Label>
          <NumInput value={ratePct} onCommit={(n) => setRatePct(Math.max(0, n))} />
          {rateChanged ? (
            <p className="text-[11px] text-amber-800">
              Different from the HELOC's current rate — recording will update it.
            </p>
          ) : null}
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
      <Button size="sm" onClick={record} disabled={drawn <= 0}>
        Record draw
      </Button>
    </div>
  );
}
