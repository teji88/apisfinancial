import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { ApisLogo } from "@/components/brand/ApisLogo";
import { AppHeader } from "@/routes/_authenticated/route";
import { PENDING_PLAN_KEY } from "@/lib/pending-plan";
import { OldUiCppHistoryEditor } from "./OldUiCppHistoryEditor";
import { useSimulationWorker } from "@/lib/retirement/worker/useSimulationWorker";
import { useMemo, useState, useEffect, useRef } from "react";
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
  Calculator,
  Coins,
  Landmark,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile, type Profile } from "@/lib/profile";
import { formatCad, summariseAccount } from "@/lib/finance";
import {
  cppPercentFromEarnings,
  cppFromDetailedHistory,
  cppPrbInfo,
  oasFractionFromResidence,
  oasAt,
  CPP_MAX_MONTHLY_65,
  WITHDRAWAL_POLICIES,
  STRESS_SCENARIOS,
  type WithdrawalPolicy,
  type StrategyObjective,
  type StressScenario,
  type StressSeverity,
  type PersonSpec,
  type PlannerInputs,
} from "@/lib/retirement/adapter/oldApiAdapter";

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

export const Route = createFileRoute("/retirement")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Retirement Planner — Apis Financial" },
      {
        name: "description",
        content:
          "Canadian retirement planning with 2026 federal and provincial tax brackets, CPP from your earnings history, OAS from your years in Canada, RRIF minimums and a tax-efficient household withdrawal plan.",
      },
      { property: "og:title", content: "Retirement Planner — Apis Financial" },
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
  const cleaned = v.replace(/[^0-9.-]/g, "");
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

const CPP_AGE_OPTIONS = [...Array.from({ length: 11 }, (_, index) => ({ age: 60 + index }))];

const OAS_AGE_OPTIONS = [...Array.from({ length: 6 }, (_, index) => ({ age: 65 + index }))];

