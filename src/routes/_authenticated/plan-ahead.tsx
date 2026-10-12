import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { summariseAccount } from "@/lib/finance";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile, type Profile } from "@/lib/profile";
import { NetWorthCard, DebtComparatorCard } from "@/components/retirement/DebtNetWorth";
import { SavingsAllocatorCard } from "@/components/retirement/SavingsAllocatorCard";
import { FireCalculatorCard } from "@/components/retirement/FireCalculatorCard";
import { SmithPage } from "./smith";

export const Route = createFileRoute("/_authenticated/plan-ahead")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): { tab: "overview" | "heloc" } => ({
    tab: search["tab"] === "heloc" ? "heloc" : "overview",
  }),
  head: () => ({
    meta: [
      { title: "Plan ahead — Apis Financial" },
      {
        name: "description",
        content:
          "Net worth, debt payoff vs invest, savings allocation, FIRE planning, and the HELOC investing tracker.",
      },
    ],
  }),
  component: PlanAheadPage,
});

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "heloc", label: "HELOC Investing" },
] as const;

function PlanAheadPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { accounts, holdings, transactions, quotes, fxUsdCad } = usePortfolio();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();

  const set = (patch: Partial<Profile>) => updateProfile.mutate(patch);

  const investedTotal = useMemo(() => {
    let total = 0;
    for (const a of accounts) {
      const s = summariseAccount(
        a,
        transactions.filter((t) => t.account_id === a.id),
        holdings.filter((h) => h.account_id === a.id),
        quotes,
        fxUsdCad,
      );
      total += s.marketValue + Math.max(0, s.cash);
    }
    return total;
  }, [accounts, holdings, transactions, quotes, fxUsdCad]);

  if (!profile) {
    return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Plan ahead</h1>
        <p className="text-sm text-muted-foreground">
          Net worth, debt strategy, savings, FIRE, and HELOC investing — the years before
          retirement.
        </p>
      </div>
      <div className="flex gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate({ to: "/plan-ahead", search: { tab: t.key } })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "heloc" ? (
        <SmithPage />
      ) : (
        <div className="space-y-4">
          <NetWorthCard
            profile={profile}
            investments={investedTotal}
            onSave={(v) => set({ net_worth: v })}
          />
          <DebtComparatorCard profile={profile} />
          <SavingsAllocatorCard
            profile={profile}
            onApply={(rrspPct, tfsaPct, nonregPct) =>
              set({ save_pct_rrsp: rrspPct, save_pct_tfsa: tfsaPct, save_pct_nonreg: nonregPct })
            }
            onSaveMatch={(m) => set({ employer_match: m })}
          />
          <FireCalculatorCard profile={profile} investedTotal={investedTotal} />
        </div>
      )}
    </div>
  );
}
