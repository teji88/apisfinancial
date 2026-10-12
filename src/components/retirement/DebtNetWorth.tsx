import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCad } from "@/lib/finance";
import type { ProvinceCode } from "@/lib/tax";
import type {
  Profile,
  DebtInput,
  NetWorthInput,
  SmithTranche,
} from "@/lib/profile";
import { computeNetWorth } from "@/lib/retirement/optimization/NetWorth";
import {
  comparePayoffVsInvest,
  type PayoffVsInvestResult,
} from "@/lib/retirement/optimization/DebtComparator";
import {
  assessSmithLedger,
  CRA_FILING_DISCLAIMER,
  type SmithLedgerResult,
} from "@/lib/retirement/optimization/SmithTracker";
import { NumInput } from "@/routes/retirement";
import { marginalRateAt } from "@/lib/retirement/marginalRate";

const DEBT_KIND_LABELS: Record<DebtInput["kind"], string> = {
  mortgage: "Mortgage",
  heloc: "HELOC",
  loan: "Loan",
  credit_card: "Credit card",
  other: "Other",
};

const DEBT_OWNER_LABELS: Record<NonNullable<DebtInput["owner"]>, string> = {
  self: "Mine",
  partner: "Partner's",
  joint: "Joint",
};

function newDebt(): DebtInput {
  return {
    id: `d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: "",
    kind: "loan",
    balance: 0,
    rate: 0.05,
    payment: 0,
    deductible: false,
  };
}

export function DebtsForm({
  value,
  onChange,
}: {
  value: DebtInput[] | null;
  onChange: (v: DebtInput[]) => void;
}) {
  const debts = value ?? [];
  const update = (id: string, patch: Partial<DebtInput>) =>
    onChange(debts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="sm:col-span-2 rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Debts</span>
        <span className="text-xs text-muted-foreground">
          Shared by net worth, the payoff comparator, and the Smith tracker
        </span>
      </div>
      {debts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No debts entered.</p>
      ) : (
        <div className="space-y-2">
          {debts.map((d) => (
            <div key={d.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={d.name}
                  onChange={(e) => update(d.id, { name: e.target.value })}
                  placeholder="Debt name (e.g. Mortgage)"
                  className="flex-1"
                />
                <Button size="sm" variant="ghost" onClick={() => onChange(debts.filter((x) => x.id !== d.id))}>
                  Remove
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1">
                  <Label className="text-[11px]">Type</Label>
                  <Select value={d.kind} onValueChange={(v) => update(d.id, { kind: v as DebtInput["kind"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DEBT_KIND_LABELS) as DebtInput["kind"][]).map((k) => (
                        <SelectItem key={k} value={k}>{DEBT_KIND_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Owner</Label>
                  <Select
                    value={d.owner ?? "self"}
                    onValueChange={(v) => update(d.id, { owner: v as NonNullable<DebtInput["owner"]> })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DEBT_OWNER_LABELS) as NonNullable<DebtInput["owner"]>[]).map((k) => (
                        <SelectItem key={k} value={k}>{DEBT_OWNER_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Balance owed ($)</Label>
                  <NumInput value={d.balance} onCommit={(n) => update(d.id, { balance: Math.max(0, n) })} />
                  {d.kind === "heloc" ? (
                    <p className="text-[10px] text-muted-foreground">Amount drawn — not the available credit.</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Rate (%/yr)</Label>
                  <NumInput value={Math.round(d.rate * 10000) / 100} onCommit={(n) => update(d.id, { rate: Math.max(0, n) / 100 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Payment ($/mo)</Label>
                  <NumInput value={d.payment} onCommit={(n) => update(d.id, { payment: Math.max(0, n) })} />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch checked={d.deductible} onCheckedChange={(v) => update(d.id, { deductible: v })} />
                  <Label className="text-[11px]">Interest deductible</Label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" onClick={() => onChange([...debts, newDebt()])}>
        Add debt
      </Button>
    </div>
  );
}

export function NetWorthCard({
  profile,
  investments,
  onSave,
}: {
  profile: Profile;
  investments: number;
  onSave: (v: NetWorthInput) => void;
}) {
  const [homeValue, setHomeValue] = useState(profile.net_worth?.homeValue ?? 0);
  const [otherProperty, setOtherProperty] = useState(profile.net_worth?.otherPropertyValue ?? 0);
  const [cash, setCash] = useState(profile.net_worth?.cash ?? 0);

  // Investment properties: values join illiquid assets. Linked mortgages are already
  // in the debts list; manual (unlinked) mortgages are added to liabilities here.
  const linkedIds = new Set((profile.debts ?? []).map((d) => d.id));
  const propertyValue = (profile.properties ?? []).reduce(
    (s, prop) => s + Math.max(0, prop.currentValue),
    0,
  );
  const manualMortgages = (profile.properties ?? [])
    .filter((prop) => !prop.mortgageId || !linkedIds.has(prop.mortgageId))
    .map((prop) => ({ balance: prop.mortgageBalance }));

  const result = computeNetWorth({
    homeValue,
    otherPropertyValue: otherProperty + propertyValue,
    cash,
    investments,
    debts: [
      ...(profile.debts ?? []).map((d) => ({ balance: d.balance })),
      ...manualMortgages,
    ],
  });

  const save = () => onSave({ homeValue, otherPropertyValue: otherProperty, cash });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Net worth</h3>
        <p className="text-sm text-muted-foreground">
          Liquid = investments + cash. Property is illiquid. Debts come from your debt list.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Home value ($)</Label>
          <NumInput value={homeValue} onCommit={(n) => setHomeValue(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Other property ($)</Label>
          <NumInput value={otherProperty} onCommit={(n) => setOtherProperty(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cash / savings ($)</Label>
          <NumInput value={cash} onCommit={(n) => setCash(Math.max(0, n))} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={save}>Save</Button>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Liquid assets</dt>
          <dd className="font-medium">{formatCad(result.liquidAssets)}</dd>
          <dd className="text-[11px] text-muted-foreground">Investments {formatCad(investments)} + cash {formatCad(cash)}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Illiquid assets</dt>
          <dd className="font-medium">{formatCad(result.illiquidAssets)}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Total debts</dt>
          <dd className="font-medium">{formatCad(result.totalDebts)}</dd>
        </div>
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950 p-3">
          <dt className="text-xs text-muted-foreground">Net worth</dt>
          <dd className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{formatCad(result.netWorth)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function DebtComparatorCard({ profile }: { profile: Profile }) {
  const debts = profile.debts ?? [];
  const [debtId, setDebtId] = useState<string>(debts[0]?.id ?? "");
  const [extra, setExtra] = useState(200);
  const [expectedReturnPct, setExpectedReturnPct] = useState(6);
  const [result, setResult] = useState<PayoffVsInvestResult | null>(null);

  const debt = debts.find((d) => d.id === debtId) ?? null;
  const province = (profile.province as ProvinceCode) ?? "AB";
  const salary = profile.cpp_future_income ?? 0;
  const marginalRate = marginalRateAt(salary, province, profile.current_age ?? 40);

  useEffect(() => {
    setResult(null);
  }, [debtId, extra, expectedReturnPct]);

  const run = () => {
    if (!debt) return;
    const ownerShare = (debt.owner ?? "self") === "joint" ? 0.5 : 1;
    setResult(
      comparePayoffVsInvest({
        balance: debt.balance * ownerShare,
        annualRate: debt.rate,
        monthlyPayment: debt.payment * ownerShare,
        extraMonthly: extra,
        expectedReturn: expectedReturnPct / 100,
        marginalRate,
        interestDeductible: debt.deductible,
      }),
    );
  };

  if (debts.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="text-base font-semibold">Debt payoff vs invest</h3>
        <p className="text-sm text-muted-foreground">
          Add a debt in Your details first, then compare putting extra cash toward it versus investing.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Debt payoff vs invest</h3>
        <p className="text-sm text-muted-foreground">
          Should an extra monthly amount kill debt or go to investments? The payoff saving is
          guaranteed; the investment outcome is expected, not promised.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Debt</Label>
          <Select value={debtId} onValueChange={setDebtId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {debts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name || DEBT_KIND_LABELS[d.kind]} — {formatCad(d.balance)}
                  {(d.owner ?? "self") !== "self" ? ` · ${DEBT_OWNER_LABELS[d.owner ?? "self"]}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Extra ($/mo)</Label>
          <NumInput value={extra} onCommit={(n) => setExtra(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Expected return (%/yr)</Label>
          <NumInput value={expectedReturnPct} onCommit={(n) => setExpectedReturnPct(Math.max(0, n))} />
        </div>
      </div>
      <div>
        <Button size="sm" onClick={run} disabled={!debt}>Compare</Button>
        {debt && (debt.owner ?? "self") === "joint" ? (
          <p className="text-[11px] text-muted-foreground mt-1">
            Joint debt — analysis uses your 50% share ({formatCad(debt.balance / 2)} of {formatCad(debt.balance)}).
          </p>
        ) : null}
        {debt && (debt.owner ?? "self") === "partner" ? (
          <p className="text-[11px] text-muted-foreground mt-1">
            This is your partner's debt — the comparison uses the full balance.
          </p>
        ) : null}
      </div>
      {result && debt ? (
        <div className="space-y-3">
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">
              {result.netAdvantageInvesting >= 0 ? "Investing ahead on expected value by" : "Payoff ahead by"}
            </div>
            <div className={`text-2xl font-bold ${result.netAdvantageInvesting >= 0 ? "text-sky-800 dark:text-sky-300" : "text-emerald-800 dark:text-emerald-300"}`}>
              {formatCad(Math.abs(result.netAdvantageInvesting))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              over {result.baseMonths > 0 ? `${result.baseMonths} months` : "the horizon"}
            </p>
          </div>
          <dl className="grid gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Interest saved</dt>
              <dd className="font-medium">{formatCad(result.interestSavedAfterTax)}</dd>
              <dd className="text-[11px] text-muted-foreground">
                {debt.deductible ? "after-tax" : "no deduction"} · {result.monthsSaved} months shaved
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Debt-free</dt>
              <dd className="font-medium">
                {result.acceleratedMonths > 0 ? `${result.acceleratedMonths} mo` : "—"}
              </dd>
              <dd className="text-[11px] text-muted-foreground">vs {result.baseMonths > 0 ? `${result.baseMonths} mo` : "—"} minimums only</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">If invested instead</dt>
              <dd className="font-medium">{formatCad(result.investFutureValue)}</dd>
              <dd className="text-[11px] text-muted-foreground">expected, pre-tax</dd>
            </div>
          </dl>
          {result.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {result.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}

function newSmithTranche(): SmithTranche {
  return {
    id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    facility: "",
    drawDate: new Date().toISOString().slice(0, 10),
    principal: 0,
    rate: 0.055,
    useOfFunds: "",
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
}

type Distribution = { date: string; amount: number; destination: "mortgage" | "reinvested" | "personal" };

function DistributionEditor({
  distributions,
  onChange,
}: {
  distributions: Distribution[];
  onChange: (d: Distribution[]) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [dest, setDest] = useState<Distribution["destination"]>("mortgage");
  const total = distributions.reduce((s, d) => s + Math.max(0, d.amount), 0);
  return (
    <div className="space-y-2 rounded-lg border p-2">
      {distributions.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {distributions.map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span>
                {d.date} — {formatCad(d.amount)}{" "}
                <span className="text-muted-foreground">
                  ({d.destination === "mortgage" ? "to mortgage" : d.destination})
                </span>
              </span>
              <button
                type="button"
                className="underline text-muted-foreground"
                onClick={() => onChange(distributions.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">None recorded yet.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Amount ($)</Label>
          <NumInput value={amount} onCommit={(n) => setAmount(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Went to</Label>
          <Select value={dest} onValueChange={(v) => setDest(v as Distribution["destination"])}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mortgage">Mortgage paydown</SelectItem>
              <SelectItem value="reinvested">Reinvested</SelectItem>
              <SelectItem value="personal">Spent personally</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (amount <= 0) return;
            onChange([
              ...distributions,
              { date: new Date().toISOString().slice(0, 10), amount, destination: dest },
            ]);
            setAmount(0);
          }}
        >
          Add
        </Button>
      </div>
      {total > 0 ? (
        <p className="text-xs text-muted-foreground">Total: {formatCad(total)}</p>
      ) : null}
    </div>
  );
}

export function SmithTrackerCard({
  profile,
  onSave,
  locked = false,
  onLocked,
}: {
  profile: Profile;
  onSave: (t: SmithTranche[]) => void;
  /** When true, tranche data renders read-only; edit actions open the upgrade prompt. */
  locked?: boolean;
  onLocked?: () => void;
}) {
  const [tranches, setTranches] = useState<SmithTranche[]>(profile.smith_tranches ?? []);
  const [result, setResult] = useState<SmithLedgerResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (profile.smith_tranches) setTranches(profile.smith_tranches);
  }, [profile.smith_tranches]);

  const update = (id: string, patch: Partial<SmithTranche>) => {
    setTranches(tranches.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setResult(null);
  };

  const analyze = () => {
    onSave(tranches);
    setResult(assessSmithLedger(tranches));
  };

  const assessmentFor = (id: string) => result?.tranches.find((a) => a.trancheId === id);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">HELOC Investing tracker</h3>
        <p className="text-sm text-muted-foreground">
          Each re-borrow draw is a separate tranche. Deductibility turns on the current use of
          the money — track every tranche so the interest stays defensible.
        </p>
      </div>

      <div className="space-y-2">
        {tranches.map((t) => {
          const a = assessmentFor(t.id);
          const isOpen = expanded === t.id;
          return (
            <div key={t.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {a ? (
                    <span
                      className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${
                        a.health === "good"
                          ? "bg-emerald-600"
                          : a.health === "warning"
                            ? "bg-amber-500"
                            : "bg-red-600"
                      }`}
                      title={
                        a.health === "good"
                          ? "Clean — interest deductible, no tracing issues"
                          : a.health === "warning"
                            ? "Deductible but has tracing risks — review warnings"
                            : "Not deductible — interest cannot be claimed"
                      }
                    />
                  ) : null}
                  {t.facility || "Tranche"} — {formatCad(t.principal)}
                  {a ? (
                    <span className={`ml-2 text-xs font-normal ${a.deductible ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                      {a.deductible ? "✓ deductible" : "✗ not deductible"}
                    </span>
                  ) : null}
                </span>
                <div className="flex gap-1">
                  {locked ? (
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground"
                      onClick={onLocked}
                      title="Pro feature — click to upgrade"
                    >
                      🔒 Edit
                    </button>
                  ) : (
                    <>
                      <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setExpanded(isOpen ? null : t.id)}>
                        {isOpen ? "Collapse" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className="text-xs underline text-muted-foreground"
                        onClick={() => {
                          setTranches(tranches.filter((x) => x.id !== t.id));
                          setResult(null);
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isOpen ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Facility (HELOC name)</Label>
                    <Input value={t.facility} onChange={(e) => update(t.id, { facility: e.target.value })} placeholder="e.g. Readvanceable HELOC" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Draw date</Label>
                    <Input type="date" value={t.drawDate} onChange={(e) => update(t.id, { drawDate: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Principal ($)</Label>
                    <NumInput value={t.principal} onCommit={(n) => update(t.id, { principal: Math.max(0, n) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Rate (%/yr)</Label>
                    <NumInput value={Math.round(t.rate * 10000) / 100} onCommit={(n) => update(t.id, { rate: Math.max(0, n) / 100 })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">Where the money went</Label>
                    <Input value={t.useOfFunds} onChange={(e) => update(t.id, { useOfFunds: e.target.value })} placeholder="e.g. Non-registered brokerage — XIU" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">Linked investment holding</Label>
                    <Select
                      value={t.holdingId || "none"}
                      onValueChange={(v) => update(t.id, { holdingId: v === "none" ? null : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not linked</SelectItem>
                        {(profile.asset_holdings ?? []).map((h) => (
                          <SelectItem key={h.id} value={h.id}>
                            {h.name || "Holding"} — {formatCad(h.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Link the holding this draw bought to track how the borrowed money is doing.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={t.eligible} onCheckedChange={(v) => update(t.id, { eligible: v })} />
                    <Label className="text-[11px]">Income-earning use (eligible)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={t.commingled} onCheckedChange={(v) => update(t.id, { commingled: v })} />
                    <Label className="text-[11px]">Commingled with other cash</Label>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">Purpose evidence at acquisition</Label>
                    <Input value={t.purposeEvidence} onChange={(e) => update(t.id, { purposeEvidence: e.target.value })} placeholder="e.g. Pays quarterly distributions" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Interest paid YTD ($)</Label>
                    <NumInput value={t.interestPaidYtd} onCommit={(n) => update(t.id, { interestPaidYtd: Math.max(0, n) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Repayments YTD ($, total)</Label>
                    <NumInput
                      value={t.repayments.reduce((s, r) => s + r.amount, 0)}
                      onCommit={(n) =>
                        update(t.id, {
                          repayments: n > 0 ? [{ date: new Date().toISOString().slice(0, 10), amount: n }] : [],
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={t.personalUse} onCheckedChange={(v) => update(t.id, { personalUse: v, personalUseDate: v ? t.personalUseDate ?? new Date().toISOString().slice(0, 10) : null })} />
                    <Label className="text-[11px]">Diverted to personal use</Label>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Source documents</Label>
                    <Input value={t.documents} onChange={(e) => update(t.id, { documents: e.target.value })} placeholder="e.g. HELOC stmt; trade confirm" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">Distributions received</Label>
                    <DistributionEditor
                      distributions={t.distributions ?? []}
                      onChange={(dists) => update(t.id, { distributions: dists })}
                    />
                  </div>
                </div>
              ) : null}
              {a && a.warnings.length > 0 ? (
                <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
                  {a.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        {locked ? (
          <Button size="sm" variant="outline" onClick={onLocked} title="Pro feature — click to upgrade">
            🔒 Add tranche
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setTranches([...tranches, newSmithTranche()])}>
            Add tranche
          </Button>
        )}
      </div>

      <div>
        <Button size="sm" onClick={analyze} disabled={tranches.length === 0}>
          Assess deductibility
        </Button>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950 p-4">
            <div className="text-xs text-muted-foreground">Total deductible interest, year-to-date (T1 line 22100)</div>
            <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-300">{formatCad(result.totalDeductibleInterestYtd)}</div>
          </div>
          {result.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {result.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
          <p className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 text-xs font-medium text-amber-900 dark:text-amber-100">
            {CRA_FILING_DISCLAIMER}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Compact HELOC investing summary for the retirement planner; full tracking lives on the HELOC Investing tab. */
export function SmithSummaryCard({ profile }: { profile: Profile }) {
  const tranches = profile.smith_tranches ?? [];
  if (tranches.length === 0) return null;
  const result = assessSmithLedger(tranches);
  const outstanding = result.tranches.reduce((s, t) => s + t.outstanding, 0);
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">HELOC Investing</h3>
        <a href="/debts?tab=heloc" className="text-xs underline text-muted-foreground">
          Open tracker →
        </a>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-[11px] text-muted-foreground">Invested</dt>
          <dd className="font-medium">{formatCad(outstanding)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Deductible interest YTD</dt>
          <dd className="font-medium">{formatCad(result.totalDeductibleInterestYtd)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Tranches</dt>
          <dd className="font-medium">{result.tranches.length}</dd>
        </div>
      </dl>
    </div>
  );
}
