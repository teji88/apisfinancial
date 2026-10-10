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
import {
  useProfile,
  useUpdateProfile,
  type PropertyInput,
  type DebtInput,
} from "@/lib/profile";
import {
  analyzeProperty,
  rollupProperties,
} from "@/lib/retirement/optimization/RealEstate";

export const Route = createFileRoute("/_authenticated/properties")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Investment Properties — Apis Financial" },
      {
        name: "description",
        content:
          "Track investment properties: rental income, operating expenses, cash flow, cap rate, and equity feeding your net worth.",
      },
    ],
  }),
  component: PropertiesPage,
});

function newProperty(): PropertyInput {
  return {
    id: `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: "",
    currentValue: 0,
    mortgageId: "",
    mortgageBalance: 0,
    mortgagePayment: 0,
    monthlyRent: 0,
    otherIncome: 0,
    vacancyPct: 5,
    cashInvested: 0,
    expenses: {
      propertyTax: 0,
      insurance: 0,
      maintenance: 0,
      managementPct: 0,
      condoFees: 0,
      utilities: 0,
      other: 0,
    },
  };
}

function mortgageFor(p: PropertyInput, debts: DebtInput[]): { balance: number; payment: number } {
  const linked = debts.find((d) => d.id === p.mortgageId);
  if (linked) return { balance: linked.balance, payment: linked.payment };
  return { balance: p.mortgageBalance, payment: p.mortgagePayment };
}

function PropertiesPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  const p = profile ?? null;
  const properties = p?.properties ?? [];
  const debts = p?.debts ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);

  const save = (next: PropertyInput[]) => updateProfile.mutate({ properties: next });
  const update = (id: string, patch: Partial<PropertyInput>) =>
    save(properties.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const rollup = useMemo(
    () =>
      rollupProperties(
        properties.map((x) => {
          const m = mortgageFor(x, debts);
          return {
            name: x.name,
            currentValue: x.currentValue,
            mortgageBalance: m.balance,
            mortgagePayment: m.payment,
            monthlyRent: x.monthlyRent,
            otherIncome: x.otherIncome,
            vacancyPct: x.vacancyPct,
            expenses: x.expenses,
            cashInvested: x.cashInvested,
          };
        }),
      ),
    [properties, debts],
  );

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
        <h1 className="text-2xl font-bold">Investment Properties</h1>
        <p className="text-sm text-muted-foreground">
          Cash flow is the hero number. Equity feeds your net worth automatically.
          Pre-tax — CCA and sale modeling are separate tax modules.
        </p>
      </div>

      {/* Portfolio rollup */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Cash flow / month</div>
          <div className={`text-2xl font-bold ${rollup.totalCashFlowMonthly >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {formatCad(rollup.totalCashFlowMonthly)}
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Total value</div>
          <div className="text-2xl font-bold">{formatCad(rollup.totalValue)}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Total mortgages</div>
          <div className="text-2xl font-bold">{formatCad(rollup.totalMortgage)}</div>
        </div>
        <div className="rounded-xl border bg-emerald-50 p-4">
          <div className="text-xs text-muted-foreground">Total equity → net worth</div>
          <div className="text-2xl font-bold text-emerald-800">{formatCad(rollup.totalEquity)}</div>
        </div>
      </div>

      {/* Property cards */}
      <div className="space-y-3">
        {properties.map((prop) => {
          const m = mortgageFor(prop, debts);
          const r = analyzeProperty({
            name: prop.name,
            currentValue: prop.currentValue,
            mortgageBalance: m.balance,
            mortgagePayment: m.payment,
            monthlyRent: prop.monthlyRent,
            otherIncome: prop.otherIncome,
            vacancyPct: prop.vacancyPct,
            expenses: prop.expenses,
            cashInvested: prop.cashInvested,
          });
          const isOpen = expanded === prop.id;
          return (
            <div key={prop.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-base font-semibold">{prop.name || "Unnamed property"}</span>
                  <span className={`ml-3 text-sm font-medium ${r.cashFlowMonthly >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatCad(r.cashFlowMonthly)}/mo
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground"
                    onClick={() => setExpanded(isOpen ? null : prop.id)}
                  >
                    {isOpen ? "Collapse" : "Details"}
                  </button>
                  <button
                    type="button"
                    className="text-xs underline text-muted-foreground"
                    onClick={() => save(properties.filter((x) => x.id !== prop.id))}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
                <div className="rounded-lg border p-2">
                  <dt className="text-[11px] text-muted-foreground">Cap rate</dt>
                  <dd className="font-medium">{r.capRatePct.toFixed(2)}%</dd>
                </div>
                <div className="rounded-lg border p-2">
                  <dt className="text-[11px] text-muted-foreground">Cash-on-cash</dt>
                  <dd className="font-medium">{r.cashOnCashPct.toFixed(2)}%</dd>
                </div>
                <div className="rounded-lg border p-2">
                  <dt className="text-[11px] text-muted-foreground">Equity</dt>
                  <dd className="font-medium">{formatCad(r.equity)}</dd>
                </div>
                <div className="rounded-lg border p-2">
                  <dt className="text-[11px] text-muted-foreground">NOI / yr</dt>
                  <dd className="font-medium">{formatCad(r.noi)}</dd>
                </div>
              </dl>

              {isOpen ? (
                <PropertyEditor
                  prop={prop}
                  debts={debts}
                  result={r}
                  onChange={(patch) => update(prop.id, patch)}
                />
              ) : null}
            </div>
          );
        })}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const next = newProperty();
            save([...properties, next]);
            setExpanded(next.id);
          }}
        >
          Add property
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Equity flows into the <Link to="/retirement" className="underline">retirement planner's</Link> net
        worth as illiquid assets. Rental income and CCA modeling for the planner are separate modules.
      </p>
    </div>
  );
}

function PropertyEditor({
  prop,
  debts,
  result,
  onChange,
}: {
  prop: PropertyInput;
  debts: DebtInput[];
  result: ReturnType<typeof analyzeProperty>;
  onChange: (patch: Partial<PropertyInput>) => void;
}) {
  const setExp = (k: keyof PropertyInput["expenses"], v: number) =>
    onChange({ expenses: { ...prop.expenses, [k]: Math.max(0, v) } });
  const mortgages = debts.filter((d) => d.kind === "mortgage" || d.kind === "loan");

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Property name</Label>
          <Input value={prop.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Calgary condo" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Current value ($)</Label>
          <NumInput value={prop.currentValue} onCommit={(n) => onChange({ currentValue: Math.max(0, n) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Monthly rent ($)</Label>
          <NumInput value={prop.monthlyRent} onCommit={(n) => onChange({ monthlyRent: Math.max(0, n) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Other income ($/mo)</Label>
          <NumInput value={prop.otherIncome} onCommit={(n) => onChange({ otherIncome: Math.max(0, n) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vacancy allowance (%)</Label>
          <NumInput value={prop.vacancyPct} onCommit={(n) => onChange({ vacancyPct: Math.max(0, n) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cash invested ($)</Label>
          <NumInput value={prop.cashInvested} onCommit={(n) => onChange({ cashInvested: Math.max(0, n) })} />
          <p className="text-[11px] text-muted-foreground">Down payment + closing</p>
        </div>
        <div className="space-y-1 lg:col-span-2">
          <Label className="text-xs">Mortgage</Label>
          <Select
            value={prop.mortgageId || "manual"}
            onValueChange={(v) => onChange({ mortgageId: v === "manual" ? "" : v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual entry</SelectItem>
              {mortgages.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name || "Mortgage"} — {formatCad(d.balance)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Linked mortgages stay in sync with your debts list.
          </p>
        </div>
        {prop.mortgageId === "" ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Mortgage balance ($)</Label>
              <NumInput value={prop.mortgageBalance} onCommit={(n) => onChange({ mortgageBalance: Math.max(0, n) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mortgage payment ($/mo)</Label>
              <NumInput value={prop.mortgagePayment} onCommit={(n) => onChange({ mortgagePayment: Math.max(0, n) })} />
            </div>
          </>
        ) : null}
      </div>

      <div>
        <h4 className="text-sm font-medium mb-2">Operating expenses</h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Property tax ($/yr)</Label>
            <NumInput value={prop.expenses.propertyTax} onCommit={(n) => setExp("propertyTax", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Insurance ($/yr)</Label>
            <NumInput value={prop.expenses.insurance} onCommit={(n) => setExp("insurance", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Maintenance ($/yr)</Label>
            <NumInput value={prop.expenses.maintenance} onCommit={(n) => setExp("maintenance", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Management (% of income)</Label>
            <NumInput value={prop.expenses.managementPct} onCommit={(n) => setExp("managementPct", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Condo fees ($/yr)</Label>
            <NumInput value={prop.expenses.condoFees} onCommit={(n) => setExp("condoFees", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Utilities ($/yr)</Label>
            <NumInput value={prop.expenses.utilities} onCommit={(n) => setExp("utilities", n)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Other ($/yr)</Label>
            <NumInput value={prop.expenses.other} onCommit={(n) => setExp("other", n)} />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-2">P&amp;L breakdown</h4>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Effective rental income</dt>
            <dd>{formatCad(result.effectiveIncome)}</dd>
          </div>
          {result.expenseBreakdown.map((x) => (
            <div key={x.label} className="flex justify-between">
              <dt className="text-muted-foreground">− {x.label}</dt>
              <dd>({formatCad(x.annual)})</dd>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium">
            <dt>NOI</dt>
            <dd>{formatCad(result.noi)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">− Mortgage</dt>
            <dd>({formatCad(result.annualMortgage)})</dd>
          </div>
          <div className={`flex justify-between border-t pt-1 font-bold ${result.cashFlowAnnual >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            <dt>Cash flow / yr</dt>
            <dd>{formatCad(result.cashFlowAnnual)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
