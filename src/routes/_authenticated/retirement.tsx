import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, FileText, Settings2, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCad, summariseAccount } from "@/lib/finance";
import { usePortfolio } from "@/lib/portfolio";
import {
  buildRetirementOverview,
  createDefaultRetirementScenario,
  retirementStore,
  runBasicSimulation,
  runStressTests,
  summarizeStressTests,
  scenarioStatusText,
  type ScenarioStressTestResult,
  type ScenarioSummary,
  type RetirementScenario,
  type SimulationResult,
} from "@/lib/retirement";

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
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [stressResults, setStressResults] = useState<ScenarioStressTestResult | null>(null);

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
      const value = Math.max(0, summary.marketValue + Math.max(0, summary.cash));
      byType[account.account_type] = (byType[account.account_type] ?? 0) + value;
      total += value;
    }
    return { total, byType };
  }, [accounts, holdings, transactions, quotes, fxUsdCad]);

  useEffect(() => {
    let cancelled = false;
    retirementStore.listScenarios().then(async (items) => {
      if (cancelled || !items[0]) return;
      setScenario(items[0]);
      const savedResults = await Promise.all(
        items.slice(0, 3).map((item) => retirementStore.getResult(item.metadata.scenarioHash ?? "").catch(() => null)),
      );
      if (!cancelled) setResult(savedResults.find(Boolean) ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activeScenario = scenario ?? createDefaultRetirementScenario();
  const overview = buildRetirementOverview(result, activeScenario);

  const runSimulation = async (nextScenario = activeScenario) => {
    setRunning(true);
    try {
      const simulation = runBasicSimulation(nextScenario, portfolio.total, new Date().getUTCFullYear(), portfolio.byType);
      await retirementStore.saveResult(simulation);
      const persistedScenario = { ...nextScenario, metadata: { ...nextScenario.metadata, scenarioHash: simulation.simulationId } };
      await retirementStore.saveScenario(persistedScenario);
      setScenario(persistedScenario);
      setResult(simulation);
      setStressResults(null);
      setSaved(true);
    } finally {
      setRunning(false);
    }
  };

  const updateScenario = (patch: Partial<RetirementScenario>) => {
    setScenario({ ...activeScenario, ...patch });
    setResult(null);
    setSaved(false);
  };

  const saveScenario = async () => {
    await retirementStore.saveScenario(activeScenario);
    setScenario(activeScenario);
    setSaved(true);
    await runSimulation(activeScenario);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading your portfolio…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Retirement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A separate retirement workspace that uses your Portfolio Tracker as the current-value source.
          </p>
        </div>
        <Badge variant="outline">{running ? "Calculating…" : result ? "Simulation current" : "Plan not calculated"}</Badge>
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
        <Overview overview={overview} portfolioTotal={portfolio.total} onPlan={() => setSection("plan")} onRun={() => runSimulation()} running={running} />
      )}
      {section === "plan" && (
        <PlanEditor scenario={activeScenario} portfolio={portfolio} onChange={updateScenario} onSave={saveScenario} saved={saved} running={running} />
      )}
      {section === "scenarios" && (
        <ScenarioPanel scenario={activeScenario} portfolio={portfolio} onRun={runSimulation} running={running} />
      )}
      {section === "analysis" && <Analysis result={result} />}
      {section === "reports" && <Reports result={result} />}
    </div>
  );
}

function Overview({ overview, portfolioTotal, onPlan, onRun, running }: {
  overview: ReturnType<typeof buildRetirementOverview>;
  portfolioTotal: number;
  onPlan: () => void;
  onRun: () => Promise<void>;
  running: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Retirement readiness</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">{overview.headline}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{overview.explanation}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onPlan}>Edit plan</Button>
            <Button onClick={onRun} disabled={running}>{running ? "Calculating…" : "Run simulation"}</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current tracked portfolio" value={formatCad(portfolioTotal)} />
        <Metric label="Ending portfolio" value={overview.metrics[0] ? formatCad(Number(overview.metrics[0].value)) : "—"} />
        <Metric label="Lifetime taxes" value={overview.metrics[2] ? formatCad(Number(overview.metrics[2].value)) : "—"} />
        <Metric label="Government benefits" value={overview.metrics[3] ? formatCad(Number(overview.metrics[3].value)) : "—"} />
      </div>


      {stressResults && <StressOverview stressResults={stressResults} onScenarios={() => {}} />}
\n      {overview.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Model limitations</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{overview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h3 className="font-display text-lg font-semibold">What the Overview answers</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Can the selected spending goal be funded through the planning age?</li>
            <li>• How much income comes from the portfolio versus government benefits?</li>
            <li>• Where are the largest tax and withdrawal pressures?</li>
            <li>• What changes under lower returns, higher inflation or different benefit timing?</li>
          </ul>
        </div>
        <div className="panel p-5">
          <h3 className="font-display text-lg font-semibold">Portfolio connection</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Current balances come from Portfolio Tracker. Retirement calculations are stored locally in the browser.
            Scenario changes never modify the real portfolio.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanEditor({ scenario, portfolio, onChange, onSave, saved, running }: {
  scenario: RetirementScenario;
  portfolio: { total: number; byType: Record<string, number> };
  onChange: (patch: Partial<RetirementScenario>) => void;
  onSave: () => Promise<void>;
  saved: boolean;
  running: boolean;
}) {
  const person = scenario.household.people[0]!;
  const setGoals = (patch: Partial<RetirementScenario["goals"]>) => onChange({ goals: { ...scenario.goals, ...patch } });
  const setPerson = (patch: Partial<typeof person>) => onChange({ household: { ...scenario.household, people: [{ ...person, ...patch }, ...scenario.household.people.slice(1)] } });

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="font-display text-xl font-semibold">Plan inputs</h2><p className="mt-1 text-sm text-muted-foreground">Enter assumptions once; the simulation and Overview consume the same scenario.</p></div>
          <Button onClick={onSave} disabled={running}>{running ? "Calculating…" : saved ? "Saved & calculated" : "Save & calculate"}</Button>
        </div>
      </div>

      <Section title="Household" subtitle="Only retirement-relevant information is stored. No names, SINs or contact information.">
        <Field label="Province"><Select value={scenario.household.province} onValueChange={(v) => onChange({ household: { ...scenario.household, province: v as RetirementScenario["household"]["province"] } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Birth year"><Input type="number" value={person.birthYear} onChange={(e) => setPerson({ birthYear: Number(e.target.value) })} /></Field>
        <Field label="Birth month"><Input type="number" min={1} max={12} value={person.birthMonth} onChange={(e) => setPerson({ birthMonth: Number(e.target.value) })} /></Field>
        <Field label="Partner"><Select value={scenario.household.people.length > 1 ? "yes" : "no"} onValueChange={(v) => {
          const people = v === "yes"
            ? scenario.household.people.length > 1 ? scenario.household.people : [...scenario.household.people, { role: "PARTNER" as const, birthYear: person.birthYear, birthMonth: person.birthMonth, retirementAge: 65, cppStartAge: "OPTIMIZE" as const, oasStartAge: "OPTIMIZE" as const, oasResidenceYears: 40 }]
            : [person];
          onChange({ household: { ...scenario.household, people } });
        }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent></Select></Field>
      </Section>

      <Section title="Retirement goals" subtitle="Spending is entered in today's dollars and is inflation-adjusted by the engine.">
        <Field label="Retirement age"><Input type="number" value={scenario.goals.retirementAge} onChange={(e) => setGoals({ retirementAge: Number(e.target.value) })} /></Field>
        <Field label="Annual spending"><Input type="number" value={scenario.goals.annualSpending} onChange={(e) => setGoals({ annualSpending: Number(e.target.value) })} /></Field>
        <Field label="Planning age"><Input type="number" value={scenario.goals.planningAge} onChange={(e) => setGoals({ planningAge: Number(e.target.value) })} /></Field>
        <Field label="Essential spending"><Input type="number" value={scenario.goals.essentialSpending ?? ""} onChange={(e) => setGoals({ essentialSpending: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </Section>

      <Section title="Portfolio" subtitle="Linked values are read-only here. Manual scenario overrides will be added without changing Portfolio Tracker.">
        {Object.entries(portfolio.byType).map(([type, value]) => <div key={type} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{type}</p><p className="num mt-1 font-semibold">{formatCad(value)}</p><p className="mt-1 text-[11px] text-muted-foreground">Portfolio Tracker</p></div>)}
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Total</p><p className="num mt-1 font-semibold">{formatCad(portfolio.total)}</p><p className="mt-1 text-[11px] text-muted-foreground">Current linked value</p></div>
      </Section>

      <Section title="Investment assumptions" subtitle="Economic assumptions are separate from government rules.">
        <Field label="Expected annual return"><Input type="number" step="0.1" value={scenario.assumptions.investmentReturn} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentReturn: Number(e.target.value) } })} /></Field>
        <Field label="Inflation"><Input type="number" step="0.1" value={scenario.assumptions.inflationRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, inflationRate: Number(e.target.value) } })} /></Field>
        <Field label="Investment fees"><Input type="number" step="0.1" value={scenario.assumptions.investmentFeeRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentFeeRate: Number(e.target.value) } })} /></Field>
      </Section>

      <Section title="Strategy" subtitle="Withdrawal policies are explicit inputs, not hidden inside the tax engine.">
        <Field label="Withdrawal policy"><Select value={scenario.strategy.withdrawalPolicy} onValueChange={(v) => onChange({ strategy: { ...scenario.strategy, withdrawalPolicy: v as RetirementScenario["strategy"]["withdrawalPolicy"] } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OPTIMIZE","USER_DEFINED","TAX_TARGETED","REGISTERED_FIRST","TFSA_FIRST","NON_REGISTERED_FIRST"].map((v) => <SelectItem key={v} value={v}>{v.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Minimum cash reserve"><Input type="number" value={scenario.strategy.cashReserve ?? 0} onChange={(e) => onChange({ strategy: { ...scenario.strategy, cashReserve: Number(e.target.value) } })} /></Field>
      </Section>
    </div>
  );
}

function ScenarioPanel({ scenario, portfolio, stressResults, onRun, onStress, running }: { scenario: RetirementScenario; portfolio: { total: number; byType: Record<string, number> }; stressResults: ScenarioStressTestResult | null; onRun: (scenario?: RetirementScenario) => Promise<void>; onStress: (result: ScenarioStressTestResult) => void; running: boolean }) {
  const stress = (label: string, patch: Partial<RetirementScenario["assumptions"]>) => {
    const next = { ...scenario, name: label, assumptions: { ...scenario.assumptions, ...patch }, id: crypto.randomUUID(), metadata: { ...scenario.metadata, createdAt: new Date().toISOString() } };
    void onRun(next);
  };
  return (
    <div className="space-y-5">
      <div className="panel p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-display text-xl font-semibold">Scenarios</h2><p className="mt-1 text-sm text-muted-foreground">Stress the same plan without changing the linked portfolio or base scenario.</p></div><Button onClick={runAllStressTests} disabled={running}>{running ? "Calculating…" : "Run all stress tests"}</Button></div></div>
      <div className="grid gap-4 md:grid-cols-3">
        <ScenarioCard title="Base plan" text={`${scenario.assumptions.investmentReturn}% return / ${scenario.assumptions.inflationRate}% inflation`} onClick={() => onRun()} disabled={running} />
        <ScenarioCard title="Lower returns" text="4% return / current inflation" onClick={() => stress("Lower-return stress", { investmentReturn: 4 })} disabled={running} />
        <ScenarioCard title="Higher inflation" text="6% return / 4% inflation" onClick={() => stress("Higher-inflation stress", { investmentReturn: 6, inflationRate: 4 })} disabled={running} />
      </div>
      {summaries.length > 0 && <ScenarioResults summaries={summaries} />}\n      <p className="text-xs text-muted-foreground">Scenario results are deterministic. More advanced sequence-of-returns and longevity stress testing is planned for the optimizer layer.</p>
    </div>
  );
}


function StressOverview({ stressResults }: { stressResults: ScenarioStressTestResult; onScenarios: () => void }) {
  const summaries = summarizeStressTests(stressResults).filter(s => s.kind !== "BASE");
  const attention = summaries.filter(s => s.status === "DEPLETES" || s.status === "SHORTFALL").length;
  return <div className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stress testing</p><h3 className="mt-1 font-display text-lg font-semibold">{attention === 0 ? "Base plan holds across the selected stress tests" : `${attention} stress scenario${attention === 1 ? "" : "s"} need attention`}</h3><p className="mt-1 text-sm text-muted-foreground">These are deterministic what-if cases, not probabilities.</p></div><Button variant="outline" onClick={onScenarios}>View scenarios</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{summaries.slice(0,3).map(s => <div key={s.kind} className="rounded-lg border p-3"><p className="font-medium">{s.name}</p><p className="mt-1 text-xs text-muted-foreground">{scenarioStatusText(s)}</p></div>)}</div></div>;
}
function ScenarioResults({ summaries }: { summaries: ScenarioSummary[] }) {
  return <div className="panel p-5"><h3 className="font-display text-lg font-semibold">Stress-test results</h3><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="pb-2 pr-4">Scenario</th><th className="pb-2 pr-4">Result</th><th className="pb-2 pr-4">Ending portfolio</th><th className="pb-2 pr-4">Max shortfall</th><th className="pb-2">Change vs base</th></tr></thead><tbody>{summaries.map(s => <tr key={s.kind} className="border-b last:border-0"><td className="py-3 pr-4 font-medium">{s.name}</td><td className="py-3 pr-4">{scenarioStatusText(s)}</td><td className="py-3 pr-4 num">{formatCad(s.endingPortfolio)}</td><td className="py-3 pr-4 num">{formatCad(s.maximumShortfall)}</td><td className="py-3 num">{formatCad(s.deltaEndingPortfolio)}</td></tr>)}</tbody></table></div></div>;
}
\nfunction Analysis({ result }: { result: SimulationResult | null }) {
  if (!result) return <ComingSoon title="Analysis" text="Run the plan from Overview or Plan first. Detailed monthly cash flow, withdrawals, taxes, benefits and portfolio trajectory will appear here." />;
  const last = result.monthly.at(-1);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Feasible under base assumptions" value={result.metrics.feasible ? "Yes" : "No"} />
        <Metric label="Ending portfolio" value={formatCad(result.metrics.endingPortfolio)} />
        <Metric label="Maximum spending shortfall" value={formatCad(result.metrics.maximumSpendingShortfall)} />
        <Metric label="Lifetime spending" value={formatCad(result.metrics.lifetimeSpending)} />
        <Metric label="Lifetime tax" value={formatCad(result.metrics.lifetimeTax)} />
        <Metric label="Total benefits" value={formatCad(result.metrics.totalBenefits)} />
      </div>
      <div className="panel p-5">
        <h3 className="font-display text-lg font-semibold">Latest simulation month</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Metric label="Portfolio" value={formatCad(last?.portfolio ?? 0)} />
          <Metric label="Benefits" value={formatCad(last?.benefits ?? 0)} />
          <Metric label="Withdrawals" value={formatCad(last?.withdrawals ?? 0)} />
          <Metric label="Taxes" value={formatCad(last?.taxes ?? 0)} />
        </div>
      </div>
    </div>
  );
}

function Reports({ result }: { result: SimulationResult | null }) {
  if (!result) return <ComingSoon title="Reports" text="Run a simulation to generate a reproducible retirement report. The report will preserve assumptions, rules version, engine version and simulation ID." />;
  const download = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `retirement-simulation-${result.simulationId}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="space-y-5"><div className="panel p-5"><h2 className="font-display text-xl font-semibold">Simulation report</h2><p className="mt-2 text-sm text-muted-foreground">Reproducibility metadata is included so a future engine can explain how this result was produced.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Engine" value={result.engineVersion} /><Metric label="Rules" value={result.rulesVersion} /><Metric label="Status" value={result.status} /><Metric label="Simulation ID" value={result.simulationId.slice(0, 12)} /></div><Button className="mt-5" onClick={download}>Export JSON</Button></div></div>;
}

function ScenarioCard({ title, text, onClick, disabled }: { title: string; text: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="panel p-5 text-left transition hover:-translate-y-0.5 hover:border-foreground/20 disabled:opacity-50"><p className="font-display font-semibold">{title}</p><p className="mt-2 text-sm text-muted-foreground">{text}</p></button>;
}
function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="panel space-y-4 p-5"><div><h2 className="font-display text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="panel p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="num mt-2 text-xl font-semibold break-all">{value}</p></div>;
}
function ComingSoon({ title, text }: { title: string; text: string }) {
  return <div className="panel p-8"><h2 className="font-display text-xl font-semibold">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{text}</p></div>;
}
