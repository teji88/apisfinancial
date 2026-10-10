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
import { formatCad } from "@/lib/finance";
import type { ProvinceCode } from "@/lib/tax";
import {
  useProfile,
  useUpdateProfile,
  type SmithTranche,
} from "@/lib/profile";
import { marginalRateAt } from "@/lib/retirement/marginalRate";
import { computeSmithSavings } from "@/lib/retirement/optimization/SmithSavings";
import { assessSmithLedger } from "@/lib/retirement/optimization/SmithTracker";
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
      }),
    [mortgage, helocRate, marginalRate, interestPaidYtd, settings.priorInterestClaimed, deductibleOutstanding],
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
      </div>

      {/* Monthly check-in */}
      <CheckInCard
        heloc={heloc}
        debts={debts}
        helocDebtId={settings.helocDebtId}
        onHelocChange={(id) => save({ smith_settings: { ...settings, helocDebtId: id } })}
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
      </div>

      <p className="text-xs text-muted-foreground">
        A summary also appears on the <Link to="/retirement" className="underline">retirement planner</Link>.
      </p>
    </div>
  );
}

function CheckInCard({
  heloc,
  debts,
  helocDebtId,
  onHelocChange,
  onDraw,
}: {
  heloc: { id: string; name: string; rate: number; balance: number } | null;
  debts: Array<{ id: string; name: string; kind: string }>;
  helocDebtId: string;
  onHelocChange: (id: string) => void;
  onDraw: (tranche: SmithTranche, drawnAmount: number) => void;
}) {
  const [principalPaid, setPrincipalPaid] = useState(0);
  const [drawn, setDrawn] = useState(0);
  const [bought, setBought] = useState("");
  const [ratePct, setRatePct] = useState(heloc && heloc.rate > 0 ? heloc.rate * 100 : 5.5);

  const helocDebts = debts.filter((d) => d.kind === "heloc");

  const record = () => {
    if (drawn <= 0) return;
    const tranche: SmithTranche = {
      id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      facility: heloc?.name || "HELOC",
      drawDate: new Date().toISOString().slice(0, 10),
      principal: drawn,
      rate: Math.max(0, ratePct) / 100,
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
      ) : (
        <p className="text-xs text-amber-800">
          Add a HELOC to your <Link to="/retirement" className="underline">debts</Link> first,
          then draws will update its balance automatically.
        </p>
      )}
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
