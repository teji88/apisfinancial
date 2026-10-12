import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumInput } from "@/components/ui/num-input";
import { formatCad } from "@/lib/finance";
import type { Profile } from "@/lib/profile";
import { computeFire } from "@/lib/retirement/optimization/Fire";

function formatYears(n: number): string {
  if (n < 1) return `${Math.round(n * 12)} month${Math.round(n * 12) === 1 ? "" : "s"}`;
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} year${rounded === 1 ? "" : "s"}`;
}

/**
 * FIRE calculator card: classic FIRE number and Coast FIRE progress.
 * Pure deterministic math, today's dollars, real returns.
 * Informational only — not financial advice.
 */
export function FireCalculatorCard({
  profile,
  investedTotal,
}: {
  profile: Profile;
  investedTotal: number;
}) {
  const [mode, setMode] = useState<"classic" | "coast">("classic");
  const [spend, setSpend] = useState(profile.desired_income ?? 60000);
  const [withdrawalPct, setWithdrawalPct] = useState(4);
  const [realReturnPct, setRealReturnPct] = useState(5);
  const [currentAge, setCurrentAge] = useState(profile.current_age ?? 40);
  const [retireAge, setRetireAge] = useState(profile.target_retirement_age ?? 65);
  const [contrib, setContrib] = useState(profile.annual_savings ?? 0);

  const yearsToRetirement = Math.max(0, retireAge - currentAge);
  const r = computeFire({
    annualSpend: spend,
    withdrawalRate: Math.max(0.1, withdrawalPct) / 100,
    realReturn: realReturnPct / 100,
    yearsToRetirement,
    currentInvested: investedTotal,
    annualContribution: contrib,
  });

  const progressPct = Math.round(r.progress * 100);
  const coastPct = Math.round(
    Math.min(1, Math.max(0, investedTotal / Math.max(1, r.coastNumber))) * 100,
  );
  const shownPct = mode === "classic" ? progressPct : coastPct;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">FIRE calculator</h3>
          <p className="text-sm text-muted-foreground">
            {mode === "classic"
              ? "The portfolio that funds your spending at your withdrawal rate."
              : "What you need invested today so compounding alone gets you there by retirement."}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {(["classic", "coast"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "classic" ? "Classic FIRE" : "Coast FIRE"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Annual retirement spending ($)</Label>
          <NumInput value={spend} onCommit={(n) => setSpend(Math.max(0, n))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Withdrawal rate (%/yr)</Label>
          <NumInput value={withdrawalPct} onCommit={(n) => setWithdrawalPct(Math.max(0.1, n))} step="0.1" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Expected real return (%/yr)</Label>
          <NumInput value={realReturnPct} onCommit={(n) => setRealReturnPct(Math.max(0, n))} step="0.1" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Current age</Label>
          <Input
            type="number"
            value={currentAge}
            onChange={(e) => setCurrentAge(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Retirement age</Label>
          <Input
            type="number"
            value={retireAge}
            onChange={(e) => setRetireAge(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Annual contributions ($)</Label>
          <NumInput value={contrib} onCommit={(n) => setContrib(Math.max(0, n))} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">FIRE number</div>
          <div className="text-2xl font-bold">{formatCad(r.fireNumber, 0)}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatCad(spend, 0)}/yr at {withdrawalPct}% withdrawal
          </div>
        </div>
        {mode === "coast" ? (
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Coast number (invested today)</div>
            <div className="text-2xl font-bold">{formatCad(r.coastNumber, 0)}</div>
            <div className="text-[11px] text-muted-foreground">
              Grows to {formatCad(r.fireNumber, 0)} in {yearsToRetirement} years at {realReturnPct}% real
            </div>
          </div>
        ) : (
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Invested today</div>
            <div className="text-2xl font-bold">{formatCad(Math.max(0, investedTotal), 0)}</div>
            <div className="text-[11px] text-muted-foreground">
              Excludes home equity
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {mode === "classic" ? "Progress to FIRE number" : "Progress to coast number"}
          </span>
          <span className="font-medium">{shownPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${shownPct}%` }}
          />
        </div>
      </div>

      {mode === "coast" ? (
        <p className="text-sm">
          {r.yearsToCoast === 0 ? (
            <span className="font-medium">You can coast now — compounding alone reaches your FIRE number by {retireAge}.</span>
          ) : r.yearsToCoast == null ? (
            <span className="text-muted-foreground">
              Not reachable at this savings pace and return — raise contributions or the expected return.
            </span>
          ) : (
            <span>
              On track to coast at age{" "}
              <span className="font-medium">{Math.round((currentAge + r.yearsToCoast) * 10) / 10}</span>{" "}
              ({formatYears(r.yearsToCoast)} from now).
            </span>
          )}
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Illustrative math, not financial advice. Today's dollars; returns are real (after inflation).
      </p>
    </div>
  );
}
