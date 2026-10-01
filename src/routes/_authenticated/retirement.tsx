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
  buildRetirementAnalysis,
  createDefaultRetirementScenario,
  retirementStore,
  runBasicSimulation,
  runStressTests,
  summarizeStressTests,
  DEFAULT_STRESS_TESTS,
  scenarioStatusText,
  buildRetirementReport,
  serializeRetirementReport,
  buildPrintableRetirementReport,
  type ScenarioStressTestResult,
  type ScenarioSummary,
  type RetirementScenario,
  type SimulationResult,
  type OptimizationResult,
} from "@/lib/retirement/index";

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
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const portfolio = useMemo(() => {
    const byType: Record<string, number> = {};
    const accountValues: Record<string, { value: number; name: string; type: string; owner: "MAIN_USER" | "PARTNER" }> = {};
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
      const owner = account.owner_type === "partner" ? "PARTNER" : "MAIN_USER";
      accountValues[account.id] = { value, name: account.account_name, type: account.account_type, owner };
      byType[account.account_type] = (byType[account.account_type] ?? 0) + value;
      total += value;
    }
    return { total, byType, accountValues };
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

  useEffect(() => {
    if (!scenario || accounts.length === 0) return;
    const retirementTypes = new Set(["TFSA", "RRSP", "Spousal RRSP", "LIRA", "LRSP", "Non-Registered"]);
    const existing = new Map(scenario.accounts.map((a) => [a.id, a]));
    const nextAccounts = accounts
      .filter((account) => retirementTypes.has(account.account_type))
      .map((account) => {
        const current = existing.get(account.id);
        const tracked = portfolio.accountValues[account.id];
        const type = account.account_type === "TFSA" ? "TFSA"
          : account.account_type === "RRSP" || account.account_type === "Spousal RRSP" ? "RRSP"
          : account.account_type === "LIRA" || account.account_type === "LRSP" ? "LIRA"
          : "NON_REGISTERED";
        return current ?? {
          id: account.id,
          owner: tracked?.owner ?? "MAIN_USER",
          type,
          valuation: { mode: "SNAPSHOT" as const, linkedValue: tracked?.value ?? 0, snapshotDate: new Date().toISOString().slice(0, 10) },
        };
      });
    const changed = nextAccounts.length !== scenario.accounts.length ||
      nextAccounts.some((next) => {
        const old = existing.get(next.id);
        return !old || old.valuation.mode === "SNAPSHOT" && old.valuation.linkedValue !== portfolio.accountValues[next.id]?.value;
      });
    if (changed) setScenario({ ...scenario, accounts: nextAccounts });
  }, [accounts, portfolio.accountValues, scenario]);
  const overview = buildRetirementOverview(result, activeScenario);

  const runOptimization = async () => {
    setOptimizing(true);
    try {
      const { optimizeRetirementPlan } = await import("@/lib/retirement/index");
      const next = optimizeRetirementPlan({
        scenario: activeScenario,
        startingPortfolio: portfolio.total,
        startYear: new Date().getUTCFullYear(),
        portfolioByType: portfolio.byType,
      });
      setOptimization(next);
    } finally {
      setOptimizing(false);
    }
  };

  const runSimulation = async (nextScenario = activeScenario) => {
    setRunning(true);
    try {
      const effective = getEffectiveRetirementPortfolio(nextScenario, portfolio);
      const simulation = runBasicSimulation(nextScenario, effective.total, new Date().getUTCFullYear(), effective.byType);
      await retirementStore.saveResult(simulation);
      const persistedScenario = { ...nextScenario, metadata: { ...nextScenario.metadata, scenarioHash: simulation.scenarioHash } };
      await retirementStore.saveScenario(persistedScenario);
      setScenario(persistedScenario);
      setResult(simulation);
      setStressResults(null);
      setOptimization(null);
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
        <Overview
          overview={overview}
          portfolioTotal={portfolio.total}
          optimization={optimization}
          optimizing={optimizing}
          onPlan={() => setSection("plan")}
          onRun={() => runSimulation()}
          onOptimize={runOptimization}
          running={running}
        />
      )}
      {section === "plan" && (
        <PlanEditor scenario={activeScenario} portfolio={portfolio} onChange={updateScenario} onSave={saveScenario} saved={saved} running={running} />
      )}
      {section === "scenarios" && (
        <ScenarioPanel
          scenario={activeScenario}
          portfolio={portfolio}
          stressResults={stressResults}
          onStress={setStressResults}
          onRun={runSimulation}
          running={running}
        />
      )}
      {section === "analysis" && <Analysis result={result} />}
      {section === "reports" && <Reports result={result} scenario={scenario} />}
    </div>
  );
}