function AgeSelect({
  value,
  options,
  onChange,
}: {
  value: number;
  options: { age: number }[];
  onChange: (age: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.age} value={String(o.age)}>
            {`Age ${o.age}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Keep intermediate keystrokes local so clearing/replacing a multi-digit age works. */
function RetirementAgeInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (age: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const entered = draft.trim();
    if (!entered) {
      setDraft(String(value));
      return;
    }
    const age = Math.round(Number(entered));
    if (!Number.isFinite(age)) {
      setDraft(String(value));
      return;
    }
    onChange(age);
    setDraft(String(age));
  };

  return (
    <Input
      ref={inputRef}
      type="number"
      step="1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const GUEST_PROFILE: Profile = {
  id: "guest",
  display_name: null,
  base_currency: "CAD",
  province: "ON",
  current_age: 45,
  target_retirement_age: 65,
  inflation_rate: 2.5,
  growth_rate: 6,
  working_growth_rate: 6,
  retirement_growth_rate: 4.5,
  life_expectancy: 95,
  marital_status: "Single",
  spouse_age: null,
  spouse_rrsp: 0,
  spouse_tfsa: 0,
  spouse_income: 0,
  desired_income: 60000,
  cpp_start_age: 65,
  cpp_pct: 75,
  oas_start_age: 65,
  manual_override: true,
  override_tfsa: 75000,
  override_rrsp: 150000,
  override_lira: 0,
  override_fhsa: 0,
  override_nonreg: 25000,
  annual_savings: 12000,
  save_pct_tfsa: 40,
  save_pct_rrsp: 40,
  save_pct_nonreg: 20,
  cpp_avg_income: 60000,
  cpp_years_worked: 23,
  cpp_future_income: 60000,
  // Detailed CPP earnings history (new - uses CppCalculator)
  cpp_detailed_history: [] as Array<{ year: number; earnings: number }>,
  cpp_detailed_future_earnings: 0,
  cpp_detailed_child_rearing: [] as number[],
  oas_years_in_canada: 40,
  spouse_retirement_age: null,
  spouse_cpp_avg_income: 0,
  spouse_cpp_years_worked: 0,
  spouse_cpp_future_income: 0,
  // Detailed spouse CPP earnings history (mirrors self's - in-memory only)
  spouse_cpp_detailed_history: [] as Array<{ year: number; earnings: number }>,
  spouse_cpp_detailed_future_earnings: 0,
  spouse_cpp_detailed_child_rearing: [] as number[],
  spouse_oas_years_in_canada: 40,
  spouse_cpp_start_age: 65,
  spouse_oas_start_age: 65,
  spouse_lira: 0,
  spouse_nonreg: 0,
};

function RetirementPage() {
  const { session, loading: authLoading } = useAuth();
  const isGuest = !authLoading && !session;
  const navigate = useNavigate();
  const { accounts, holdings, transactions, quotes, fxUsdCad, loading } = usePortfolio();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();

  const { entitlement } = useEntitlement();
  // Every planning control is free now — nothing on this page is locked.
  const isPro: boolean = true;
  const isProPlus: boolean = true;
  const [proPromptOpen, setProPromptOpen] = useState(false);
  const [promptReason] = useState<string>("");
  const PRO_REASON = "Everything in the retirement planner is free.";
  const PLUS_REASON = PRO_REASON;
  const openPrompt = (_reason: string) => setProPromptOpen(true);
  const lockProps = {};
  const plusProps = {};
  void entitlement;
  void PLUS_REASON;
  void openPrompt;



  const [form, setForm] = useState<Profile | null>(null);
  // Detailed CPP earnings histories are not in the Supabase schema yet, so
  // they persist on this device (localStorage) and merge into the form on load.
  // This keeps them across logins until the columns exist server-side.
  const CPP_DETAIL_KEY = "apis.cpp-detail.v1";
  type CppDetail = Pick<
    Profile,
    | "cpp_detailed_history"
    | "cpp_detailed_future_earnings"
    | "cpp_detailed_child_rearing"
    | "spouse_cpp_detailed_history"
    | "spouse_cpp_detailed_future_earnings"
    | "spouse_cpp_detailed_child_rearing"
  >;
  const readCppDetail = (): Partial<CppDetail> => {
    try {
      const raw = window.localStorage.getItem(CPP_DETAIL_KEY);
      return raw ? (JSON.parse(raw) as Partial<CppDetail>) : {};
    } catch {
      return {};
    }
  };
  /** Bounded income overshoot allowed above the effective ceiling, today's CAD. */
  const [clawbackTolerance, setClawbackTolerance] = useState(0);
  const [policy, setPolicy] = useState<WithdrawalPolicy>("TAX_TARGETED");
  const [objective, setObjective] = useState<StrategyObjective>("MIN_TAX");
  /** User override for non-registered gain ratio (0-1). Null = use portfolio ACB or estimate. */
  const [gainRatioOverride, setGainRatioOverride] = useState<number | null>(null);
  /** True once the user scrolls — collapses the sticky summary to a compact bar. */
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);


  useEffect(() => {
    if (authLoading || form) return;
    if (isGuest) {
      const stored = window.localStorage.getItem(PENDING_PLAN_KEY);
      setForm(stored ? { ...GUEST_PROFILE, ...(JSON.parse(stored) as Partial<Profile>), ...readCppDetail() } : { ...GUEST_PROFILE, ...readCppDetail() });
      return;
    }
    if (!profileQuery.data) return;
    const stored = window.localStorage.getItem(PENDING_PLAN_KEY);
    if (stored) {
      // A plan built before signing in: write it to the new profile.
      const pending = JSON.parse(stored) as Partial<Profile>;
      window.localStorage.removeItem(PENDING_PLAN_KEY);
      setForm({ ...profileQuery.data, ...pending, ...readCppDetail() });
      updateProfile.mutate(pending, {
        onSuccess: () => toast.success("Your retirement plan is saved to your account"),
        onError: (e) => toast.error((e as Error).message),
      });
      return;
    }
    setForm({ ...profileQuery.data, ...readCppDetail() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data, form, authLoading, isGuest]);

  // Persist detailed CPP histories on this device whenever they change.
  useEffect(() => {
    if (!form) return;
    const detail: Partial<CppDetail> = {
      cpp_detailed_history: form.cpp_detailed_history,
      cpp_detailed_future_earnings: form.cpp_detailed_future_earnings,
      cpp_detailed_child_rearing: form.cpp_detailed_child_rearing,
      spouse_cpp_detailed_history: form.spouse_cpp_detailed_history,
      spouse_cpp_detailed_future_earnings: form.spouse_cpp_detailed_future_earnings,
      spouse_cpp_detailed_child_rearing: form.spouse_cpp_detailed_child_rearing,
    };
    try {
      window.localStorage.setItem(CPP_DETAIL_KEY, JSON.stringify(detail));
    } catch {
      // Storage full or unavailable — the in-memory values still work for this session.
    }
  }, [form]);

  const byType = useMemo(() => {
    const sums: Record<string, number> = {};
    const acbs: Record<string, number> = {};
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
      // Track ACB for non-registered accounts to compute the gain ratio.
      // Cash has no ACB (it's already after-tax), so only use the invested ACB.
      acbs[a.account_type] = (acbs[a.account_type] ?? 0) + Math.max(0, s.acb);
    }
    const pick = (types: string[]) => types.reduce((t, k) => t + (sums[k] ?? 0), 0);
    const pickAcb = (types: string[]) => types.reduce((t, k) => t + (acbs[k] ?? 0), 0);
    const nonregValue = pick(NONREG_TYPES);
    const nonregAcb = pickAcb(NONREG_TYPES);
    // Gain ratio = unrealized gain / market value, clamped 0-1.
    // Falls back to null when no ACB data (user can override or estimate).
    const nonregGainRatio = nonregValue > 0 && nonregAcb > 0
      ? Math.min(1, Math.max(0, (nonregValue - nonregAcb) / nonregValue))
      : null;
    return {
      tfsa: pick(TFSA_TYPES),
      rrsp: pick(RRSP_TYPES),
      lira: pick(LIRA_TYPES),
      fhsa: pick(FHSA_TYPES),
      nonreg: nonregValue,
      nonregGainRatio,
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
    // RESP and RDSP money belongs to the child or the beneficiary and is taxed
    // in their hands, so it never joins your own retirement pots.
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


  const derived = useMemo(() => {
    if (!p) return null;
    const currentAge = p.current_age ?? 40;
    const retireAge = p.target_retirement_age ?? 65;
    // Use detailed history if available, otherwise fallback to simplified
    let selfPct: number;
    if (p.cpp_detailed_history && p.cpp_detailed_history.length > 0) {
      const monthly = cppFromDetailedHistory(
        (new Date().getFullYear() - currentAge),
        p.cpp_detailed_history,
        p.cpp_detailed_future_earnings ?? 0,
        p.cpp_detailed_child_rearing ?? [],
        retireAge,
      );
      selfPct = Math.min(100, (monthly / CPP_MAX_MONTHLY_65) * 100);
    } else {
      selfPct = cppPercentFromEarnings({
        pastAverageIncome: p.cpp_avg_income ?? 0,
        yearsWorked: p.cpp_years_worked ?? 0,
        futureIncome: p.cpp_future_income ?? 0,
        futureYears: Math.max(0, Math.min(retireAge, 65) - currentAge),
      });
    }
    const spouseAge = p.spouse_age ?? currentAge;
    const spouseRetire = p.spouse_retirement_age ?? retireAge;
    let spousePct: number;
    if (p.spouse_cpp_detailed_history && p.spouse_cpp_detailed_history.length > 0) {
      const monthly = cppFromDetailedHistory(
        (new Date().getFullYear() - spouseAge),
        p.spouse_cpp_detailed_history,
        p.spouse_cpp_detailed_future_earnings ?? 0,
        p.spouse_cpp_detailed_child_rearing ?? [],
        spouseRetire,
      );
      spousePct = Math.min(100, (monthly / CPP_MAX_MONTHLY_65) * 100);
    } else {
      spousePct = cppPercentFromEarnings({
        pastAverageIncome: p.spouse_cpp_avg_income ?? 0,
        yearsWorked: p.spouse_cpp_years_worked ?? 0,
        futureIncome: p.spouse_cpp_future_income ?? 0,
        futureYears: Math.max(0, Math.min(spouseRetire, 65) - spouseAge),
      });
    }
    const annual = (pct: number) => (CPP_MAX_MONTHLY_65 * 12 * pct) / 100;
    // PRB info: only when working while collecting CPP (retirement > CPP start)
    let selfPrb = { monthly: 0, annual: 0, years: [] as number[] };
    if (p.cpp_detailed_history && p.cpp_detailed_history.length > 0) {
      selfPrb = cppPrbInfo(
        (new Date().getFullYear() - currentAge),
        p.cpp_detailed_history,
        p.cpp_detailed_future_earnings ?? 0,
        p.cpp_detailed_child_rearing ?? [],
        retireAge,
        p.cpp_start_age ?? 65,
      );
    }
    return {
      selfPct,
      spousePct,
      selfCpp65: annual(selfPct),
      spouseCpp65: annual(spousePct),
      selfPrb,
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
      // Use portfolio ACB if available, else user override, else 0.4 estimate.
      nonregGainRatio: gainRatioOverride ?? byType.nonregGainRatio ?? 0.4,
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
      workingGrowth: p.working_growth_rate ?? p.growth_rate ?? 6,
      retirementGrowth: p.retirement_growth_rate ?? 4.5,
      desiredIncome: p.desired_income ?? 60000,
      annualSavings: p.annual_savings ?? 0,
      savingsSplit: {
        tfsa: p.save_pct_tfsa ?? 40,
        rrsp: p.save_pct_rrsp ?? 40,
        nonreg: p.save_pct_nonreg ?? 20,
      },
      clawbackTolerance,
      pensionSplitPercent: p.pension_split_percent ?? 0,
      withdrawalPolicy: policy,
      self,
      spouse,
    };
  }, [p, derived, balances, clawbackTolerance, policy, gainRatioOverride]);

  /* All heavy engine work runs in a Web Worker — the UI thread never blocks.
     The projection updates live (debounced); earliest-age and strategy
     comparison only run when the user clicks their Calculate buttons. */
  const {
    projection,
    projecting,
    earliest,
    earliestLoading,
    earliestProgress,
    runEarliest,
    clearEarliest,
    comparison,
    comparing,
    runCompare,
    clearComparison,
    runProject,
    runProjectQuick,
    stressResults,
    stressing,
    runStress,
    clearStress,
    workerError,
  } = useSimulationWorker();

  // Stress test severity per scenario (user-adjustable)
  const [stressSeverities, setStressSeverities] = useState<Record<string, StressSeverity>>({
    crash: "moderate",
    lowReturn: "moderate",
    highInflation: "moderate",
    longLife: "moderate",
  });

  // Clear stress/comparison results when inputs change (they're stale) — but
  // never mid-run, or results get wiped just as they arrive.
  // Keyed on the serialized inputs (not object identity) as belt-and-suspenders:
  // even if a memo above hands us a new-but-deeply-equal object, we don't
  // nuke valid results.
  const stressingRef = useRef(stressing);
  stressingRef.current = stressing;
  const comparingRef = useRef(comparing);
  comparingRef.current = comparing;
  const inputsKey = inputs ? JSON.stringify(inputs) : null;
  useEffect(() => {
    if (!stressingRef.current) clearStress();
    if (!comparingRef.current) clearComparison();
    clearEarliest();
  }, [inputsKey, clearStress, clearComparison, clearEarliest]);

  // Quick estimate runs immediately (no debounce) for instant feedback.
  // Full projection follows after 400ms of inactivity and overwrites it.
  useEffect(() => {
    if (!inputs) return;
    runProjectQuick(inputs);
  }, [inputs, runProjectQuick]);

  useEffect(() => {
    if (!inputs) return;
    const t = setTimeout(() => runProject(inputs), 400);
    return () => clearTimeout(t);
  }, [inputs, runProject]);


  if (!authLoading && !isGuest && profileQuery.isError) {
    return (
      <div className="p-6 text-sm text-destructive">
        We couldn’t load your retirement profile. Please refresh and try again.
      </div>
    );
  }

  if (
    authLoading ||
    (!isGuest && (loading || profileQuery.isLoading)) ||
    !p ||
    !inputs ||
    !projection ||
    !derived
  ) {
    if (workerError) {
      return (
        <div className="p-6 space-y-3">
          <p className="text-sm font-medium text-destructive">Couldn't load your plan</p>
          <p className="text-sm text-muted-foreground">{workerError}</p>
          <p className="text-xs text-muted-foreground">
            Try refreshing the page. If this keeps happening, please let us know.
          </p>
        </div>
      );
    }
    return <p className="p-6 text-sm text-muted-foreground">Loading your plan…</p>;
  }

  const set = (patch: Partial<Profile>) => setForm({ ...(form ?? p), ...patch });
  const married = (p.marital_status ?? "Single") !== "Single";

  const save = () => {
    const { id: _id, display_name: _dn, base_currency: _bc, ...rest } = p;
    if (isGuest) {
      window.localStorage.setItem(PENDING_PLAN_KEY, JSON.stringify(rest));
      toast.message("Create a free account or log in to save your retirement plan.");
      void navigate({ to: "/auth" });
      return;
    }
    updateProfile.mutate(rest as Partial<Profile>, {
      onSuccess: () => toast.success("Plan saved"),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  // The engine models everything in 2026 dollars, so rows need no deflation.
  const rows = projection?.rows ?? [];
  const totalTaxes = rows.reduce((t, r) => t + r.taxes, 0);
  const totalClawback = rows.reduce((t, r) => t + r.oasClawback, 0);
  const endingBalance = rows.length ? rows[rows.length - 1]!.balances.total : 0;
  const moneyNote = "in today's dollars";

  // "At {retirementAge}" should show the projected balance at retirement age,
  // not the current year's balance. Find the row for the retirement age,
  // falling back to the first row at or after that age.
  const retirementAge = inputs?.retirementAge ?? 65;
  const retirementRow =
    rows.find((r) => r.age === retirementAge) ??
    rows.find((r) => r.age >= retirementAge) ??
    rows[0];

  const startBalance = retirementRow
    ? retirementRow.balances.total +
      retirementRow.rrifDraw +
      retirementRow.lifDraw +
      retirementRow.nonregDraw +
      retirementRow.tfsaDraw
    : 0;
  const clawbackYears = rows.filter((r) => r.oasClawback > 1);
  const todayTotal =
    balances.tfsa +
    balances.rrsp +
    balances.lira +
    balances.nonreg +
    (married
      ? (p.spouse_tfsa ?? 0) + (p.spouse_rrsp ?? 0) + (p.spouse_lira ?? 0) + (p.spouse_nonreg ?? 0)
      : 0);

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
    Spending: Math.round(r.spending),
    // Pre-tax line: what must be funded before tax (spending + tax bill).
    // The gap between this (black) and Spending (red) is the year's tax.
    "Pre-tax need": Math.round(r.spending + r.taxes),
  }));

  // oasAt expects *years* of residence, not the already-computed fraction.
  const selfOas = oasAt(p.oas_start_age ?? 65, p.oas_years_in_canada ?? 40);
  const spouseOas = married ? oasAt(p.spouse_oas_start_age ?? 65, p.spouse_oas_years_in_canada ?? 40) : 0;

  return (
    <div className={isGuest ? "mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6" : "min-h-screen bg-surface"}>
      {!isGuest && <AppHeader />}
      <main className={isGuest ? undefined : "mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8"}>
      {isGuest && <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <Link to="/">
          <ApisLogo variant="full" size="sm" />
        </Link>
        <div className="flex items-center gap-2">
          {isGuest ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth">Log in</Link>
              </Button>
              <Button size="sm" className="honey-fill" onClick={save}>
                Save plan (free account)
              </Button>
            </>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          )}
        </div>
      </div>}
      {isGuest && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
          Try it free — no account needed. Change any number under Inputs and the plan updates
          instantly. Create a free account only if you want to save it.
        </div>
      )}
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

      <GlanceBar
        compact={scrolled}
        stats={[
          {
            key: "outcome",
            label: "Outcome",
            value: projection?.success
              ? `Funded to age ${p?.life_expectancy ?? 95}`
              : projection?.depletionAge != null
                ? `Money runs out at ${projection.depletionAge}`
                : "Tight years — tap for details",
            tone: projection?.success ? "good" : "warn",
            dimmed: projecting,
            detail: (
              <>
                <div>Ending balance {formatCad(endingBalance)} {moneyNote}</div>
                {!projection?.success && projection?.depletionAge != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    The portfolio is fully depleted at age {projection.depletionAge}. Spending after
                    that age cannot be funded.
                  </p>
                )}
                {!projection?.success && projection?.depletionAge == null && projection?.rows && (
                  <div className="mt-2">
                    <div className="font-medium">Years where cash came up short:</div>
                    <ul className="list-disc list-inside text-xs">
                      {projection.rows
                        .filter((r) => r.shortfall > 500)
                        .slice(0, 5)
                        .map((r) => (
                          <li key={r.age}>
                            Age {r.age}: {formatCad(r.shortfall)} short of the plan
                          </li>
                        ))}
                      {projection.rows.filter((r) => r.shortfall > 500).length > 5 && (
                        <li>...and {projection.rows.filter((r) => r.shortfall > 500).length - 5} more years</li>
                      )}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-1">
                      In these years the monthly cash didn't fully cover spending plus taxes.
                      The portfolio recovers afterwards — this is a cash-flow squeeze, not
                      running out of money.
                    </p>
                  </div>
                )}
              </>
            ),
          },
          {
            key: "earliest",
            label: "Retire",
            value: earliestLoading ? "…" : earliest ? `at ${earliest}` : "—",
            tone: earliest && earliest <= inputs.retirementAge ? "good" : "warn",
            detail: (
              <>
                {earliestLoading ? (
                  earliestProgress
                    ? `Testing… ${earliestProgress.completed}/${earliestProgress.total} checks`
                    : "Testing retirement ages in the background…"
                ) : earliest ? (
                  <>
                    {earliest <= inputs.retirementAge
                      ? `Your target of ${inputs.retirementAge} works`
                      : `Your target of ${inputs.retirementAge} runs short`}
                    {(() => {
                      const displayAge = earliest <= inputs.retirementAge ? inputs.retirementAge : earliest;
                      const cppStart = p.cpp_start_age ?? 65;
                      const oasStart = p.oas_start_age ?? 65;
                      const firstBenefit = Math.min(cppStart, oasStart);
                      const bridgeYears = firstBenefit - displayAge;
                      return bridgeYears > 0 ? (
                        <span className="mt-1 block text-amber-600">
                          {bridgeYears}-year bridge: portfolio funds everything until benefits start at {firstBenefit}
                        </span>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputs && runEarliest(inputs)}
                    className="text-primary hover:underline"
                  >
                    Calculate earliest age
                  </button>
                )}
              </>
            ),
          },
          {
            key: "balance",
            label: `At ${inputs.retirementAge}`,
            value: formatCad(startBalance),
            tone: "neutral",
            detail: "All figures in today’s purchasing power (adjusted for inflation).",
          },
          {
            key: "tax",
            label: "Lifetime tax",
            value: formatCad(totalTaxes),
            tone: totalClawback > 1 ? "warn" : "good",
            detail:
              totalClawback > 1
                ? `${formatCad(totalClawback)} of OAS clawed back over ${clawbackYears.length} years. Tax counted from retirement onward.`
                : "No OAS clawback in this plan. Tax counted from retirement onward.",
          },
          {
            key: "estate",
            label: "Estate tax",
            value: formatCad(projection?.estateTax ?? 0),
            tone: (projection?.estateTax ?? 0) > 1 ? "warn" : "good",
            detail: `${formatCad(projection?.estateRegistered ?? 0)} left in RRIF/LIF at ${inputs.lifeExpectancy} is fully taxed in that year`,
          },
        ]}
      />

      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">The plan</TabsTrigger>
          <TabsTrigger value="inputs">Your details</TabsTrigger>
          <TabsTrigger value="schedule">Year-by-year</TabsTrigger>
        </TabsList>

        {/* --------------------------------- PLAN --------------------------------- */}
        <TabsContent value="plan" className="space-y-6 pt-4">
          {!comparison && !comparing ? (
            <Button size="sm" onClick={() => inputs && runCompare(inputs, objective)}>
              Compare strategies
            </Button>
          ) : null}
          {comparing && !comparison ? (
            <p className="text-sm text-muted-foreground">Testing withdrawal strategies in the background…</p>
          ) : null}
          {comparison ? (
            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Withdrawal strategy optimizer</h3>
                  <p className="text-sm text-muted-foreground">
                    Compare how the order you spend your accounts changes tax, clawback and what is
                    left at the end.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Goal</Label>
                  <Select
                    value={objective}
                    onValueChange={(v) => setObjective(v as StrategyObjective)}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MIN_TAX">Pay the least tax</SelectItem>
                      <SelectItem value="MAX_ESTATE">Leave the most behind</SelectItem>
                      <SelectItem value="MAX_SUSTAINABLE_SPENDING">
                        Keep the income going longest
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {comparison.results.map((r) => {
                  const selected = r.policy === policy;
                  return (
                    <button
                      key={r.policy}
                      type="button"
                      onClick={() => setPolicy(r.policy)}
                      className={`rounded-lg border p-3 text-left transition ${
                        selected ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{r.label}</span>
                        {r.policy === comparison.best ? (
                          <Badge variant="secondary">Recommended</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.blurb}</p>
                      <dl className="mt-3 space-y-1 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Lifetime tax</dt>
                          <dd>{formatCad(r.totalTaxes)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">OAS clawback</dt>
                          <dd>{formatCad(r.totalClawback)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Left after tax</dt>
                          <dd>{r.depletionAge != null ? "Depleted" : formatCad(r.estateAfterTax)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Money lasts</dt>
                          <dd>{r.depletionAge == null ? "To plan end" : `To age ${r.depletionAge}`}</dd>
                        </div>
                      </dl>
                    </button>
                  );
                })}
              </div>

              {policy === "TAX_TARGETED" && (
                <div className="rounded-lg border p-4 space-y-2">
                  <Label className="text-sm font-medium">OAS clawback tolerance</Label>
                  <p className="text-xs text-muted-foreground">
                    How far above the OAS clawback threshold you're willing to go when melting down
                    registered accounts. $0 means stay strictly under the line.
                  </p>
                  <NumInput
                    value={clawbackTolerance}
                    onCommit={(n) => setClawbackTolerance(Math.max(0, n))}
                  />
                </div>
              )}

              <div className="max-h-[22rem] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strategy</TableHead>
                      <TableHead className="text-right">Lifetime tax</TableHead>
                      <TableHead className="text-right">OAS clawback</TableHead>
                      <TableHead className="text-right">Ending balance</TableHead>
                      <TableHead className="text-right">Tax at death</TableHead>
                      <TableHead className="text-right">Left after tax</TableHead>
                      <TableHead className="text-right">Money lasts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.results.map((r) => (
                      <TableRow key={r.policy} className={r.policy === policy ? "bg-muted/50" : ""}>
                        <TableCell className="font-medium">
                          {r.label}
                          {r.policy === comparison.best ? " ★" : ""}
                        </TableCell>
                        <TableCell className="text-right">{formatCad(r.totalTaxes)}</TableCell>
                        <TableCell className="text-right">{formatCad(r.totalClawback)}</TableCell>
                        <TableCell className="text-right">{formatCad(r.endingBalance)}</TableCell>
                        <TableCell className="text-right">{formatCad(r.estateTax)}</TableCell>
                        <TableCell className="text-right">{formatCad(r.estateAfterTax)}</TableCell>
                        <TableCell className="text-right">
                          {r.depletionAge == null ? "To plan end" : `Age ${r.depletionAge}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  Showing:{" "}
                  <span className="font-medium text-foreground">
                    {WITHDRAWAL_POLICIES.find((w) => w.key === policy)?.label}
                  </span>{" "}
                  — the charts and year-by-year table below use this order.
                </p>
                {policy !== comparison.best ? (
                  <Button size="sm" variant="outline" onClick={() => setPolicy(comparison.best)}>
                    Use the recommended strategy
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <BenefitCard
              title="Your government benefits"
              cppPct={derived.selfPct}
              cppStart={p.cpp_start_age ?? 65}
              cppAnnual={(CPP_MAX_MONTHLY_65 * 12 * derived.selfPct) / 100}
              oasStart={p.oas_start_age ?? 65}
              oasAnnual={selfOas}
              oasYears={p.oas_years_in_canada ?? 40}
              prbAnnual={derived.selfPrb.annual}
              prbYears={derived.selfPrb.years}
              retirementAge={p.target_retirement_age ?? 65}
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
              <h2 className="font-display text-lg font-semibold">
                Where your income comes from
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({WITHDRAWAL_POLICIES.find((w) => w.key === policy)?.label})
                </span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Each bar is a retirement year: benefits and withdrawals stacked against the spending
                line. The black line is the pre-tax need (spending + taxes); the red line is
                after-tax spending — the gap between them is the year's tax bill. Amounts {moneyNote}.
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
                  <Bar dataKey="CPP" stackId="i" fill="var(--series-1)" />
                  <Bar dataKey="OAS" stackId="i" fill="var(--series-2)" />
                  <Bar dataKey="RRIF / LIF" stackId="i" fill="var(--series-3)" />
                  <Bar dataKey="Non-Reg" stackId="i" fill="var(--series-4)" />
                  <Bar dataKey="TFSA" stackId="i" fill="var(--series-5)" />

                  <Line
                    type="monotone"
                    dataKey="Pre-tax need"
                    stroke="var(--foreground)"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="Spending"
                    stroke="#dc2626"
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
                {(((1 + (inputs.workingGrowth ?? 6) / 100) / (1 + inputs.inflation / 100) - 1) * 100).toFixed(2)}% working-years real return and {(((1 + (inputs.retirementGrowth ?? 6) / 100) / (1 + inputs.inflation / 100) - 1) * 100).toFixed(2)}% retirement-years real return. Amounts {moneyNote}.
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
                      ["RRSP / RRIF", "var(--series-3)"],
                      ["LIRA / LIF", "var(--series-2)"],
                      ["TFSA", "var(--series-5)"],
                      ["Non-Registered", "var(--series-4)"],
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

          {/* --------------------------- STRESS TESTS --------------------------- */}
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Stress test your plan</h3>
                <p className="text-sm text-muted-foreground">
                  See if your plan holds up when things go wrong. Pick how harsh each
                  scenario is, then run them.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  if (!inputs) return;
                  for (const s of STRESS_SCENARIOS) {
                    runStress(inputs, s.id, stressSeverities[s.id] ?? "moderate");
                  }
                }}
                disabled={stressing || !inputs}
              >
                {stressing ? "Testing…" : "Run stress tests"}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {STRESS_SCENARIOS.map((s) => {
                const severity = stressSeverities[s.id] ?? "moderate";
                const key = `${s.id}-${severity}`;
                const result = stressResults[key];
                return (
                  <div key={s.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      {result ? (
                        result.passed ? (
                          <span className="text-xs font-medium text-green-600">✓ Holds up</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">
                            Runs short at {result.depletionAge}
                          </span>
                        )
                      ) : stressing ? (
                        <span className="text-xs text-muted-foreground">Testing…</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                    <div className="flex gap-1">
                      {(["mild", "moderate", "severe"] as StressSeverity[]).map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setStressSeverities((prev) => ({ ...prev, [s.id]: level }))}
                          className={`rounded px-2 py-1 text-xs transition ${
                            severity === level
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          }`}
                        >
                          {s.severities[level].label}
                        </button>
                      ))}
                    </div>
                    {result && !result.passed && (
                      <p className="text-xs text-muted-foreground">
                        Under this scenario ({result.severityLabel}), the money runs out at age{" "}
                        {result.depletionAge}.
                      </p>
                    )}
                  </div>
                );
              })}
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
              <NumInput value={p.current_age} onCommit={(n) => set({ current_age: n })} />
            </Field>
            <Field label="Target retirement age" {...lockProps}>
              <RetirementAgeInput
                value={p.target_retirement_age ?? 65}
                onChange={(age) => set({ target_retirement_age: age })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Retirement begins in your birthday month, so the first calendar year shows
                partial spending and withdrawals — the year-by-year table normalises from
                the next year on. CPP and OAS also start in the birthday month of the start
                age you pick (not January), matching how Service Canada pays them.
              </p>
            </Field>
            <Field label="Desired after-tax household income (today's $)">
              <NumInput value={p.desired_income} onCommit={(n) => set({ desired_income: n })} />
              <p className="text-xs text-muted-foreground mt-1">
                This is what you want to spend after taxes are paid. The planner grosses up
                withdrawals to cover the tax bill on top of this amount.
              </p>
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
              <NumInput value={p.inflation_rate} onCommit={(n) => set({ inflation_rate: n })} step="0.1" />
            </Field>
            <Field label="Working years growth rate (%)" {...lockProps}>
              <NumInput value={p.working_growth_rate} onCommit={(n) => set({ working_growth_rate: n })} step="0.1" />
            </Field>
            <Field label="Retirement years growth rate (%)" {...lockProps}>
              <NumInput value={p.retirement_growth_rate} onCommit={(n) => set({ retirement_growth_rate: n })} step="0.1" />
            </Field>
            <Field label="Life expectancy" {...lockProps}>
              <NumInput value={p.life_expectancy} onCommit={(n) => set({ life_expectancy: n })} />
            </Field>
            <Field label="Marital status" {...plusProps}>
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
              <NumInput value={p.cpp_avg_income} onCommit={(n) => set({ cpp_avg_income: n })} />
            </Field>
            <Field label="Years worked in Canada so far">
              <NumInput value={p.cpp_years_worked} onCommit={(n) => set({ cpp_years_worked: n })} />
            </Field>
            <Field label="Expected income until retirement (today's $)">
              <NumInput value={p.cpp_future_income} onCommit={(n) => set({ cpp_future_income: n })} />
            </Field>
            <Field label="CPP start age (60–70)" {...lockProps}>
              <AgeSelect
                value={p.cpp_start_age ?? 65}
                options={CPP_AGE_OPTIONS}
                onChange={(age) => set({ cpp_start_age: age })}
              />
            </Field>
            <Field label="Years living in Canada after age 18 (sets OAS)">
              <NumInput value={p.oas_years_in_canada} onCommit={(n) => set({ oas_years_in_canada: n })} />
            </Field>
            <Field label="OAS start age (65–70)" {...lockProps}>
              <AgeSelect
                value={p.oas_start_age ?? 65}
                options={OAS_AGE_OPTIONS}
                onChange={(age) => set({ oas_start_age: age })}
              />
            </Field>
            <div className="sm:col-span-2">
              {(p.cpp_detailed_history?.length ?? 0) > 0 && (
                <p className="text-xs text-emerald-700 mb-2">
                  ✓ Using your saved detailed earnings history ({p.cpp_detailed_history!.length} years) —
                  stored on this device and reloaded automatically when you log back in.
                </p>
              )}
              <OldUiCppHistoryEditor
                birthYear={new Date().getFullYear() - (p.current_age ?? 40)}
                earningsHistory={p.cpp_detailed_history ?? []}
                futureEarnings={p.cpp_detailed_future_earnings ?? 0}
                childRearingYears={p.cpp_detailed_child_rearing ?? []}
                onHistoryChange={(history) => set({ cpp_detailed_history: history })}
                onFutureEarningsChange={(value) => set({ cpp_detailed_future_earnings: value })}
                onChildRearingChange={(years) => set({ cpp_detailed_child_rearing: years })}
              />
            </div>
          </Section>

          <Section
            title="Saving until retirement"
            subtitle="Where each dollar you save lands changes the tax you pay later."
          >
            <Field label="Annual savings (today's $)">
              <NumInput value={p.annual_savings} onCommit={(n) => set({ annual_savings: n })} />
            </Field>
            <Field label="% to TFSA" {...plusProps}>
              <NumInput value={p.save_pct_tfsa} onCommit={(n) => set({ save_pct_tfsa: n })} />
            </Field>
            <Field label="% to RRSP / FHSA" {...plusProps}>
              <NumInput value={p.save_pct_rrsp} onCommit={(n) => set({ save_pct_rrsp: n })} />
            </Field>
            <Field label="% to non-registered" {...plusProps}>
              <NumInput value={p.save_pct_nonreg} onCommit={(n) => set({ save_pct_nonreg: n })} />
            </Field>

            <p className="col-span-full text-xs text-muted-foreground">
              Splits are normalised, so they do not have to add to exactly 100. Today they total{" "}
              {(p.save_pct_tfsa ?? 0) + (p.save_pct_rrsp ?? 0) + (p.save_pct_nonreg ?? 0)}%.
            </p>
          </Section>

          {married && isProPlus && (
            <Section
              title="Your spouse"
              subtitle={`Their CPP and OAS count towards the household income. Estimated CPP entitlement: ${derived.spousePct}% of the maximum.`}
            >
              <Field label="Spouse age">
                              <NumInput value={p.spouse_age} onCommit={(n) => set({ spouse_age: n })} />
              </Field>
              <Field label="Spouse retirement age">
                <RetirementAgeInput
                  value={p.spouse_retirement_age ?? 65}
                  onChange={(age) => set({ spouse_retirement_age: age })}
                />
              </Field>
              <Field label="Spouse typical past income (today's $)">
                              <NumInput value={p.spouse_cpp_avg_income} onCommit={(n) => set({ spouse_cpp_avg_income: n })} />
              </Field>
              <Field label="Spouse years worked so far">
                              <NumInput value={p.spouse_cpp_years_worked} onCommit={(n) => set({ spouse_cpp_years_worked: n })} />
              </Field>
              <Field label="Spouse expected income until retirement">
                              <NumInput value={p.spouse_cpp_future_income} onCommit={(n) => set({ spouse_cpp_future_income: n })} />
              </Field>
              <Field label="Spouse years in Canada after 18">
                              <NumInput value={p.spouse_oas_years_in_canada} onCommit={(n) => set({ spouse_oas_years_in_canada: n })} />
              </Field>
              <Field label="Spouse CPP start age">
                <AgeSelect
                  value={p.spouse_cpp_start_age ?? 65}
                  options={CPP_AGE_OPTIONS}
                  onChange={(age) => set({ spouse_cpp_start_age: age })}
                />
              </Field>
              <Field label="Spouse OAS start age">
                <AgeSelect
                  value={p.spouse_oas_start_age ?? 65}
                  options={OAS_AGE_OPTIONS}
                  onChange={(age) => set({ spouse_oas_start_age: age })}
                />
              </Field>
              <div className="sm:col-span-2">
                {(p.spouse_cpp_detailed_history?.length ?? 0) > 0 && (
                  <p className="text-xs text-emerald-700 mb-2">
                    ✓ Using the saved detailed earnings history ({p.spouse_cpp_detailed_history!.length} years) —
                    stored on this device and reloaded automatically when you log back in.
                  </p>
                )}
                <OldUiCppHistoryEditor
                  birthYear={new Date().getFullYear() - (p.spouse_age ?? p.current_age ?? 40)}
                  earningsHistory={p.spouse_cpp_detailed_history ?? []}
                  futureEarnings={p.spouse_cpp_detailed_future_earnings ?? 0}
                  childRearingYears={p.spouse_cpp_detailed_child_rearing ?? []}
                  onHistoryChange={(history) => set({ spouse_cpp_detailed_history: history })}
                  onFutureEarningsChange={(value) => set({ spouse_cpp_detailed_future_earnings: value })}
                  onChildRearingChange={(years) => set({ spouse_cpp_detailed_child_rearing: years })}
                />
              </div>

              <Field label="Spouse RRSP">
                              <NumInput value={p.spouse_rrsp} onCommit={(n) => set({ spouse_rrsp: n })} />
              </Field>
              <Field label="Spouse LIRA / LIF">
                              <NumInput value={p.spouse_lira} onCommit={(n) => set({ spouse_lira: n })} />
              </Field>
              <Field label="Spouse TFSA">
                              <NumInput value={p.spouse_tfsa} onCommit={(n) => set({ spouse_tfsa: n })} />
              </Field>
              <Field label="Spouse non-registered">
                              <NumInput value={p.spouse_nonreg} onCommit={(n) => set({ spouse_nonreg: n })} />
              </Field>
              <Field label="Spouse other pension income in retirement">
                              <NumInput value={p.spouse_income} onCommit={(n) => set({ spouse_income: n })} />
              </Field>
              <Field label="Pension income split % (0-50)">
                <NumInput
                  value={p.pension_split_percent ?? 0}
                  onCommit={(n) => set({ pension_split_percent: Math.min(50, Math.max(0, n)) } as Partial<Profile>)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Split eligible pension income with your spouse to reduce overall tax. Max 50%.
                </p>
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
                {isProPlus ? null : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Lock className="h-2.5 w-2.5" />
                    Pro+
                  </span>
                )}
                <Switch
                  checked={p.manual_override ?? false}
                  onCheckedChange={(v) => {
                    if (!isProPlus) {
                      openPrompt(PLUS_REASON);
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
                  <NumInput value={p[key]} onCommit={(n) => set({ [key]: n } as Partial<Profile>)} />
                  {key === "override_fhsa" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Note: FHSA is modeled as RRSP for projection purposes (deductible contributions,
                      taxable withdrawals). The tax-free first-home withdrawal benefit is not separately modeled.
                    </p>
                  )}
                  {key === "override_nonreg" && (
                    <div className="mt-2 space-y-1">
                      <Label className="text-xs">Unrealized gain %</Label>
                      <NumInput
                        value={gainRatioOverride ?? (byType.nonregGainRatio != null ? Math.round(byType.nonregGainRatio * 100) : 40)}
                        onCommit={(n) => setGainRatioOverride(Math.min(100, Math.max(0, n)) / 100)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {byType.nonregGainRatio != null
                          ? `From your portfolio (ACB tracked): ${Math.round(byType.nonregGainRatio * 100)}% is gain. Override if needed.`
                          : "No ACB data in portfolio. Using 40% estimate. Enter your actual % if you know it."}
                      </p>
                    </div>
                  )}
                </Field>
              ))}
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
                <h2 className="font-display text-lg font-semibold">
                  Tax-efficient withdrawal plan
                </h2>
                <p className="text-sm text-muted-foreground">
                  {married ? "Household totals" : "Your withdrawals"}, year by year. Rows in red
                  fall short of the spending target; amber rows lose some OAS to the clawback.
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
              become a RRIF and LIRAs a LIF at 71 with the mandatory minimums; eligible pension
              income is split with a spouse after 65 wherever that lowers household tax.
            </p>
          </div>

          {married && (
            <div className="panel space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">
                Split between you and your spouse
              </h2>
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
                          <TableCell className="num text-right">
                            {formatCad(x.nonregDraw)}
                          </TableCell>
                          <TableCell className="num text-right">{formatCad(x.tfsaDraw)}</TableCell>
                          <TableCell className="num text-right">
                            {formatCad(x.cpp + x.oas)}
                          </TableCell>
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
      </main>

      <UpgradeDialog
        open={proPromptOpen}
        onOpenChange={setProPromptOpen}
        reason={promptReason || PRO_REASON}
      />
      {/* Floating calculate button — always reachable while scrolling the planner */}
      {inputs ? (
        <button
          type="button"
          onClick={() => runEarliest(inputs)}
          disabled={earliestLoading}
          title="Calculate earliest retirement age"
          aria-label="Calculate earliest retirement age"
          className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-70 shadow-lg transition hover:scale-105 hover:opacity-100 disabled:opacity-50"
        >
          {earliestLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Calculator className="h-4 w-4" />
          )}
        </button>
      ) : null}
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

/**
 * Numeric input that lets the user clear the field while typing.
 *
 * Problem it solves: a directly-controlled `value={p.x}` input snaps back to
 * the old number the moment the field is emptied (because `num("")` falls back
 * to the previous value), so the user can never delete-to-retype.
 *
 * How it works: keeps local text state while editing. Commits to the profile
 * on every parseable keystroke (so the plan stays live), but an empty or
 * invalid field doesn't commit — and on blur the display reverts to the last
 * committed value instead of getting stuck on "".
 */
function NumInput({
  value,
  onCommit,
  step,
  min,
  max,
  placeholder,
}: {
  value: number | null | undefined;
  onCommit: (n: number) => void;
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value ?? "");

  return (
    <Input
      type="number"
      value={display}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = num(t, NaN);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

function Field({
  label,
  children,
  locked = false,
  planLabel = "Pro",
  onLocked,
}: {
  label: string;
  children: React.ReactNode;
  locked?: boolean;
  planLabel?: string;
  onLocked?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {locked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <Lock className="h-2.5 w-2.5" />
            {planLabel}
          </span>
        ) : null}
      </Label>
      {locked ? (
        <button
          type="button"
          className="w-full text-left"
          title={`Upgrade to ${planLabel} to change this`}
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
  prbAnnual,
  prbYears,
  retirementAge,
}: {
  title: string;
  cppPct: number;
  cppStart: number;
  cppAnnual: number;
  oasStart: number;
  oasAnnual: number;
  oasYears: number;
  prbAnnual?: number;
  prbYears?: number[];
  retirementAge?: number;
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
        {prbAnnual !== undefined && prbAnnual > 0 && prbYears && prbYears.length > 0 && (
          <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
            <p className="font-medium text-foreground">
              Working while collecting CPP: +{formatCad(prbAnnual)}/yr in post-retirement benefits
            </p>
            <p className="mt-1 text-muted-foreground">
              You set CPP to start at {cppStart} but retirement at {retirementAge}. That means{" "}
              {prbYears.length} year{prbYears.length > 1 ? "s" : ""} of contributions while receiving CPP,{" "}
              each earning a post-retirement benefit that stacks on top of your base CPP for life.{" "}
              We've added {formatCad(prbAnnual)}/yr to your projected CPP income.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface GlanceStat {
  key: string;
  label: string;
  value: React.ReactNode;
  tone: "good" | "warn" | "neutral";
  detail: React.ReactNode;
  dimmed?: boolean;
}

/**
 * The Glance Bar: a single sticky strip showing the 5 key retirement numbers.
 * Same structure on every screen size — desktop shows all 5 in a row,
 * phone gets a horizontal swipe strip. Tap any stat for its details.
 * Scrolling only tightens padding; the layout never morphs.
 */
function GlanceBar({
  stats,
  compact,
}: {
  stats: GlanceStat[];
  compact: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openStat = stats.find((s) => s.key === openKey);

  return (
    <div
      className={`sticky top-14 z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 backdrop-blur transition-all duration-200 md:-mx-6 md:px-6 ${
        compact ? "py-1.5 shadow-sm" : "py-2.5 shadow-sm"
      }`}
    >
      <div
        className="flex flex-nowrap items-center gap-1 overflow-x-auto scrollbar-none"
        role="list"
        aria-label="Key retirement figures"
      >
        {stats.map((s) => (
          <button
            key={s.key}
            type="button"
            role="listitem"
            onClick={() => setOpenKey(openKey === s.key ? null : s.key)}
            aria-expanded={openKey === s.key}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 transition-colors hover:bg-accent/60 ${
              compact ? "py-1" : "py-1.5"
            } ${s.dimmed ? "opacity-60" : ""}`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                s.tone === "good"
                  ? "bg-emerald-500"
                  : s.tone === "warn"
                    ? "bg-amber-500"
                    : "bg-muted-foreground/40"
              }`}
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">{s.label}</span>
            <span
              className={`num whitespace-nowrap font-semibold ${
                compact ? "text-xs" : "text-sm"
              } ${
                s.tone === "warn"
                  ? "text-amber-600"
                  : s.tone === "good"
                    ? "text-emerald-600"
                    : "text-foreground"
              }`}
            >
              {s.value}
            </span>
          </button>
        ))}
      </div>
      {openStat && (
        <>
          <button
            type="button"
            aria-label="Close details"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={() => setOpenKey(null)}
          />
          <div className="absolute left-4 right-4 top-full z-40 mt-1 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg md:left-6 md:right-auto md:max-w-sm">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {openStat.label}
            </p>
            {openStat.detail}
          </div>
        </>
      )}
    </div>
  );
}

