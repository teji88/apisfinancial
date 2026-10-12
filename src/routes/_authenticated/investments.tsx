import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LedgerPage } from "./ledger";
import { DividendsPage } from "./dividends";
import { PerformancePage } from "./performance";
import { PropertiesPage } from "./properties";

export const Route = createFileRoute("/_authenticated/investments")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): {
    tab: "ledger" | "dividends" | "performance" | "properties";
  } => ({
    tab:
      search["tab"] === "dividends" ||
      search["tab"] === "performance" ||
      search["tab"] === "properties"
        ? search["tab"]
        : "ledger",
  }),
  head: () => ({
    meta: [
      { title: "Investments — Apis Financial" },
      {
        name: "description",
        content:
          "Everything you own: the transaction ledger, dividend income, performance benchmarking and investment properties.",
      },
    ],
  }),
  component: InvestmentsPage,
});

const TABS = [
  { key: "ledger", label: "Ledger" },
  { key: "dividends", label: "Dividends" },
  { key: "performance", label: "Performance" },
  { key: "properties", label: "Properties" },
] as const;

function InvestmentsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => navigate({ to: "/investments", search: { tab: t.key } })}
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
      {tab === "ledger" ? (
        <LedgerPage />
      ) : tab === "dividends" ? (
        <DividendsPage />
      ) : tab === "performance" ? (
        <PerformancePage />
      ) : (
        <PropertiesPage />
      )}
    </div>
  );
}
