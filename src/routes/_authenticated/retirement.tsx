import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, PiggyBank, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile, type Profile } from "@/lib/profile";
import { formatCad, summariseAccount } from "@/lib/finance";
import {
  earliestRetirementAge,
  projectRetirement,
  cppAt,
  oasAt,
  type PlannerInputs,
} from "@/lib/retirement";
import { PROVINCES, PROVINCE_CODES, type ProvinceCode } from "@/lib/tax";
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
          "Canadian retirement planning with 2026 federal and provincial tax brackets, CPP and OAS timing, RRIF minimums, LIF maximums and a tax-efficient year-by-year withdrawal plan.",
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

function num(v: string, fallback = 0) {
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function RetirementPage() {
  const { accounts, holdings, transactions, quotes, fxUsdCad, loading } = usePortfolio();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();

  const [form, setForm] = useState<Partial<Profile> | null>(null);
  const [annualSavings, setAnnualSavings] = useState(12000);

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
      sums[a.account_type] = (sums[a.account_type] ?? 0) + s.totalValue;
    }
    const pick = (types: string[]) => types.reduce((t, k) => t + (sums[k] ?? 0), 0);
    return {
      tfsa: pick(TFSA_TYPES),
      rrsp: pick(RRSP_TYPES),
      lira: pick(LIRA_TYPES),
      fhsa: pick(FHSA_TYPES),
      nonreg: pick(NONREG_TYPES),
    };
  }, [accounts, transactions, holdings, quotes, fxUsdCad]);

  const p = form;

  const balances = useMemo(() => {
    if (p?.manual_override) {
      return {
        tfsa: p.override_tfsa ?? 0,
        rrsp: (p.override_rrsp ?? 0) + (p.override_fhsa ?? 0),
        lira: p.override_lira ?? 0,
        nonreg: p.override_nonreg ?? 0,
      };
    }
    return {
      tfsa: byType.tfsa,
      rrsp: byType.rrsp + byType.fhsa,
      lira: byType.lira,
      nonreg: byType.nonreg,
    };
  }, [p, byType]);

  const inputs: PlannerInputs | null = useMemo(() => {
    if (!p) return null;
    const province = (PROVINCE_CODES as string[]).includes(p.province ?? "")
      ? (p.province as ProvinceCode)
      : "AB";
    return {
      currentAge: p.current_age ?? 40,
      retirementAge: p.target_retirement_age ?? 65,
      lifeExpectancy: p.life_expectancy ?? 95,
      province,
      inflation: p.inflation_rate ?? 2.5,
      growth: p.growth_rate ?? 6,
      desiredIncome: p.desired_income ?? 70000,
      annualSavings,
      cppStartAge: p.cpp_start_age ?? 65,
      cppPct: p.cpp_pct ?? 75,
      oasStartAge: p.oas_start_age ?? 65,
      married: (p.marital_status ?? "Single") !== "Single",
      spouseAge: p.spouse_age ?? null,
      spouseRrsp: p.spouse_rrsp ?? 0,
      spouseTfsa: p.spouse_tfsa ?? 0,
      spouseIncome: p.spouse_income ?? 0,
      balances,
      nonregGainRatio: 0.4,
    };
  }, [p, balances, annualSavings]);

  const projection = useMemo(() => (inputs ? projectRetirement(inputs) : null), [inputs]);
  const earliest = useMemo(() => (inputs ? earliestRetirementAge(inputs) : null), [inputs]);

  if (loading || profileQuery.isLoading || !p || !inputs || !projection) {
    return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  }

  const set = (patch: Partial<Profile>) => setForm({ ...p, ...patch });

  const chartData = projection.rows.map((r) => ({
    age: r.age,
    TFSA: Math.round(r.balances.tfsa),
    "RRSP / RRIF": Math.round(r.balances.rrsp),
    "LIRA / LIF": Math.round(r.balances.lira),
    "Non-Registered": Math.round(r.balances.nonreg),
  }));

  const firstRow = projection.rows[0];
  const cppAnnual = cppAt(inputs.cppStartAge, inputs.cppPct);
  const oasAnnual = oasAt(inputs.oasStartAge);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Retirement planner</h1>
        <p className="text-sm text-muted-foreground">
          2026 federal and {PROVINCES[inputs.province].name} tax rates, CPP and OAS timing, RRIF
          minimums and LIF maximums, with a tax-efficient drawdown to age {inputs.lifeExpectancy}.
        </p>
      </div>

      {/* Headline cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Earliest sustainable retirement"
          value={earliest ? `Age ${earliest}` : "Not before 80"}
          hint={
            earliest && earliest <= inputs.retirementAge
              ? `Your target of ${inputs.retirementAge} works`
              : `Your target of ${inputs.retirementAge} runs out of money`
          }
        />
        <StatCard
          icon={<PiggyBank className="h-4 w-4" />}
          label="Savings at retirement"
          value={formatCad(
            firstRow
              ? firstRow.balances.total +
                  firstRow.rrifDraw +
                  firstRow.lifDraw +
                  firstRow.nonregDraw +
                  firstRow.tfsaDraw
              : 0,
          )}
          hint={`Today: ${formatCad(
            balances.tfsa + balances.rrsp + balances.lira + balances.nonreg,
          )}`}
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Plan outcome"
          value={projection.success ? "Fully funded" : `Runs short at ${projection.depletionAge}`}
          hint={`Ending balance ${formatCad(projection.endingBalance)}`}
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Government benefits"
          value={formatCad(cppAnnual + oasAnnual)}
          hint={`CPP ${formatCad(cppAnnual)} at ${inputs.cppStartAge} · OAS ${formatCad(
            oasAnnual,
          )} at ${inputs.oasStartAge}`}
        />
      </div>

      {/* Inputs */}
      <div className="panel space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Your assumptions</h2>
          <Button
            size="sm"
            onClick={() => {
              updateProfile.mutate(
                {
                  province: p.province,
                  current_age: p.current_age,
                  target_retirement_age: p.target_retirement_age,
                  life_expectancy: p.life_expectancy,
                  inflation_rate: p.inflation_rate,
                  growth_rate: p.growth_rate,
                  desired_income: p.desired_income,
                  cpp_start_age: p.cpp_start_age,
                  cpp_pct: p.cpp_pct,
                  oas_start_age: p.oas_start_age,
                  marital_status: p.marital_status,
                  spouse_age: p.spouse_age,
                  spouse_rrsp: p.spouse_rrsp,
                  spouse_tfsa: p.spouse_tfsa,
                  spouse_income: p.spouse_income,
                  manual_override: p.manual_override,
                  override_tfsa: p.override_tfsa,
                  override_rrsp: p.override_rrsp,
                  override_lira: p.override_lira,
                  override_fhsa: p.override_fhsa,
                  override_nonreg: p.override_nonreg,
                },
                {
                  onSuccess: () => toast.success("Assumptions saved"),
                  onError: (e) => toast.error((e as Error).message),
                },
              );
            }}
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending ? "Saving…" : "Save"}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Your age">
            <Input
              type="number"
              value={p.current_age ?? ""}
              onChange={(e) => set({ current_age: num(e.target.value, 40) })}
            />
          </Field>
          <Field label="Target retirement age">
            <Input
              type="number"
              value={p.target_retirement_age ?? ""}
              onChange={(e) => set({ target_retirement_age: num(e.target.value, 65) })}
            />
          </Field>
          <Field label="Desired after-tax income (today's $)">
            <Input
              type="number"
              value={p.desired_income ?? 0}
              onChange={(e) => set({ desired_income: num(e.target.value) })}
            />
          </Field>
          <Field label="Annual savings until retirement">
            <Input
              type="number"
              value={annualSavings}
              onChange={(e) => setAnnualSavings(num(e.target.value))}
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
          <Field label="Inflation %">
            <Input
              type="number"
              step="0.1"
              value={p.inflation_rate ?? 2.5}
              onChange={(e) => set({ inflation_rate: num(e.target.value, 2.5) })}
            />
          </Field>
          <Field label="Growth %">
            <Input
              type="number"
              step="0.1"
              value={p.growth_rate ?? 6}
              onChange={(e) => set({ growth_rate: num(e.target.value, 6) })}
            />
          </Field>
          <Field label="Life expectancy">
            <Input
              type="number"
              value={p.life_expectancy ?? 95}
              onChange={(e) => set({ life_expectancy: num(e.target.value, 95) })}
            />
          </Field>
          <Field label="CPP start age (60–70)">
            <Input
              type="number"
              value={p.cpp_start_age ?? 65}
              onChange={(e) =>
                set({ cpp_start_age: Math.min(70, Math.max(60, num(e.target.value, 65))) })
              }
            />
          </Field>
          <Field label="CPP entitlement (% of max)">
            <Input
              type="number"
              value={p.cpp_pct ?? 75}
              onChange={(e) => set({ cpp_pct: num(e.target.value, 75) })}
            />
          </Field>
          <Field label="OAS start age (65–70)">
            <Input
              type="number"
              value={p.oas_start_age ?? 65}
              onChange={(e) =>
                set({ oas_start_age: Math.min(70, Math.max(65, num(e.target.value, 65))) })
              }
            />
          </Field>
          <Field label="Marital status">
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
        </div>

        {(p.marital_status ?? "Single") !== "Single" && (
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Spouse age">
              <Input
                type="number"
                value={p.spouse_age ?? ""}
                onChange={(e) => set({ spouse_age: num(e.target.value, 40) })}
              />
            </Field>
            <Field label="Spouse RRSP / LIRA">
              <Input
                type="number"
                value={p.spouse_rrsp ?? 0}
                onChange={(e) => set({ spouse_rrsp: num(e.target.value) })}
              />
            </Field>
            <Field label="Spouse TFSA">
              <Input
                type="number"
                value={p.spouse_tfsa ?? 0}
                onChange={(e) => set({ spouse_tfsa: num(e.target.value) })}
              />
            </Field>
            <Field label="Spouse expected taxable income">
              <Input
                type="number"
                value={p.spouse_income ?? 0}
                onChange={(e) => set({ spouse_income: num(e.target.value) })}
              />
            </Field>
          </div>
        )}

        <div className="space-y-4 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Manual override mode</p>
              <p className="text-xs text-muted-foreground">
                Off: balances sync from your accounts. On: type your own numbers.
              </p>
            </div>
            <Switch
              checked={p.manual_override ?? false}
              onCheckedChange={(v) => set({ manual_override: v })}
            />
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
      </div>

      {/* Engine 1 chart */}
      <div className="panel space-y-3 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">When can I retire?</h2>
          <p className="text-sm text-muted-foreground">
            Balances by account type from age {inputs.retirementAge} to {inputs.lifeExpectancy},
            with spending indexed at {inputs.inflation}% and growth of {inputs.growth}%.
          </p>
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="age" tickLine={false} fontSize={12} />
              <YAxis
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                tickLine={false}
                fontSize={12}
              />
              <Tooltip formatter={(v: number) => formatCad(v)} />
              <Legend />
              <Area
                type="monotone"
                dataKey="RRSP / RRIF"
                stackId="1"
                stroke="hsl(var(--chart-1, 12 76% 61%))"
                fill="hsl(var(--chart-1, 12 76% 61%))"
                fillOpacity={0.45}
              />
              <Area
                type="monotone"
                dataKey="LIRA / LIF"
                stackId="1"
                stroke="hsl(var(--chart-2, 173 58% 39%))"
                fill="hsl(var(--chart-2, 173 58% 39%))"
                fillOpacity={0.45}
              />
              <Area
                type="monotone"
                dataKey="TFSA"
                stackId="1"
                stroke="hsl(var(--chart-3, 197 37% 44%))"
                fill="hsl(var(--chart-3, 197 37% 44%))"
                fillOpacity={0.45}
              />
              <Area
                type="monotone"
                dataKey="Non-Registered"
                stackId="1"
                stroke="hsl(var(--chart-4, 43 74% 49%))"
                fill="hsl(var(--chart-4, 43 74% 49%))"
                fillOpacity={0.45}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Engine 2 matrix */}
      <div className="panel space-y-3 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold">Tax-efficient withdrawal plan</h2>
          <p className="text-sm text-muted-foreground">
            RRIF and LIF minimums first, then registered top-ups inside the low brackets and below
            the OAS clawback threshold, then non-registered, then TFSA.
          </p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">RRSP / RRIF</TableHead>
                <TableHead className="text-right">LIRA / LIF</TableHead>
                <TableHead className="text-right">Non-Reg</TableHead>
                <TableHead className="text-right">TFSA</TableHead>
                <TableHead className="text-right">CPP</TableHead>
                <TableHead className="text-right">OAS (net)</TableHead>
                <TableHead className="text-right">Taxes</TableHead>
                <TableHead className="text-right">Spending</TableHead>
                <TableHead className="text-right">Ending balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projection.rows.map((r) => (
                <TableRow key={r.age} className={r.shortfall > 1 ? "bg-destructive/10" : undefined}>
                  <TableCell className="num">{r.age}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.rrifDraw)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.lifDraw)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.nonregDraw)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.tfsaDraw)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.cpp)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.oas)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.taxes)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.spending)}</TableCell>
                  <TableCell className="num text-right">{formatCad(r.balances.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Estimates only, using projected 2026 tax brackets. RRSPs convert to a RRIF and LIRAs to a
          LIF at 71 with the mandatory minimums applied; eligible pension income is split with a
          spouse after 65 where it lowers household tax.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="num mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
