import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NumInput } from "@/components/ui/num-input";
import { formatCad } from "@/lib/finance";
import type { Profile } from "@/lib/profile";
import type { ProvinceCode } from "@/lib/tax";
import { marginalRateAt } from "@/lib/retirement/marginalRate";
import { CANADA_2026_PARAMETERS } from "@/lib/retirement/rules/canada2026";
import type { DerivedWithdrawalRate } from "@/lib/retirement/adapter/oldApiAdapter";
import {
  suggestSavingsAllocation,
  SPOUSAL_GAP_THRESHOLD,
  type SavingsAllocationResult,
} from "@/lib/retirement/optimization/SavingsAllocation";

export function SavingsAllocatorCard({
  profile,
  derivedRate,
  onApply,
  onSaveMatch,
}: {
  profile: Profile;
  /** Projection-derived withdrawal marginal rate (null = fall back to manual input). */
  derivedRate?: DerivedWithdrawalRate | null;
  onApply: (rrspPct: number, tfsaPct: number, nonregPct: number) => void;
  onSaveMatch: (m: { offered: boolean; matchRatePct: number; maxPctOfSalary: number }) => void;
}) {
  const province = (profile.province as ProvinceCode) ?? "AB";
  const currentAge = profile.current_age ?? 40;
  const salary = profile.cpp_future_income ?? 0;

  const [matchOffered, setMatchOffered] = useState(profile.employer_match?.offered ?? false);
  const [matchRatePct, setMatchRatePct] = useState(profile.employer_match?.matchRatePct ?? 50);
  const [matchMaxPct, setMatchMaxPct] = useState(profile.employer_match?.maxPctOfSalary ?? 6);
  const [annualSavings, setAnnualSavings] = useState(profile.annual_savings ?? 12000);
  const [rrspRoom, setRrspRoom] = useState("");
  const [tfsaRoom, setTfsaRoom] = useState("");
  const [fhsaEligible, setFhsaEligible] = useState(false);
  const [fhsaRoom, setFhsaRoom] = useState("");

  const defaultCurrentRate = marginalRateAt(salary, province, currentAge) * 100;
  // The withdrawal rate is an emergent property of the plan: prefer the
  // projection-derived rate; fall back to the old static estimate only when
  // the projection can't provide one (planner-first gate: never silently guess).
  const defaultRetireRate = derivedRate
    ? derivedRate.rate * 100
    : marginalRateAt(profile.desired_income ?? 60000, province, 65) * 100;
  const [currentRatePct, setCurrentRatePct] = useState<number | null>(null);
  const [retireRatePct, setRetireRatePct] = useState<number | null>(null);

  const [result, setResult] = useState<SavingsAllocationResult | null>(null);

  const married = (profile.marital_status ?? "Single") !== "Single";
  const incomeGap = Math.abs(salary - (profile.spouse_cpp_future_income ?? 0));
  const rrspGap = Math.abs((profile.override_rrsp ?? 0) - (profile.spouse_rrsp ?? 0));
  const oasExposure =
    (profile.desired_income ?? 0) >= CANADA_2026_PARAMETERS.oasRecovery.startIncome;

  // Planner-first gate: never run on silent defaults. If the key planner
  // inputs are missing, tell the user to fill them in instead of guessing.
  const missingPlannerInputs: string[] = [];
  if (!salary) missingPlannerInputs.push("Your expected income until retirement");
  if (married && !(profile.spouse_cpp_future_income ?? 0))
    missingPlannerInputs.push("Spouse expected income until retirement");
  if (!(profile.desired_income ?? 0))
    missingPlannerInputs.push("Desired after-tax household income (today's $)");

  // Clear stale results when inputs change.
  const inputsKey = JSON.stringify([
    matchOffered, matchRatePct, matchMaxPct, annualSavings, rrspRoom, tfsaRoom,
    fhsaEligible, fhsaRoom,
    currentRatePct, retireRatePct, salary, profile.desired_income, married, incomeGap, rrspGap,
    missingPlannerInputs.length,
  ]);
  useEffect(() => {
    setResult(null);
  }, [inputsKey]);

  const run = () => {
    onSaveMatch({ offered: matchOffered, matchRatePct, maxPctOfSalary: matchMaxPct });
    const r = suggestSavingsAllocation({
      annualSavings,
      salary,
      currentMarginalRate: (currentRatePct ?? defaultCurrentRate) / 100,
      retirementMarginalRate: (retireRatePct ?? defaultRetireRate) / 100,
      employerMatch: {
        offered: matchOffered,
        matchRate: matchRatePct / 100,
        maxOfSalary: matchMaxPct / 100,
      },
      rrspRoom: rrspRoom === "" ? null : Number(rrspRoom),
      tfsaRoom: tfsaRoom === "" ? null : Number(tfsaRoom),
      fhsaEligible,
      fhsaRoom: fhsaRoom === "" ? null : Number(fhsaRoom),
      married,
      incomeGap,
      rrspBalanceGap: rrspGap,
      oasClawbackExposure: oasExposure,
    });
    setResult(r);
  };

  const apply = () => {
    if (!result || annualSavings <= 0) return;
    const amt = (b: string) => result.steps.find((s) => s.bucket === b)?.amount ?? 0;
    // The planner's savings split has no FHSA field; FHSA is deductible like an
    // RRSP, so its share folds into the RRSP percentage for projection purposes.
    const rrspPct = ((amt("employer_match") + amt("fhsa") + amt("rrsp") + amt("spousal_rrsp")) / annualSavings) * 100;
    const tfsaPct = (amt("tfsa") / annualSavings) * 100;
    const nonregPct = Math.max(0, 100 - rrspPct - tfsaPct);
    onApply(Math.round(rrspPct * 10) / 10, Math.round(tfsaPct * 10) / 10, Math.round(nonregPct * 10) / 10);
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Savings allocation</h3>
        <p className="text-sm text-muted-foreground">
          Waterfall: capture the employer match, then weigh RRSP vs TFSA by today's marginal
          rate against the expected rate on withdrawals in retirement, then non-registered last.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Annual savings ($/yr)</Label>
          <NumInput value={annualSavings} onCommit={(n) => setAnnualSavings(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">RRSP room ($) — blank = assume room</Label>
          <Input
            value={rrspRoom}
            onChange={(e) => setRrspRoom(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Available"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">TFSA room ($) — blank = assume room</Label>
          <Input
            value={tfsaRoom}
            onChange={(e) => setTfsaRoom(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Available"
          />
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Eligible for FHSA?</Label>
            <Switch checked={fhsaEligible} onCheckedChange={setFhsaEligible} />
          </div>
          {fhsaEligible ? (
            <div className="space-y-1">
              <Label className="text-[11px]">FHSA room ($) — blank = assume room</Label>
              <Input
                value={fhsaRoom}
                onChange={(e) => setFhsaRoom(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Available"
              />
              <p className="text-[11px] text-muted-foreground">$8,000/yr max, $40,000 lifetime.</p>
            </div>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Marginal rate today (%)</Label>
          <NumInput
            value={currentRatePct ?? Math.round(defaultCurrentRate * 10) / 10}
            onCommit={(n) => setCurrentRatePct(Math.max(0, Math.min(100, n)))}
          />
          <p className="text-[11px] text-muted-foreground">Estimated {defaultCurrentRate.toFixed(1)}% from your income</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Marginal rate on withdrawals (%)</Label>
          <NumInput
            value={retireRatePct ?? Math.round(defaultRetireRate * 10) / 10}
            onCommit={(n) => setRetireRatePct(Math.max(0, Math.min(100, n)))}
          />
          <p className="text-[11px] text-muted-foreground">
            {derivedRate
              ? derivedRate.label
              : `Estimated ${defaultRetireRate.toFixed(1)}% from retirement spending`}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Employer RRSP match</Label>
            <Switch checked={matchOffered} onCheckedChange={setMatchOffered} />
          </div>
          {matchOffered ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Match %</Label>
                <NumInput value={matchRatePct} onCommit={(n) => setMatchRatePct(Math.max(0, n))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Up to % of salary</Label>
                <NumInput value={matchMaxPct} onCommit={(n) => setMatchMaxPct(Math.max(0, n))} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        {missingPlannerInputs.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 p-3">
            <p className="text-sm font-medium">Complete these planner fields first:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {missingPlannerInputs.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              The allocator needs your actual numbers — it won&apos;t guess.
            </p>
          </div>
        ) : (
          <Button size="sm" onClick={run}>
            {result ? "Recalculate" : "Suggest allocation"}
          </Button>
        )}
      </div>

      {result ? (
        <div className="space-y-3">
          {result.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No annual savings entered — nothing to allocate.</p>
          ) : (
            <ol className="space-y-2">
              {result.steps.map((s, i) => (
                <li key={i} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {i + 1}. {s.label}
                    </span>
                    <span className="text-sm font-semibold">{formatCad(s.amount)}/yr</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
                </li>
              ))}
            </ol>
          )}

          {married ? (
            <p className="text-xs text-muted-foreground">
              Spousal math — income gap {formatCad(incomeGap)} · RRSP balance gap{" "}
              {formatCad(rrspGap)} · threshold {formatCad(SPOUSAL_GAP_THRESHOLD)}{" "}
              {result.steps.some((s) => s.bucket === "spousal_rrsp")
                ? "(gap met → spousal RRSP)"
                : "(gap not met → your RRSP)"}
            </p>
          ) : null}

          {result.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {result.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}

          {result.steps.length > 0 ? (
            <Button size="sm" variant="outline" onClick={apply}>
              Apply to savings split
            </Button>
          ) : null}

          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}

