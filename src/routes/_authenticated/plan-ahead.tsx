import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/plan-ahead")({
  staticData: { sitemap: false },
  component: PlanAheadRedirect,
});

// "Plan ahead" was dissolved in the 6-hub reorg: net worth moved to Dashboard,
// the HELOC tracker and payoff comparator moved to Debts, FIRE and savings
// allocation moved to Retirement. Keep the old URL working.
function PlanAheadRedirect() {
  throw redirect({ to: "/dashboard" });
}
