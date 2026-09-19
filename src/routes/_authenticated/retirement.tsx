import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarClock,
  Coins,
  Landmark,
  PiggyBank,
  ShieldCheck,
  Wallet,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile, type Profile } from "@/lib/profile";
import { formatCad, summariseAccount } from "@/lib/finance";
import {
  earliestRetirementAge,
  projectRetirement,
  cppPercentFromEarnings,
  oasFractionFromResidence,
  oasAt,
  CPP_MAX_MONTHLY_65,
  type PersonSpec,
  type PlannerInputs,
} from "@/lib/retirement";
import { PROVINCES, PROVINCE_CODES, type ProvinceCode } from "@/lib/tax";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/retirement")({
  head: () => ({
    meta: [
      { title: "Retirement Planner — MapleWealth" },
      {
        name: "description",
        content:
          "Canadian retirement planning with 2026 federal and provincial tax brackets, CPP from your earnings history, OAS from your years in Canada, RRIF minimums and a tax-efficient household withdrawal plan.",
      },
      { property: "og:title", content: "Retirement Planner — MapleWealth" },
      {
        property: "og:description",
        content:
          "Find out when you can retire and see a tax-efficient drawdown plan year by year, to age 95.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RetirementPage,
});

const TFSA_TYPES = ["TFSA"];
const RRSP_TYPES = ["RRSP", "Spousal RRSP"];
const LIRA_TYPES = ["LIRA", "LRSP"];
const FHSA_TYPES = ["FHSA"];
const NONREG_TYPES = ["Non-Registered", "Corporate"];
const RESP_TYPES = ["RESP"];
const RDSP_TYPES = ["RDSP"];

function num(v: string, fallback = 0) {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function RetirementPage() {
  const { accounts, holdings, transactions, quotes, fxUsdCad, loading } = usePortfolio();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();

  const { entitlement } = useEntitlement();
  const isPro = entitlement.tier !== "free";
  const [proPromptOpen, setProPromptOpen] = useState(false);
  const lockProps = isPro ? {} : { locked: true, onLocked: () => setProPromptOpen(true) };

  const [form, setForm] = useState<Profile | null>(null);
  /** Bounded income overshoot allowed above the effective ceiling, today's CAD. */
  const [clawbackTolerance, setClawbackTolerance] = useState(0);
  /** RESP/RDSP money counted as retirement savings only when switched on. */
  const [includeRespRdsp, setIncludeRespRdsp] = useState(false);



  useEffect(() => {
    if (profileQuery.data && !form) setForm(profileQuery.data);
  }, [profileQuery.data, form]);

  const byType = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const a of accounts) {
      const s = summariseAccount(
        a,
        transactions.filter((t) => t.account_id === a.id),
        holdings.filter((h) => h.account_id === a.id),
        quotes,
        fxUsdCad,
      );
      const value = s.marketValue + Math.max(0, s.cash);
      sums[a.account_type] = (sums[a.account_type] ?? 0) + value;
    }
    const pick = (types: string[]) => types.reduce((t, k) => t + (sums[k] ?? 0), 0);
    return {
      tfsa: pick(TFSA_TYPES),
      rrsp: pick(RRSP_TYPES),
      lira: pick(LIRA_TYPES),
      fhsa: pick(FHSA_TYPES),
      nonreg: pick(NONREG_TYPES),
      resp: pick(RESP_TYPES),
      rdsp: pick(RDSP_TYPES),
    };
  }, [accounts, transactions, holdings, quotes, fxUsdCad]);

  // Free plans run on the standard assumptions; saved values are kept untouched
  // so they come back the moment the plan is upgraded.
  const p: Profile | null = useMemo(() => {
    if (!form) return null;
    if (isPro) return form;
    return {
      ...form,
      target_retirement_age: 65,
      cpp_start_age: 65,
      oas_start_age: 65,
      inflation_rate: 2.5,
      growth_rate: 10,
      life_expectancy: 95,
      marital_status: "Single",
      manual_override: false,
      desired_income: form.desired_income ?? 60000,
    };
  }, [form, isPro]);

  const balances = useMemo(() => {
    // RESP/RDSP are earmarked for education and disability support, so they are
    // left out of retirement income unless the user opts them in.
    const extra = includeRespRdsp ? byType.resp + byType.rdsp : 0;
    if (p?.manual_override) {
      return {
        tfsa: p.override_tfsa ?? 0,
        rrsp: (p.override_rrsp ?? 0) + (p.override_fhsa ?? 0),
        lira: p.override_lira ?? 0,
        nonreg: (p.override_nonreg ?? 0) + extra,
      };
    }
    return {
      tfsa: byType.tfsa,
      rrsp: byType.rrsp + byType.fhsa,
      lira: byType.lira,
      nonreg: byType.nonreg + extra,
    };
  }, [p, byType, includeRespRdsp]);

  const derived = useMemo(() => {
    if (!p) return null;
    const currentAge = p.current_age ?? 40;
    const retireAge = p.target_retirement_age ?? 65;
    const selfPct = cppPercentFromEarnings({
      pastAverageIncome: p.cpp_avg_income ?? 0,
      yearsWorked: p.cpp_years_worked ?? 0,
      futureIncome: p.cpp_future_income ?? 0,
      futureYears: Math.max(0, Math.min(retireAge, 65) - currentAge),
    });
    const spouseAge = p.spouse_age ?? currentAge;
    const spouseRetire = p.spouse_retirement_age ?? retireAge;
    const spousePct = cppPercentFromEarnings({
      pastAverageIncome: p.spouse_cpp_avg_income ?? 0,
      yearsWorked: p.spouse_cpp_years_worked ?? 0,
      futureIncome: p.spouse_cpp_future_income ?? 0,
      futureYears: Math.max(0, Math.min(spouseRetire, 65) - spouseAge),
    });
    const annual = (pct: number) => (CPP_MAX_MONTHLY_65 * 12 * pct) / 100;
    return {
      selfPct,
      spousePct,
      selfCpp65: annual(selfPct),
      spouseCpp65: annual(spousePct),
      selfOasFraction: oasFractionFromResidence(p.oas_years_in_canada ?? 40),
      spouseOasFraction: oasFractionFromResidence(p.spouse_oas_years_in_canada ?? 40),
    };
  }, [p]);

  const inputs: PlannerInputs | null = useMemo(() => {
    if (!p || !derived) return null;
    const province = (PROVINCE_CODES as string[]).includes(p.province ?? "")
      ? (p.province as ProvinceCode)
      : "AB";
    const married = (p.marital_status ?? "Single") !== "Single";
    const currentAge = p.current_age ?? 40;
    const retireAge = p.target_retirement_age ?? 65;

    const self: PersonSpec = {
      label: "You",
      age: currentAge,
      retirementAge: retireAge,
      cppStartAge: p.cpp_start_age ?? 65,
      cppAt65: derived.selfCpp65,
      oasStartAge: p.oas_start_age ?? 65,
      oasFraction: derived.selfOasFraction,
      otherIncome: 0,
      balances: { ...balances },
      nonregGainRatio: 0.4,
    };

    const spouse: PersonSpec | null = married
      ? {
          label: "Spouse",
          age: p.spouse_age ?? currentAge,
          retirementAge: p.spouse_retirement_age ?? retireAge,
          cppStartAge: p.spouse_cpp_start_age ?? 65,
          cppAt65: derived.spouseCpp65,
          oasStartAge: p.spouse_oas_start_age ?? 65,
          oasFraction: derived.spouseOasFraction,
          otherIncome: p.spouse_income ?? 0,
          balances: {
            tfsa: p.spouse_tfsa ?? 0,
            rrsp: p.spouse_rrsp ?? 0,
            lira: p.spouse_lira ?? 0,
            nonreg: p.spouse_nonreg ?? 0,
          },
          nonregGainRatio: 0.4,
        }
      : null;

    return {
      retirementAge: retireAge,
      lifeExpectancy: p.life_expectancy ?? 95,
      province,
      inflation: p.inflation_rate ?? 2.5,
      growth: p.growth_rate ?? 6,
      desiredIncome: p.desired_income ?? 60000,
      annualSavings: p.annual_savings ?? 0,
      savingsSplit: {
        tfsa: p.save_pct_tfsa ?? 40,
        rrsp: p.save_pct_rrsp ?? 40,
        nonreg: p.save_pct_nonreg ?? 20,
      },
      clawbackTolerance,
      self,
      spouse,
    };
  }, [p, derived, balances, clawbackTolerance]);

  const projection = useMemo(() => (inputs ? projectRetirement(inputs) : null), [inputs]);
  const earliest = useMemo(() => (inputs ? earliestRetirementAge(inputs) : null), [inputs]);

  if (loading || profileQuery.isLoading || !p || !inputs || !projection || !derived) {
    return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  }

  const set = (patch: Partial<Profile>) => setForm({ ...(form ?? p), ...patch });
  const married = (p.marital_status ?? "Single") !== "Single";

  const save = () => {
    const { id: _id, display_name: _dn, base_currency: _bc, ...rest } = p;
    updateProfile.mutate(rest as Partial<Profile>, {
      onSuccess: () => toast.success("Plan saved"),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  // The engine models everything in 2026 dollars, so rows need no deflation.
  const rows = projection.rows;
  const totalTaxes = rows.reduce((t, r) => t + r.taxes, 0);
  const totalClawback = rows.reduce((t, r) => t + r.oasClawback, 0);
  const endingBalance = rows.length ? rows[rows.length - 1]!.balances.total : 0;
  const moneyNote = "in today's dollars";
  const firstRow = rows[0];

  const startBalance = firstRow
    ? firstRow.balances.total +
      firstRow.rrifDraw +
      firstRow.lifDraw +
      firstRow.nonregDraw +
      firstRow.tfsaDraw
    : 0;
  const clawbackYears = rows.filter((r) => r.oasClawback > 1);
  const todayTotal =
    balances.tfsa +
    balances.rrsp +
    balances.lira +
    balances.nonreg +
    (married ? (p.spouse_tfsa ?? 0) + (p.spouse_rrsp ?? 0) + (p.spouse_lira ?? 0) + (p.spouse_nonreg ?? 0) : 0);

  const balanceChart = rows.map((r) => ({
    age: r.age,
    TFSA: Math.round(r.balances.tfsa),
    "RRSP / RRIF": Math.round(r.balances.rrsp),
    "LIRA / LIF": Math.round(r.balances.lira),
    "Non-Registered": Math.round(r.balances.nonreg),
  }));

  const incomeChart = rows.map((r) => ({
    age: r.age,
    CPP: Math.round(r.cpp),
    OAS: Math.round(r.oas),
    "RRIF / LIF": Math.round(r.rrifDraw + r.lifDraw),
    "Non-Reg": Math.round(r.nonregDraw),
    TFSA: Math.round(r.tfsaDraw),
    Taxes: -Math.round(r.taxes),
    Spending: Math.round(r.spending),
  }));

  const selfOas = oasAt(p.oas_start_age ?? 65, derived.selfOasFraction);
  const spouseOas = married ? oasAt(p.spouse_oas_start_age ?? 65, derived.spouseOasFraction) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Retirement planner</h1>
          <p className="text-sm text-muted-foreground">
            {married ? "Household plan" : "Personal plan"} on 2026 federal and{" "}
            {PROVINCES[inputs.province].name} tax rates, with CPP from your earnings history and OAS
            from your years in Canada.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={save} disabled={updateProfile.isPending}>
            {updateProfile.isPending ? "Saving…" : "Save plan"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Earliest sustainable retirement"
          value={earliest ? `Age ${earliest}` : "Not before 80"}
          hint={
            earliest && earliest <= inputs.retirementAge
              ? `Your target of ${inputs.retirementAge} works`
              : `Your target of ${inputs.retirementAge} runs short`
          }
          tone={earliest && earliest <= inputs.retirementAge ? "good" : "warn"}
        />
        <StatCard
          icon={<PiggyBank className="h-4 w-4" />}
          label="Savings at retirement"
          value={formatCad(startBalance)}
          hint={`Today: ${formatCad(todayTotal)} · ${moneyNote}`}
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Plan outcome"
          value={projection.success ? "Fully funded" : `Runs short at ${projection.depletionAge}`}
          hint={`Ending balance ${formatCad(endingBalance)} ${moneyNote}`}
          tone={projection.success ? "good" : "warn"}
        />
        <StatCard
          icon={<TriangleAlert className="h-4 w-4" />}
          label="Lifetime tax & clawback"
          value={formatCad(totalTaxes)}
          hint={
            totalClawback > 1
              ? `${formatCad(totalClawback)} of OAS clawed back over ${clawbackYears.length} years`
              : "No OAS clawback in this plan"
          }
          tone={totalClawback > 1 ? "warn" : "good"}
        />

      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatCard
          icon={<Landmark className="h-4 w-4" />}
          label="Tax owed by your estate"
          value={formatCad(projection.estateTax)}
          hint={`${formatCad(projection.estateRegistered)} left in RRIF/LIF at ${inputs.lifeExpectancy} is fully taxed in that year`}
          tone={projection.estateTax > 1 ? "warn" : "good"}
        />
        <div className="panel space-y-2 p-4">
          <Label className="text-xs text-muted-foreground">
            Income cliff and acceptable overshoot
          </Label>
          <p className="text-sm text-muted-foreground">
            Withdrawals stop at {formatCad(firstRow?.effectiveCeiling ?? 0)} of taxable income — the
            lower of the OAS clawback line and the age-credit clawback ceiling.{" "}
            {rows.some((r) => r.meltdownFlag)
              ? "Forced withdrawals after 71 will breach that line anyway, so an early melt-down is worth it."
              : "Forced withdrawals after 71 stay under that line."}
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="max-w-[10rem]"
              value={clawbackTolerance}
              onChange={(e) => setClawbackTolerance(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="text-xs text-muted-foreground">
              extra taxable income allowed above the cliff in melt-down years
            </span>
          </div>
        </div>
      </div>


      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">The plan</TabsTrigger>
          <TabsTrigger value="inputs">Your details</TabsTrigger>
          <TabsTrigger value="schedule">Year-by-year</TabsTrigger>
        </TabsList>

        {/* --------------------------------- PLAN --------------------------------- */}
        <TabsContent value="plan" className="space-y-6 pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <BenefitCard
              title="Your government benefits"
              cppPct={derived.selfPct}
              cppStart={p.cpp_start_age ?? 65}
              cppAnnual={(CPP_MAX_MONTHLY_65 * 12 * derived.selfPct) / 100}
              oasStart={p.oas_start_age ?? 65}
              oasAnnual={selfOas}
              oasYears={p.oas_years_in_canada ?? 40}
            />
            {married ? (
              <BenefitCard
                title="Spouse government benefits"
                cppPct={derived.spousePct}
                cppStart={p.spouse_cpp_start_age ?? 65}
                cppAnnual={(CPP_MAX_MONTHLY_65 * 12 * derived.spousePct) / 100}
                oasStart={p.spouse_oas_start_age ?? 65}
                oasAnnual={spouseOas}
                oasYears={p.spouse_oas_years_in_canada ?? 40}
              />
            ) : (
              <div className="panel space-y-2 p-5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2 text-foreground">
                  <Landmark className="h-4 w-4" /> Single plan
                </div>
                <p>
                  Set your marital status to married or common-law under “Your details” to plan both
                  CPP and OAS entitlements together and use pension splitting after 65.
                </p>
              </div>
            )}
            <div className="panel space-y-2 p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Coins className="h-4 w-4" /> How the money is drawn
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li>1. RRIF and LIF minimums once you turn 71.</li>
                <li>
                  2. Extra RRSP/LIRA income taken early and evenly, kept inside the low brackets and
                  under the OAS clawback line, so forced withdrawals later stay small.
                </li>
                <li>3. Non-registered next, with only the gain portion taxed.</li>
                <li>4. TFSA tops up the rest — tax-free and invisible to the clawback.</li>
              </ul>
            </div>
          </div>

          <div className="panel space-y-3 p-5">
            <div>
              <h2 className="font-display text-lg font-semibold">Where your income comes from</h2>
              <p className="text-sm text-muted-foreground">
                Each bar is a retirement year: benefits and withdrawals stacked against the spending
                line, with tax shown below the axis. Amounts {moneyNote}.
              </p>

            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={incomeChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="age" tickLine={false} fontSize={12} />
                  <YAxis
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                    tickLine={false}
                    fontSize={12}
                  />
                  <Tooltip formatter={(v: number) => formatCad(Math.abs(v))} />
                  <Legend />
                  <Bar dataKey="CPP" stackId="i" fill="var(--chart-1)" />
                  <Bar dataKey="OAS" stackId="i" fill="var(--chart-2)" />
                  <Bar dataKey="RRIF / LIF" stackId="i" fill="var(--chart-3)" />
                  <Bar dataKey="Non-Reg" stackId="i" fill="var(--chart-4)" />
                  <Bar dataKey="TFSA" stackId="i" fill="var(--chart-5)" />
                  <Bar dataKey="Taxes" stackId="i" fill="var(--destructive)" />

                  <Line
                    type="monotone"
                    dataKey="Spending"
                    stroke="var(--foreground)"
                    dot={false}
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel space-y-3 p-5">
            <div>
              <h2 className="font-display text-lg font-semibold">What is left each year</h2>
              <p className="text-sm text-muted-foreground">
                Balances by account type from age {inputs.retirementAge} to {inputs.lifeExpectancy},
                using a real return of{" "}
                {(((1 + inputs.growth / 100) / (1 + inputs.inflation / 100) - 1) * 100).toFixed(2)}%
                ({inputs.growth}% growth less {inputs.inflation}% inflation). Amounts {moneyNote}.
              </p>

            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={balanceChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="age" tickLine={false} fontSize={12} />
                  <YAxis
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                    tickLine={false}
                    fontSize={12}
                  />
                  <Tooltip formatter={(v: number) => formatCad(v)} />
                  <Legend />
                  {(
                    [
                      ["RRSP / RRIF", "var(--chart-1)"],
                      ["LIRA / LIF", "var(--chart-2)"],
                      ["TFSA", "var(--chart-3)"],
                      ["Non-Registered", "var(--chart-4)"],
                    ] as const
                  ).map(([key, color]) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stackId="1"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.45}
                    />
                  ))}

                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        {/* -------------------------------- INPUTS -------------------------------- */}
        <TabsContent value="inputs" className="space-y-6 pt-4">
          <Section
            title="About you"
            subtitle="The basics that set the length and shape of the plan."
          >
            <Field label="Your age">
              <Input
                type="number"
                value={p.current_age ?? ""}
                onChange={(e) => set({ current_age: num(e.target.value, 40) })}
              />
            </Field>
            <Field label="Target retirement age" {...lockProps}>
              <Input
                type="number"
                value={p.target_retirement_age ?? ""}
                onChange={(e) => set({ target_retirement_age: num(e.target.value, 65) })}
              />
            </Field>
            <Field label="Desired after-tax household income (today's $)">
              <Input
                type="number"
                value={p.desired_income ?? 0}
                onChange={(e) => set({ desired_income: num(e.target.value) })}
              />
            </Field>
            <Field label="Province">
              <Select value={inputs.province} onValueChange={(v) => set({ province: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCE_CODES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {PROVINCES[c].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Inflation %" {...lockProps}>
              <Input
                type="number"
                step="0.1"
                value={p.inflation_rate ?? 2.5}
                onChange={(e) => set({ inflation_rate: num(e.target.value, 2.5) })}
              />
            </Field>
            <Field label="Growth %" {...lockProps}>
              <Input
                type="number"
                step="0.1"
                value={p.growth_rate ?? 6}
                onChange={(e) => set({ growth_rate: num(e.target.value, 6) })}
              />
            </Field>
            <Field label="Life expectancy" {...lockProps}>
              <Input
                type="number"
                value={p.life_expectancy ?? 95}
                onChange={(e) => set({ life_expectancy: num(e.target.value, 95) })}
              />
            </Field>
            <Field label="Marital status" {...lockProps}>
              <Select
                value={p.marital_status ?? "Single"}
                onValueChange={(v) => set({ marital_status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Single">Single</SelectItem>
                  <SelectItem value="Married">Married / common-law</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section
            title="Your earnings history — this sets your CPP"
            subtitle={`We credit each year at your income divided by the yearly maximum, over the best 39 years. Estimated entitlement: ${derived.selfPct}% of the maximum.`}
          >
            <Field label="Typical income in past working years (today's $)">
              <Input
                type="number"
                value={p.cpp_avg_income ?? 0}
                onChange={(e) => set({ cpp_avg_income: num(e.target.value) })}
              />
            </Field>
            <Field label="Years worked in Canada so far">
              <Input
                type="number"
                value={p.cpp_years_worked ?? 0}
                onChange={(e) => set({ cpp_years_worked: num(e.target.value) })}
              />
            </Field>
            <Field label="Expected income until retirement (today's $)">
              <Input
                type="number"
                value={p.cpp_future_income ?? 0}
                onChange={(e) => set({ cpp_future_income: num(e.target.value) })}
              />
            </Field>
            <Field label="CPP start age (60–70)" {...lockProps}>
              <Input
                type="number"
                value={p.cpp_start_age ?? 65}
                onChange={(e) =>
                  set({ cpp_start_age: Math.min(70, Math.max(60, num(e.target.value, 65))) })
                }
              />
            </Field>
            <Field label="Years living in Canada after age 18 (sets OAS)">
              <Input
                type="number"
                value={p.oas_years_in_canada ?? 40}
                onChange={(e) => set({ oas_years_in_canada: num(e.target.value, 40) })}
              />
            </Field>
            <Field label="OAS start age (65–70)" {...lockProps}>
              <Input
                type="number"
                value={p.oas_start_age ?? 65}
                onChange={(e) =>
                  set({ oas_start_age: Math.min(70, Math.max(65, num(e.target.value, 65))) })
                }
              />
            </Field>
          </Section>

          <Section
            title="Saving until retirement"
            subtitle="Where each dollar you save lands changes the tax you pay later."
          >
            <Field label="Annual savings (today's $)">
              <Input
                type="number"
                value={p.annual_savings ?? 0}
                onChange={(e) => set({ annual_savings: num(e.target.value) })}
              />
            </Field>
            <Field label="% to TFSA">
              <Input
                type="number"
                value={p.save_pct_tfsa ?? 40}
                onChange={(e) => set({ save_pct_tfsa: num(e.target.value) })}
              />
            </Field>
            <Field label="% to RRSP / FHSA">
              <Input
                type="number"
                value={p.save_pct_rrsp ?? 40}
                onChange={(e) => set({ save_pct_rrsp: num(e.target.value) })}
              />
            </Field>
            <Field label="% to non-registered">
              <Input
                type="number"
                value={p.save_pct_nonreg ?? 20}
                onChange={(e) => set({ save_pct_nonreg: num(e.target.value) })}
              />
            </Field>
            <p className="col-span-full text-xs text-muted-foreground">
              Splits are normalised, so they do not have to add to exactly 100. Today they total{" "}
              {(p.save_pct_tfsa ?? 0) + (p.save_pct_rrsp ?? 0) + (p.save_pct_nonreg ?? 0)}%.
            </p>
          </Section>

          {married && (
            <Section
              title="Your spouse"
              subtitle={`Their CPP and OAS count towards the household income. Estimated CPP entitlement: ${derived.spousePct}% of the maximum.`}
            >
              <Field label="Spouse age">
                <Input
                  type="number"
                  value={p.spouse_age ?? ""}
                  onChange={(e) => set({ spouse_age: num(e.target.value, 40) })}
                />
              </Field>
              <Field label="Spouse retirement age">
                <Input
                  type="number"
                  value={p.spouse_retirement_age ?? ""}
                  onChange={(e) => set({ spouse_retirement_age: num(e.target.value, 65) })}
                />
              </Field>
              <Field label="Spouse typical past income (today's $)">
                <Input
                  type="number"
                  value={p.spouse_cpp_avg_income ?? 0}
                  onChange={(e) => set({ spouse_cpp_avg_income: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse years worked so far">
                <Input
                  type="number"
                  value={p.spouse_cpp_years_worked ?? 0}
                  onChange={(e) => set({ spouse_cpp_years_worked: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse expected income until retirement">
                <Input
                  type="number"
                  value={p.spouse_cpp_future_income ?? 0}
                  onChange={(e) => set({ spouse_cpp_future_income: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse years in Canada after 18">
                <Input
                  type="number"
                  value={p.spouse_oas_years_in_canada ?? 40}
                  onChange={(e) => set({ spouse_oas_years_in_canada: num(e.target.value, 40) })}
                />
              </Field>
              <Field label="Spouse CPP start age">
                <Input
                  type="number"
                  value={p.spouse_cpp_start_age ?? 65}
                  onChange={(e) =>
                    set({
                      spouse_cpp_start_age: Math.min(70, Math.max(60, num(e.target.value, 65))),
                    })
                  }
                />
              </Field>
              <Field label="Spouse OAS start age">
                <Input
                  type="number"
                  value={p.spouse_oas_start_age ?? 65}
                  onChange={(e) =>
                    set({
                      spouse_oas_start_age: Math.min(70, Math.max(65, num(e.target.value, 65))),
                    })
                  }
                />
              </Field>
              <Field label="Spouse RRSP">
                <Input
                  type="number"
                  value={p.spouse_rrsp ?? 0}
                  onChange={(e) => set({ spouse_rrsp: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse LIRA / LIF">
                <Input
                  type="number"
                  value={p.spouse_lira ?? 0}
                  onChange={(e) => set({ spouse_lira: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse TFSA">
                <Input
                  type="number"
                  value={p.spouse_tfsa ?? 0}
                  onChange={(e) => set({ spouse_tfsa: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse non-registered">
                <Input
                  type="number"
                  value={p.spouse_nonreg ?? 0}
                  onChange={(e) => set({ spouse_nonreg: num(e.target.value) })}
                />
              </Field>
              <Field label="Spouse other pension income in retirement">
                <Input
                  type="number"
                  value={p.spouse_income ?? 0}
                  onChange={(e) => set({ spouse_income: num(e.target.value) })}
                />
              </Field>
            </Section>
          )}

          <div className="panel space-y-4 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Manual override mode</p>
                <p className="text-xs text-muted-foreground">
                  Off: your balances sync from your accounts. On: type your own numbers.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isPro ? null : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Lock className="h-2.5 w-2.5" />
                    Pro
                  </span>
                )}
                <Switch
                  checked={p.manual_override ?? false}
                  onCheckedChange={(v) => {
                    if (!isPro) {
                      setProPromptOpen(true);
                      return;
                    }
                    set({ manual_override: v });
                  }}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  ["TFSA", "override_tfsa", byType.tfsa],
                  ["RRSP", "override_rrsp", byType.rrsp],
                  ["LIRA / LRSP", "override_lira", byType.lira],
                  ["FHSA", "override_fhsa", byType.fhsa],
                  ["Non-Registered", "override_nonreg", byType.nonreg],
                ] as const
              ).map(([label, key, synced]) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    disabled={!p.manual_override}
                    value={p.manual_override ? ((p[key] as number) ?? 0) : Math.round(synced)}
                    onChange={(e) => set({ [key]: num(e.target.value) } as Partial<Profile>)}
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className="panel space-y-3 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Count RESP and RDSP money too</p>
                <p className="text-xs text-muted-foreground">
                  These are not retirement income — an RESP is for a child's education and an
                  RDSP for disability support — so they are left out by default.
                </p>
              </div>
              <Switch checked={includeRespRdsp} onCheckedChange={setIncludeRespRdsp} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="RESP balance">
                <Input type="number" disabled value={Math.round(byType.resp)} />
              </Field>
              <Field label="RDSP balance">
                <Input type="number" disabled value={Math.round(byType.rdsp)} />
              </Field>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </TabsContent>

        {/* ------------------------------- SCHEDULE ------------------------------- */}
        <TabsContent value="schedule" className="space-y-4 pt-4">
          <div className="panel space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold">Tax-efficient withdrawal plan</h2>
                <p className="text-sm text-muted-foreground">
                  {married ? "Household totals" : "Your withdrawals"}, year by year. Rows in red fall
                  short of the spending target; amber rows lose some OAS to the clawback.
                </p>
              </div>
              {projection.totalClawback > 1 ? (
                <Badge variant="outline" className="border-amber-500 text-amber-600">
                  {formatCad(projection.totalClawback)} OAS clawed back
                </Badge>
              ) : (
                <Badge variant="outline">No OAS clawback</Badge>
              )}
            </div>
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Age</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead className="text-right">RRSP / RRIF</TableHead>
                    <TableHead className="text-right">LIRA / LIF</TableHead>
                    <TableHead className="text-right">Non-Reg</TableHead>
                    <TableHead className="text-right">TFSA</TableHead>
                    <TableHead className="text-right">CPP</TableHead>
                    <TableHead className="text-right">OAS (net)</TableHead>
                    <TableHead className="text-right">Clawback</TableHead>
                    <TableHead className="text-right">Taxes</TableHead>
                    <TableHead className="text-right">Spending</TableHead>
                    <TableHead className="text-right">Ending balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.age}
                      className={
                        r.shortfall > 1
                          ? "bg-destructive/10"
                          : r.oasClawback > 1
                            ? "bg-amber-500/10"
                            : undefined
                      }
                    >
                      <TableCell className="num">{r.age}</TableCell>
                      <TableCell className="num text-muted-foreground">{r.year}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.rrifDraw)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.lifDraw)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.nonregDraw)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.tfsaDraw)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.cpp)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.oas)}</TableCell>
                      <TableCell className="num text-right">
                        {r.oasClawback > 1 ? formatCad(r.oasClawback) : "—"}
                      </TableCell>
                      <TableCell className="num text-right">{formatCad(r.taxes)}</TableCell>
                      <TableCell className="num text-right">{formatCad(r.spending)}</TableCell>
                      <TableCell className="num text-right">
                        {formatCad(r.balances.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              All amounts {moneyNote}. Planning estimates on projected 2026 tax brackets. RRSPs
              become a RRIF and LIRAs a LIF

              at 71 with the mandatory minimums; eligible pension income is split with a spouse after
              65 wherever that lowers household tax.
            </p>
          </div>

          {married && (
            <div className="panel space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">Split between you and your spouse</h2>
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Year</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead className="text-right">Registered draw</TableHead>
                      <TableHead className="text-right">Non-Reg</TableHead>
                      <TableHead className="text-right">TFSA</TableHead>
                      <TableHead className="text-right">CPP + OAS</TableHead>
                      <TableHead className="text-right">Taxable income</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.flatMap((r) =>
                      r.people.map((x) => (
                        <TableRow key={`${r.age}-${x.label}`}>
                          <TableCell className="num text-muted-foreground">{r.year}</TableCell>
                          <TableCell>{x.label}</TableCell>
                          <TableCell className="num">{x.age}</TableCell>
                          <TableCell className="num text-right">
                            {formatCad(x.rrifDraw + x.lifDraw)}
                          </TableCell>
                          <TableCell className="num text-right">{formatCad(x.nonregDraw)}</TableCell>
                          <TableCell className="num text-right">{formatCad(x.tfsaDraw)}</TableCell>
                          <TableCell className="num text-right">
                            {formatCad(x.cpp + x.oas)}
                          </TableCell>
                          <TableCell className="num text-right">
                            {formatCad(x.taxableIncome)}
                          </TableCell>
                          <TableCell className="num text-right">{formatCad(x.taxes)}</TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  locked = false,
  onLocked,
}: {
  label: string;
  children: React.ReactNode;
  locked?: boolean;
  onLocked?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {locked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <Lock className="h-2.5 w-2.5" />
            Pro
          </span>
        ) : null}
      </Label>
      {locked ? (
        <button
          type="button"
          className="w-full text-left"
          title="Upgrade to Pro to change this"
          onClick={onLocked}
        >
          <div className="pointer-events-none opacity-60">{children}</div>
        </button>
      ) : (
        children
      )}
    </div>
  );
}

function BenefitCard({
  title,
  cppPct,
  cppStart,
  cppAnnual,
  oasStart,
  oasAnnual,
  oasYears,
}: {
  title: string;
  cppPct: number;
  cppStart: number;
  cppAnnual: number;
  oasStart: number;
  oasAnnual: number;
  oasYears: number;
}) {
  return (
    <div className="panel space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Wallet className="h-4 w-4" /> {title}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">CPP from age {cppStart}</span>
          <span className="num font-semibold">{formatCad(cppAnnual)}/yr</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {cppPct}% of the maximum, from the earnings history entered.
        </p>
        <div className="flex items-baseline justify-between pt-2">
          <span className="text-muted-foreground">OAS from age {oasStart}</span>
          <span className="num font-semibold">{formatCad(oasAnnual)}/yr</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {Math.min(40, Math.max(0, oasYears))} of 40 years of Canadian residence.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={`num mt-2 text-xl font-semibold ${
          tone === "warn" ? "text-destructive" : tone === "good" ? "text-emerald-600" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
