import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useProfile, useUpdateProfile } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { DebtsForm, DebtComparatorCard } from "@/components/retirement/DebtNetWorth";
import { SmithPage } from "./smith";

export const Route = createFileRoute("/_authenticated/debts")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): {
    tab: "debts" | "heloc" | "compare";
  } => ({
    tab: search["tab"] === "heloc" || search["tab"] === "compare" ? search["tab"] : "debts",
  }),
  head: () => ({
    meta: [
      { title: "Debts — Apis Financial" },
      {
        name: "description",
        content:
          "Manage your debts in one place: mortgages, HELOCs, and loans. Track HELOC investing draws and compare paying down debt versus investing.",
      },
    ],
  }),
  component: DebtsPage,
});

const TABS = [
  { key: "debts", label: "Debts" },
  { key: "heloc", label: "HELOC Investing" },
  { key: "compare", label: "Payoff vs invest" },
] as const;

// Debts hub: mortgages, HELOCs, loans — the HELOC tracker and payoff comparator
// live here as sub-tabs. Linked from Properties for mortgage balances.
function DebtsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm font-medium text-destructive">Couldn&apos;t load your debts</p>
        <p className="text-sm text-muted-foreground">
          The request timed out or failed. Your data is safe — try again.
        </p>
        <Button type="button" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const debts = profile?.debts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => navigate({ to: "/debts", search: { tab: t.key } })}
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
      ) : tab === "compare" ? (
        profile ? (
          <DebtComparatorCard profile={profile} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading your plan…</p>
        )
      ) : (
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Debts</h1>
            <p className="text-sm text-muted-foreground">
              One list for every debt. Your{" "}
              <Link to="/debts" search={{ tab: "heloc" }} className="underline">
                HELOC Investing
              </Link>{" "}
              draws update your HELOC here, and{" "}
              <Link to="/investments" search={{ tab: "properties" }} className="underline">
                Properties
              </Link>{" "}
              can link their mortgages to these balances.
            </p>
          </div>

          <DebtsForm value={debts} onChange={(v) => updateProfile.mutate({ debts: v })} />
        </div>
      )}
    </div>
  );
}
