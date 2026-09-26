import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, FileText, Settings2, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCad, summariseAccount } from "@/lib/finance";
import { usePortfolio } from "@/lib/portfolio";
import { buildRetirementOverview, createDefaultRetirementScenario, retirementStore, type RetirementScenario } from "@/lib/retirement";

export const Route = createFileRoute("/_authenticated/retirement")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Retirement — Apis Financial" },
      { name: "description", content: "Canadian retirement planning, simulation and strategy analysis." },
    ],
  }),
  component: RetirementPage,
});

type Section = "overview" | "plan" | "scenarios" | "analysis" | "reports";

function RetirementPage() {
  const { accounts, holdings, transactions, quotes, fxUsdCad, loading } = usePortfolio();
  const [section, setSection] = useState<Section>("overview");
  const [scenario, setScenario] = useState<RetirementScenario | null>(null);
  const [saved, setSaved] = useState(false);

  const portfolio = useMemo(() => {
    const byType: Record<string, number> = {};
    let total = 0;
    for (const account of accounts) {
      const summary = summariseAccount(
        account,
        transactions.filter((t) => t.account_id === account.id),
        holdings.filter((h) => h.account_id === account.id),
        quotes,
        fxUsdCad,
      );
      const value = summary.marketValue + Math.max(0, summary.cash);
      byType[account.account_type] = (byType[account.account_type] ?? 0) + value;
      total += value;
    }
    return { total, byType };
  }, [accounts, holdings, transactions, quotes, fxUsdCad]);

  useEffect(() => {
    let cancelled = false;
    retirementStore.listScenarios().then((items) => {
      if (!cancelled && items[0]) setScenario(items[0]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activeScenario = scenario ?? createDefaultRetirementScenario();
  const overview = buildRetirementOverview(null);

  const updateScenario = (patch: Partial<RetirementScenario>) => {
    setScenario({ ...activeScenario, ...patch });
    setSaved(false);
  };

  const saveScenario = async () => {
    await retirementStore.saveScenario(activeScenario);
    setScenario(activeScenario);
    setSaved(true);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading your portfolio…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Retirement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your retirement plan is separate from your portfolio tracker: the tracker supplies current values;
            this workspace models the future.
          </p>
        </div>
        <Badge variant="outline">Local retirement workspace</Badge>
      </header>

      <nav className="flex flex-wrap gap-2 border-b pb-3">
        {([
          ["overview", "Overview", ShieldCheck],
          ["plan", "Plan", Settings2],
          ["scenarios", "Scenarios", BarChart3],
          ["analysis", "Analysis", WalletCards],
          ["reports", "Reports", FileText],
        ] as const).map(([id, label, Icon]) => (
          <Button key={id} variant={section === id ? "default" : "ghost"} size="sm" onClick={() => setSection(id)}>
            <Icon className="mr-2 h-4 w-4" />{label}
          </Button>
        ))}
      </nav>

      {section === "overview" && (
        <Overview
          overview={overview}
          portfolioTotal={portfolio.total}
          onPlan={() => setSection("plan")}
        />
      )}

      {section === "plan" && (
        <PlanEditor
          scenario={activeScenario}
          portfolio={portfolio}
          onChange={updateScenario}
          onSave={saveScenario}
          saved={saved}
        />
      )}

      {section === "scenarios" && <ComingSoon title="Scenarios" text="Base, alternative and stress scenarios will all use the same simulation engine. Nothing here will change your actual Portfolio Tracker data." />}
      {section === "analysis" && <ComingSoon title="Analysis" text="This area will expose the calculation trace: portfolio trajectory, cash flow, withdrawals, taxes, CPP/QPP, OAS/GIS, survivor outcomes, debt, net worth and estate." />}
      {section === "reports" && <ComingSoon title="Reports" text="Reports will be generated from a saved simulation result, with the scenario hash, rules version, engine version and portfolio snapshot preserved for reproducibility." />}
    </div>
  );
}

function Overview({ overview, portfolioTotal, onPlan }: { overview: ReturnType<typeof buildRetirementOverview>; portfolioTotal: number; onPlan: () => void }) {
  return (
    <div className="space-y-5">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Retirement readiness</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">{overview.headline}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{overview.explanation}</p>
          </div>
          <Button onClick={onPlan}>Set up your plan</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current tracked portfolio" value={formatCad(portfolioTotal)} />
        <Metric label="Simulation" value="Not run" />
        <Metric label="Taxes & benefits" value="Not calculated" />
        <Metric label="Survivor & estate" value="Not calculated" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h3 className="font-display text-lg font-semibold">What this Overview will answer</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Can the selected spending goal be funded through the planning age?</li>
            <li>• When should CPP/QPP and OAS start?</li>
            <li>• How should withdrawals interact with taxes, OAS recovery and GIS?</li>
            <li>• What happens after the first death, and what remains for the estate?</li>
            <li>• How robust is the plan under lower returns, higher inflation and longevity?</li>
          </ul>
        </div>
        <div className="panel p-5">
          <h3 className="font-display text-lg font-semibold">Important distinction</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The current portfolio value shown here is read from Portfolio Tracker. Retirement assumptions,
            scenarios and results are stored separately. A scenario override can change the simulation without
            changing your real portfolio.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanEditor({
  scenario, portfolio, onChange, onSave, saved,
}: {
  scenario: RetirementScenario;
  portfolio: { total: number; byType: Record<string, number> };
  onChange: (patch: Partial<RetirementScenario>) => void;
  onSave: () => Promise<void>;
  saved: boolean;
}) {
  const person = scenario.household.people[0]!;
  const setGoals = (patch: Partial<RetirementScenario["goals"]>) => onChange({ goals: { ...scenario.goals, ...patch } });
  const setPerson = (patch: Partial<typeof person>) =>
    onChange({ household: { ...scenario.household, people: [{ ...person, ...patch }] } });

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Plan inputs</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter the assumptions once. The future Overview will consume simulation results, not duplicate calculations.</p>
          </div>
          <Button onClick={onSave}>{saved ? "Saved locally" : "Save plan"}</Button>
        </div>
      </div>

      <Section title="Household" subtitle="Only information needed for retirement calculations. No names, SINs or contact information.">
        <Field label="Province">
          <Select value={scenario.household.province} onValueChange={(v) => onChange({ household: { ...scenario.household, province: v as RetirementScenario["household"]["province"] } })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Birth year"><Input type="number" value={person.birthYear} onChange={(e) => setPerson({ birthYear: Number(e.target.value) })} /></Field>
        <Field label="Birth month"><Input type="number" min={1} max={12} value={person.birthMonth} onChange={(e) => setPerson({ birthMonth: Number(e.target.value) })} /></Field>
        <Field label="Partner"><Select value={scenario.household.people.length > 1 ? "yes" : "no"} onValueChange={(v) => {
          const people = v === "yes" ? [...scenario.household.people, { role: "PARTNER" as const, birthYear: person.birthYear, birthMonth: person.birthMonth, retirementAge: 65, cppStartAge: "OPTIMIZE" as const, oasStartAge: "OPTIMIZE" as const, oasResidenceYears: 40 }] : [person];
          onChange({ household: { ...scenario.household, people } });
        }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent></Select></Field>
      </Section>

      <Section title="Retirement goals" subtitle="Use today's dollars unless you deliberately want future-dollar inputs.">
        <Field label="Retirement age"><Input type="number" value={scenario.goals.retirementAge} onChange={(e) => setGoals({ retirementAge: Number(e.target.value) })} /></Field>
        <Field label="Annual spending"><Input type="number" value={scenario.goals.annualSpending} onChange={(e) => setGoals({ annualSpending: Number(e.target.value) })} /></Field>
        <Field label="Planning age"><Input type="number" value={scenario.goals.planningAge} onChange={(e) => setGoals({ planningAge: Number(e.target.value) })} /></Field>
        <Field label="Essential spending (optional)"><Input type="number" value={scenario.goals.essentialSpending ?? ""} onChange={(e) => setGoals({ essentialSpending: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </Section>

      <Section title="Portfolio" subtitle="Portfolio Tracker remains the source of truth. These displayed values are linked, not copied into a second cloud database.">
        {Object.entries(portfolio.byType).map(([type, value]) => (
          <div key={type} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{type}</p>
            <p className="num mt-1 font-semibold">{formatCad(value)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Tracker value</p>
          </div>
        ))}
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="num mt-1 font-semibold">{formatCad(portfolio.total)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Current linked value</p>
        </div>
      </Section>

      <Section title="Investment assumptions" subtitle="Economic assumptions are separate from government rules.">
        <Field label="Expected annual return"><Input type="number" step="0.1" value={scenario.assumptions.investmentReturn} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentReturn: Number(e.target.value) } })} /></Field>
        <Field label="Inflation"><Input type="number" step="0.1" value={scenario.assumptions.inflationRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, inflationRate: Number(e.target.value) } })} /></Field>
        <Field label="Investment fees"><Input type="number" step="0.1" value={scenario.assumptions.investmentFeeRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentFeeRate: Number(e.target.value) } })} /></Field>
      </Section>

      <Section title="Strategy" subtitle="These are preferences for the optimizer, not hidden assumptions inside the tax engine.">
        <Field label="Withdrawal policy">
          <Select value={scenario.strategy.withdrawalPolicy} onValueChange={(v) => onChange({ strategy: { ...scenario.strategy, withdrawalPolicy: v as RetirementScenario["strategy"]["withdrawalPolicy"] } })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["OPTIMIZE","USER_DEFINED","TAX_TARGETED","REGISTERED_FIRST","TFSA_FIRST","NON_REGISTERED_FIRST"].map((v) => <SelectItem key={v} value={v}>{v.replaceAll("_"," ")}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Minimum cash reserve"><Input type="number" value={scenario.strategy.cashReserve ?? 0} onChange={(e) => onChange({ strategy: { ...scenario.strategy, cashReserve: Number(e.target.value) } })} /></Field>
      </Section>

      <div className="flex justify-end"><Button onClick={onSave}>{saved ? "Saved locally" : "Save plan"}</Button></div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="panel space-y-4 p-5"><div><h2 className="font-display text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="panel p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="num mt-2 text-xl font-semibold">{value}</p></div>;
}
function ComingSoon({ title, text }: { title: string; text: string }) {
  return <div className="panel p-8"><h2 className="font-display text-xl font-semibold">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{text}</p></div>;
}