function Overview({
  overview,
  portfolioTotal,
  optimization,
  optimizing,
  onPlan,
  onRun,
  onOptimize,
  running,
}: {
  overview: ReturnType<typeof buildRetirementOverview>;
  portfolioTotal: number;
  optimization: OptimizationResult | null;
  optimizing: boolean;
  onPlan: () => void;
  onRun: () => Promise<void>;
  onOptimize: () => Promise<void>;
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
            <Button variant="outline" onClick={onOptimize} disabled={running || optimizing}>
              {optimizing ? "Analyzing strategies…" : "Analyze strategies"}
            </Button>
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


      {overview.sections.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {overview.sections.map((section) => (
            <div key={section.title} className="panel p-5">
              <h3 className="font-display text-lg font-semibold">{section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.summary}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {section.metrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{metric.label}</p>
                    <p className={`num mt-1 font-semibold ${metric.tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {typeof metric.value === "number" ? formatCad(metric.value) : metric.value}
                    </p>
                    {metric.note && <p className="mt-1 text-[11px] text-muted-foreground">{metric.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {stressResults && <StressOverview stressResults={stressResults} onScenarios={() => setSection("scenarios")} />}

      {optimization && (
        <div className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Strategy analysis</p>
              <h3 className="mt-1 font-display text-lg font-semibold">
                {optimization.feasiblePlans.length > 0
                  ? `${optimization.feasiblePlans.length} strategies meet the current constraints`
                  : "No strategy met the current constraints"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                This compares explicit strategy combinations; it does not represent a probability or guarantee.
              </p>
            </div>
            <Badge variant="outline">{optimization.candidates.length} candidates tested</Badge>
          </div>
          {optimization.selectedCandidate && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Selected objective" value={optimization.objective.replaceAll("_", " ")} />
              <Metric label="Lifetime spending" value={formatCad(optimization.selectedCandidate.metrics.lifetimeSpending)} />
              <Metric label="Lifetime tax" value={formatCad(optimization.selectedCandidate.metrics.lifetimeTax)} />
              <Metric label="Ending portfolio" value={formatCad(optimization.selectedCandidate.metrics.endingPortfolio)} />
            </div>
          )}
        </div>
      )}
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



function getEffectiveRetirementPortfolio(
  scenario: RetirementScenario,
  portfolio: { total: number; byType: Record<string, number>; accountValues: Record<string, { value: number; name: string; type: string; owner: "MAIN_USER" | "PARTNER" }> },
) {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const account of scenario.accounts) {
    const tracked = portfolio.accountValues[account.id];
    const value = account.valuation.mode === "MANUAL"
      ? Math.max(0, account.valuation.value ?? 0)
      : Math.max(0, account.valuation.linkedValue ?? tracked?.value ?? 0);
    byType[account.type] = (byType[account.type] ?? 0) + value;
    total += value;
  }
  return { total, byType };
}

function PlanEditor({ scenario, portfolio, onChange, onSave, saved, running }: {
  scenario: RetirementScenario;
  portfolio: { total: number; byType: Record<string, number>; accountValues: Record<string, { value: number; name: string; type: string; owner: "MAIN_USER" | "PARTNER" }> };
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
        <Field label="Retirement age"><Input type="number" min="50" max="90" value={scenario.goals.retirementAge} onChange={(e) => setGoals({ retirementAge: Number(e.target.value) })} /></Field>
        <Field label="Annual spending"><Input type="number" min="0" value={scenario.goals.annualSpending} onChange={(e) => setGoals({ annualSpending: Math.max(0, Number(e.target.value) || 0) })} /></Field>
        <Field label="Planning age"><Input type="number" min="70" max="110" value={scenario.goals.planningAge} onChange={(e) => setGoals({ planningAge: Number(e.target.value) })} /></Field>
        <Field label="Essential spending"><Input type="number" min="0" value={scenario.goals.essentialSpending ?? ""} onChange={(e) => setGoals({ essentialSpending: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} /></Field>
        <Field label="Survivor spending %"><Input type="number" min="0" max="100" step="1" value={(scenario.goals.survivorSpendingRate ?? 75) * 100} onChange={(e) => setGoals({ survivorSpendingRate: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} /></Field>
        <Field label="Minimum estate"><Input type="number" min="0" value={scenario.goals.minimumEstate ?? ""} onChange={(e) => setGoals({ minimumEstate: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} /></Field>
      </Section>

      <Section title="Government benefits & other income" subtitle="These inputs are used by the CPP/QPP, OAS/GIS and tax engines.">
        {scenario.household.people.map((member, index) => (
          <div key={member.role} className="rounded-lg border p-4 sm:col-span-2">
            <p className="font-medium">{member.role === "MAIN_USER" ? "You" : "Partner"}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Retirement age"><Input type="number" min="50" max="90" value={member.retirementAge} onChange={(e) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, retirementAge: Number(e.target.value) } : p);
                onChange({ household: { ...scenario.household, people } });
              }} /></Field>
              <Field label="CPP/QPP estimate at 65"><Input type="number" min="0" value={member.cppAt65 ?? ""} onChange={(e) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, cppAt65: e.target.value ? Math.max(0, Number(e.target.value)) : undefined } : p);
                onChange({ household: { ...scenario.household, people } });
              }} /></Field>
              <Field label="CPP/QPP start"><Select value={String(member.cppStartAge)} onValueChange={(v) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, cppStartAge: v === "OPTIMIZE" ? "OPTIMIZE" as const : Number(v) } : p);
                onChange({ household: { ...scenario.household, people } });
              }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OPTIMIZE","60","65","70"].map((v) => <SelectItem key={v} value={v}>{v === "OPTIMIZE" ? "Optimizer chooses" : v}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="OAS start"><Select value={String(member.oasStartAge)} onValueChange={(v) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, oasStartAge: v === "OPTIMIZE" ? "OPTIMIZE" as const : Number(v) } : p);
                onChange({ household: { ...scenario.household, people } });
              }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OPTIMIZE","65","70"].map((v) => <SelectItem key={v} value={v}>{v === "OPTIMIZE" ? "Optimizer chooses" : v}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="OAS residence years"><Input type="number" min="0" max="50" value={member.oasResidenceYears} onChange={(e) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, oasResidenceYears: Math.min(50, Math.max(0, Number(e.target.value))) } : p);
                onChange({ household: { ...scenario.household, people } });
              }} /></Field>
              <Field label="Other annual income"><Input type="number" min="0" value={member.otherIncome ?? ""} onChange={(e) => {
                const people = scenario.household.people.map((p, i) => i === index ? { ...p, otherIncome: e.target.value ? Math.max(0, Number(e.target.value)) : undefined } : p);
                onChange({ household: { ...scenario.household, people } });
              }} /></Field>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Portfolio" subtitle="Each retirement account is linked to Portfolio Tracker unless you choose a scenario-only override.">
        <div className="space-y-3 sm:col-span-2">
          {scenario.accounts.map((account) => {
            const tracked = portfolio.accountValues[account.id];
            if (!tracked) return null;
            const manual = account.valuation.mode === "MANUAL";
            return (
              <div key={account.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{tracked.name}</p>
                    <p className="text-xs text-muted-foreground">{tracked.type} · {account.owner === "PARTNER" ? "Partner" : "You"}</p>
                  </div>
                  <Badge variant={manual ? "secondary" : "outline"}>{manual ? "Scenario override" : "Linked"}</Badge>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                  <div>
                    <p className="text-xs text-muted-foreground">Portfolio Tracker value</p>
                    <p className="num mt-1 font-semibold">{formatCad(tracked.value)}</p>
                  </div>
                  <div>
                    <Label>Scenario value</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min="0"
                      value={manual ? account.valuation.value ?? "" : tracked.value}
                      onChange={(e) => {
                        const value = Math.max(0, Number(e.target.value) || 0);
                        onChange({
                          accounts: scenario.accounts.map((item) => item.id === account.id
                            ? { ...item, valuation: { ...item.valuation, mode: "MANUAL" as const, value, linkedValue: tracked.value, snapshotDate: new Date().toISOString().slice(0, 10) } }
                            : item),
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({
                      accounts: scenario.accounts.map((item) => item.id === account.id
                        ? { ...item, valuation: { mode: "SNAPSHOT" as const, linkedValue: tracked.value, snapshotDate: new Date().toISOString().slice(0, 10), value: undefined } }
                        : item),
                    })}
                  >
                    Use Tracker value
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Effective retirement starting portfolio</p>
            <p className="num mt-1 text-lg font-semibold">{formatCad(getEffectiveRetirementPortfolio(scenario, portfolio).total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Scenario overrides never change Portfolio Tracker.</p>
          </div>
        </div>
      </Section>

      <Section title="Investment assumptions" subtitle="Economic assumptions are separate from government rules.">
        <Field label="Expected annual return"><Input type="number" step="0.1" value={scenario.assumptions.investmentReturn} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentReturn: Number(e.target.value) } })} /></Field>
        <Field label="Inflation"><Input type="number" step="0.1" value={scenario.assumptions.inflationRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, inflationRate: Number(e.target.value) } })} /></Field>
        <Field label="Investment fees"><Input type="number" step="0.1" value={scenario.assumptions.investmentFeeRate} onChange={(e) => onChange({ assumptions: { ...scenario.assumptions, investmentFeeRate: Number(e.target.value) } })} /></Field>
      </Section>

      <Section title="Strategy" subtitle="Withdrawal policies and optimization objectives are explicit inputs.">
        <Field label="Withdrawal policy"><Select value={scenario.strategy.withdrawalPolicy} onValueChange={(v) => onChange({ strategy: { ...scenario.strategy, withdrawalPolicy: v as RetirementScenario["strategy"]["withdrawalPolicy"] } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["OPTIMIZE","USER_DEFINED","TAX_TARGETED","REGISTERED_FIRST","TFSA_FIRST","NON_REGISTERED_FIRST"].map((v) => <SelectItem key={v} value={v}>{v.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Optimization objective"><Select value={scenario.strategy.objective} onValueChange={(v) => onChange({ strategy: { ...scenario.strategy, objective: v as RetirementScenario["strategy"]["objective"] } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["MAX_SUSTAINABLE_SPENDING","MAX_LIFETIME_AFTER_TAX_CASH","MAX_ESTATE","MIN_DEPLETION_RISK","MIN_TAX","CUSTOM"].map((v) => <SelectItem key={v} value={v}>{v.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Minimum cash reserve"><Input type="number" min="0" value={scenario.strategy.cashReserve ?? 0} onChange={(e) => onChange({ strategy: { ...scenario.strategy, cashReserve: Math.max(0, Number(e.target.value) || 0) } })} /></Field>
        <Field label="Target taxable income"><Input type="number" min="0" value={scenario.strategy.taxableIncomeTarget ?? ""} onChange={(e) => onChange({ strategy: { ...scenario.strategy, taxableIncomeTarget: e.target.value ? Math.max(0, Number(e.target.value)) : undefined } })} /></Field>
        <Field label="Pension split %"><Input type="number" min="0" max="100" value={(scenario.strategy.pensionSplitPercent ?? 0) * 100} onChange={(e) => onChange({ strategy: { ...scenario.strategy, pensionSplitPercent: Math.min(1, Math.max(0, Number(e.target.value) / 100)) } })} /></Field>
        <Field label="Estate target"><Input type="number" min="0" value={scenario.strategy.estateTarget ?? ""} onChange={(e) => onChange({ strategy: { ...scenario.strategy, estateTarget: e.target.value ? Math.max(0, Number(e.target.value)) : undefined } })} /></Field>
      </Section>

      <Section title="Debt" subtitle="Debt payments reduce available retirement cash flow and balances remain part of net worth.">
        {(scenario.debts ?? []).map((debt, index) => (
          <div key={debt.id} className="rounded-lg border p-4 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type"><Select value={debt.type} onValueChange={(v) => {
                const debts = [...(scenario.debts ?? [])]; debts[index] = { ...debt, type: v as typeof debt.type }; onChange({ debts });
              }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["MORTGAGE","HELOC","LINE_OF_CREDIT","PERSONAL_LOAN","OTHER"].map((v) => <SelectItem key={v} value={v}>{v.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Balance"><Input type="number" min="0" value={debt.startingBalance} onChange={(e) => { const debts=[...(scenario.debts ?? [])]; debts[index]={...debt,startingBalance:Math.max(0,Number(e.target.value)||0)};onChange({debts}); }} /></Field>
              <Field label="Interest rate %"><Input type="number" min="0" step="0.1" value={debt.annualInterestRate} onChange={(e) => { const debts=[...(scenario.debts ?? [])]; debts[index]={...debt,annualInterestRate:Math.max(0,Number(e.target.value)||0)};onChange({debts}); }} /></Field>
              <Field label="Monthly payment"><Input type="number" min="0" value={debt.paymentAmount ?? ""} onChange={(e) => { const debts=[...(scenario.debts ?? [])]; debts[index]={...debt,paymentAmount:e.target.value?Math.max(0,Number(e.target.value)):undefined};onChange({debts}); }} /></Field>
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={() => onChange({ debts: [...(scenario.debts ?? []), { id: crypto.randomUUID(), type: "MORTGAGE", startingBalance: 0, annualInterestRate: 0, paymentAmount: 0 }] })}>
          Add debt
        </Button>
      </Section>
    </div>
  );
}

function ScenarioPanel({
  scenario,
  portfolio,
  stressResults,
  onRun,
  onStress,
  running,
}: {
  scenario: RetirementScenario;
  portfolio: { total: number; byType: Record<string, number> };
  stressResults: ScenarioStressTestResult | null;
  onRun: (scenario?: RetirementScenario) => Promise<void>;
  onStress: (result: ScenarioStressTestResult) => void;
  running: boolean;
}) {
  const runDefinition = (definition: (typeof DEFAULT_STRESS_TESTS)[number]) => {
    const next = definition.apply(scenario);
    next.id = crypto.randomUUID();
    next.name = definition.name;
    next.metadata = { ...next.metadata, createdAt: new Date().toISOString() };
    void onRun(next);
  };

  const runAllStressTests = () => {
    onStress(runStressTests(scenario, portfolio.total, portfolio.byType));
  };

  const summaries = stressResults
    ? summarizeStressTests(stressResults)
    : [];

  const groups = [
    {
      title: "Retirement & spending",
      kinds: ["EARLIER_RETIREMENT", "LATER_RETIREMENT", "LOWER_SPENDING", "HIGHER_SPENDING"],
    },
    {
      title: "Government benefit timing",
      kinds: ["CPP_60", "CPP_65", "CPP_70", "OAS_65", "OAS_70"],
    },
    {
      title: "Economic & longevity",
      kinds: ["LOW_RETURN", "HIGH_INFLATION", "POOR_SEQUENCE", "LONGER_LIFE", "SURVIVOR"],
    },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Scenarios</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Create reproducible what-if versions of the current plan. Each scenario is calculated independently and does not change the Portfolio Tracker.
            </p>
          </div>
          <Button onClick={runAllStressTests} disabled={running}>
            {running ? "Calculating…" : "Run all scenarios"}
          </Button>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.title} className="panel p-5">
          <h3 className="font-display text-lg font-semibold">{group.title}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {group.kinds.map((kind) => {
              const definition = DEFAULT_STRESS_TESTS.find((item) => item.kind === kind);
              if (!definition) return null;
              return (
                <ScenarioCard
                  key={definition.kind}
                  title={definition.name}
                  text={definition.description}
                  onClick={() => runDefinition(definition)}
                  disabled={running}
                />
              );
            })}
          </div>
        </div>
      ))}

      {summaries.length > 0 && (
        <ScenarioResults summaries={summaries} />
      )}

      {stressResults?.warnings.length ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Scenario limitations</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {stressResults.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StressOverview({ stressResults, onScenarios }: { stressResults: ScenarioStressTestResult; onScenarios: () => void }) {
  const summaries = summarizeStressTests(stressResults).filter(s => s.kind !== "BASE");
  const attention = summaries.filter(s => s.status === "DEPLETES" || s.status === "SHORTFALL").length;
  return <div className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stress testing</p><h3 className="mt-1 font-display text-lg font-semibold">{attention === 0 ? "Base plan holds across the selected stress tests" : `${attention} stress scenario${attention === 1 ? "" : "s"} need attention`}</h3><p className="mt-1 text-sm text-muted-foreground">These are deterministic what-if cases, not probabilities.</p></div><Button variant="outline" onClick={onScenarios}>View scenarios</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{summaries.slice(0,3).map(s => <div key={s.kind} className="rounded-lg border p-3"><p className="font-medium">{s.name}</p><p className="mt-1 text-xs text-muted-foreground">{scenarioStatusText(s)}</p></div>)}</div></div>;
}
function ScenarioResults({ summaries }: { summaries: ScenarioSummary[] }) {
  return <div className="panel p-5"><h3 className="font-display text-lg font-semibold">Stress-test results</h3><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="pb-2 pr-4">Scenario</th><th className="pb-2 pr-4">Result</th><th className="pb-2 pr-4">Ending portfolio</th><th className="pb-2 pr-4">Max shortfall</th><th className="pb-2">Change vs base</th></tr></thead><tbody>{summaries.map(s => <tr key={s.kind} className="border-b last:border-0"><td className="py-3 pr-4 font-medium">{s.name}</td><td className="py-3 pr-4">{scenarioStatusText(s)}</td><td className="py-3 pr-4 num">{formatCad(s.endingPortfolio)}</td><td className="py-3 pr-4 num">{formatCad(s.maximumShortfall)}</td><td className="py-3 num">{formatCad(s.deltaEndingPortfolio)}</td></tr>)}</tbody></table></div></div>;
}
function Analysis({ result }: { result: SimulationResult | null }) {
  const analysis = buildRetirementAnalysis(result);
  if (!result || !analysis) {
    return <ComingSoon title="Analysis" text="Run the plan from Overview or Plan first. Detailed cash flow, withdrawals, taxes, benefits, portfolio trajectory, debt and reconciliation diagnostics will appear here." />;
  }

  const maxPortfolio = Math.max(1, ...analysis.annual.map((row) => row.endingPortfolio));
  const maxTax = Math.max(1, ...analysis.annual.map((row) => row.taxes));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ending portfolio" value={formatCad(result.metrics.endingPortfolio)} />
        <Metric label="Ending net worth" value={formatCad(result.metrics.endingNetWorth)} />
        <Metric label="Lifetime spending" value={formatCad(result.metrics.lifetimeSpending)} />
        <Metric label="Lifetime tax" value={formatCad(result.metrics.lifetimeTax)} />
        <Metric label="Government benefits" value={formatCad(result.metrics.totalBenefits)} />
        <Metric label="Maximum shortfall" value={formatCad(result.metrics.maximumSpendingShortfall)} />
        <Metric label="Minimum portfolio" value={formatCad(result.metrics.minimumPortfolio)} />
        <Metric label="Plan status" value={result.metrics.feasible ? "No modeled shortfall" : "Shortfall detected"} />
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Portfolio trajectory</h2>
            <p className="mt-1 text-sm text-muted-foreground">Year-end portfolio and net worth across the selected planning horizon.</p>
          </div>
          {analysis.depletionAge !== undefined && (
            <Badge variant="outline">Portfolio reaches zero around age {analysis.depletionAge}</Badge>
          )}
        </div>
        <div className="mt-5 space-y-3">
          {analysis.annual.map((row) => (
            <div key={row.year} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 text-sm">
              <span className="num text-muted-foreground">{row.year}</span>
              <div className="h-7 overflow-hidden rounded-md bg-muted">
                <div
                  className="h-full rounded-md bg-foreground/70"
                  style={{ width: `${Math.max(2, (row.endingPortfolio / maxPortfolio) * 100)}%` }}
                  title={formatCad(row.endingPortfolio)}
                />
              </div>
              <span className="num w-28 text-right">{formatCad(row.endingPortfolio)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Withdrawal sources</h2>
          <p className="mt-1 text-sm text-muted-foreground">Actual modeled withdrawals recorded by the simulation engine.</p>
          <div className="mt-4 space-y-3">
            {[
              ["Registered", analysis.withdrawal.registered],
              ["TFSA", analysis.withdrawal.tfsa],
              ["Non-registered", analysis.withdrawal.nonRegistered],
              ["Portfolio cash", analysis.withdrawal.otherCash],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
                <span className="text-sm">{String(label)}</span>
                <span className="num font-semibold">{formatCad(Number(value))}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Total modeled withdrawals</p>
            <p className="num mt-1 text-lg font-semibold">{formatCad(analysis.withdrawal.total)}</p>
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Tax by year</h2>
          <p className="mt-1 text-sm text-muted-foreground">Annual tax liability generated by the simulation's tax ledger.</p>
          <div className="mt-4 space-y-3">
            {analysis.annual.map((row) => (
              <div key={row.year} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 text-sm">
                <span className="num text-muted-foreground">{row.year}</span>
                <div className="h-5 overflow-hidden rounded-md bg-muted">
                  <div
                    className="h-full rounded-md bg-foreground/50"
                    style={{ width: `${Math.max(2, (row.taxes / maxTax) * 100)}%` }}
                    title={formatCad(row.taxes)}
                  />
                </div>
                <span className="num w-28 text-right">{formatCad(row.taxes)}</span>
              </div>
            ))}
          </div>
          {analysis.peakTaxYear && (
            <p className="mt-4 text-xs text-muted-foreground">
              Highest modeled annual tax: {formatCad(analysis.peakTaxYear.taxes)} in {analysis.peakTaxYear.year}.
            </p>
          )}
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="font-display text-lg font-semibold">Annual cash flow</h2>
        <p className="mt-1 text-sm text-muted-foreground">This table separates spending, benefits, withdrawals, taxes and debt service.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">Year</th>
                <th className="pb-2 pr-4 text-right">Benefits</th>
                <th className="pb-2 pr-4 text-right">Withdrawals</th>
                <th className="pb-2 pr-4 text-right">Taxes</th>
                <th className="pb-2 pr-4 text-right">Spending</th>
                <th className="pb-2 pr-4 text-right">Debt payments</th>
                <th className="pb-2 text-right">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {analysis.annual.map((row) => (
                <tr key={row.year} className="border-b last:border-0">
                  <td className="py-3 pr-4 num">{row.year}</td>
                  <td className="py-3 pr-4 text-right num">{formatCad(row.benefits)}</td>
                  <td className="py-3 pr-4 text-right num">{formatCad(row.withdrawals)}</td>
                  <td className="py-3 pr-4 text-right num">{formatCad(row.taxes)}</td>
                  <td className="py-3 pr-4 text-right num">{formatCad(row.spending)}</td>
                  <td className="py-3 pr-4 text-right num">{formatCad(row.debtPayments)}</td>
                  <td className="py-3 text-right num">{formatCad(row.shortfall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="panel p-5">
          <h3 className="font-display font-semibold">Government benefits</h3>
          <p className="mt-2 text-sm text-muted-foreground">Lifetime modeled benefits total <span className="num font-medium text-foreground">{formatCad(result.metrics.totalBenefits)}</span>.</p>
          <div className="mt-4 space-y-2 text-sm">
            {[
              ["CPP / QPP", analysis.annual.reduce((sum, row) => sum + row.cpp, 0)],
              ["OAS", analysis.annual.reduce((sum, row) => sum + row.oas, 0)],
              ["GIS", analysis.annual.reduce((sum, row) => sum + row.gis, 0)],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between border-b pb-2 last:border-0">
                <span>{String(label)}</span><span className="num font-semibold">{formatCad(Number(value))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-5">
          <h3 className="font-display font-semibold">Debt</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {analysis.peakDebtYear
              ? `Peak modeled debt is ${formatCad(analysis.peakDebtYear.debt)} around ${analysis.peakDebtYear.year}.`
              : "No modeled debt balance remains in the simulation."}
          </p>
        </div>
        <div className="panel p-5">
          <h3 className="font-display font-semibold">Survivor & estate</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {analysis.survivor.begins
              ? `Survivor stage begins in ${yearOfAnalysisDate(analysis.survivor.begins)}; maximum modeled survivor shortfall is ${formatCad(analysis.survivor.maximumShortfall)}.`
              : "No survivor transition was modeled in this scenario."}
          </p>
          {analysis.estate.value !== undefined && (
            <p className="mt-2 text-sm text-muted-foreground">Modeled estate value: <span className="num font-medium text-foreground">{formatCad(analysis.estate.value)}</span>.</p>
          )}
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Calculation diagnostics</h2>
            <p className="mt-1 text-sm text-muted-foreground">Reconciliation checks run against every simulated month.</p>
          </div>
          <Badge variant={analysis.reconciliation.maxAbsoluteError <= 0.01 ? "outline" : "destructive"}>
            {analysis.reconciliation.maxAbsoluteError <= 0.01 ? "Reconciled" : "Review required"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Months checked" value={String(analysis.reconciliation.monthsChecked)} />
          <Metric label="Cash issues" value={String(analysis.reconciliation.cashIssues)} />
          <Metric label="Asset issues" value={String(analysis.reconciliation.assetIssues)} />
          <Metric label="Debt issues" value={String(analysis.reconciliation.debtIssues)} />
          <Metric label="Max error" value={analysis.reconciliation.maxAbsoluteError.toFixed(4)} />
        </div>
      </div>
    </div>
  );
}

function yearOfAnalysisDate(date: string): number {
  return new Date(date).getUTCFullYear();
}

function Reports({ result, scenario }: { result: SimulationResult | null; scenario: RetirementScenario | null }) {
  if (!result || !scenario) {
    return <ComingSoon title="Reports" text="Run a simulation to generate a readable retirement report and a detailed reproducibility export. The report preserves assumptions, rules version and engine version." />;
  }

  const report = buildRetirementReport(result, scenario);

  const downloadFile = (content: string, type: string, filename: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => downloadFile(
    serializeRetirementReport(report),
    "application/json",
    `retirement-report-${result.simulationId}.json`,
  );

  const downloadPrintable = () => downloadFile(
    buildPrintableRetirementReport(result, scenario),
    "text/html",
    `retirement-report-${result.simulationId}.html`,
  );

  return (
    <div className="space-y-5">
      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Retirement report</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Your modeled retirement plan</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A human-readable summary is provided alongside a detailed JSON export that preserves the scenario and reproducibility metadata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadJson}>Export detailed JSON</Button>
            <Button onClick={downloadPrintable}>Export printable report</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ending portfolio" value={formatCad(report.summary.endingPortfolio)} />
        <Metric label="Ending net worth" value={formatCad(report.summary.endingNetWorth)} />
        <Metric label="Lifetime spending" value={formatCad(report.summary.lifetimeSpending)} />
        <Metric label="Lifetime after-tax cash" value={formatCad(report.summary.lifetimeAfterTaxCash)} />
        <Metric label="Lifetime tax" value={formatCad(report.summary.lifetimeTax)} />
        <Metric label="Government benefits" value={formatCad(report.summary.totalBenefits)} />
        <Metric label="Maximum shortfall" value={formatCad(report.summary.maximumSpendingShortfall)} />
        <Metric label="Minimum portfolio" value={formatCad(report.summary.minimumPortfolio)} />
      </div>

      <div className="panel p-5">
        <h3 className="font-display text-lg font-semibold">Report metadata</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Status" value={report.status} />
          <Metric label="Engine" value={report.engineVersion} />
          <Metric label="Rules" value={report.rulesVersion} />
          <Metric label="Simulation" value={report.simulationId.slice(0, 16)} />
        </div>
      </div>

      {report.analysis && (
        <div className="panel p-5">
          <h3 className="font-display text-lg font-semibold">Annual analysis</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Year</th>
                  <th className="pb-2 pr-4">Ending portfolio</th>
                  <th className="pb-2 pr-4">Spending</th>
                  <th className="pb-2 pr-4">Taxes</th>
                  <th className="pb-2">Benefits</th>
                </tr>
              </thead>
              <tbody>
                {report.analysis.annual.map((row) => (
                  <tr key={row.year} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.year}</td>
                    <td className="py-2 pr-4 num">{formatCad(row.endingPortfolio)}</td>
                    <td className="py-2 pr-4 num">{formatCad(row.spending)}</td>
                    <td className="py-2 pr-4 num">{formatCad(row.taxes)}</td>
                    <td className="py-2 num">{formatCad(row.benefits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Model notes</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
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
