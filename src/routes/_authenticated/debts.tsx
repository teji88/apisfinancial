import { createFileRoute, Link } from "@tanstack/react-router";
import { useProfile, useUpdateProfile } from "@/lib/profile";
import { DebtsForm } from "@/components/retirement/DebtNetWorth";

export const Route = createFileRoute("/_authenticated/debts")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Debts — Apis Financial" },
      {
        name: "description",
        content:
          "Manage your debts in one place: mortgages, HELOCs, and loans. The Smith Manoeuvre and Properties tabs link to these balances.",
      },
    ],
  }),
  component: DebtsPage,
});

// Debts hub: mortgages, HELOCs, loans — linked from Smith and Properties tabs.
function DebtsPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const debts = profile?.debts ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Debts</h1>
        <p className="text-sm text-muted-foreground">
          One list for every debt. Your{" "}
          <Link to="/smith" className="underline">Smith Manoeuvre</Link> draws update
          your HELOC here, and{" "}
          <Link to="/properties" className="underline">Properties</Link> can link
          their mortgages to these balances.
        </p>
      </div>

      <DebtsForm
        value={debts}
        onChange={(v) => updateProfile.mutate({ debts: v })}
      />
    </div>
  );
}
