import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Coins,
  LayoutDashboard,
  FileUp,
  Leaf,
  LogOut,
  Moon,
  Receipt,
  Landmark,
  RefreshCw,

  Sun,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/lib/portfolio";
import { formatCad, formatPct, summariseAccount } from "@/lib/finance";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  component: AppLayout,
});

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ledger", label: "Ledger", icon: Receipt },
  { to: "/dividends", label: "Dividends", icon: Coins },
  { to: "/performance", label: "Performance", icon: BarChart3 },
  { to: "/retirement", label: "Retirement", icon: Landmark },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/import", label: "Import", icon: FileUp },
] as const;

function AppLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-sm text-muted-foreground">Loading your portfolio…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function AppHeader() {
  const {
    accounts,
    holdings,
    transactions,
    quotes,
    fxUsdCad,
    pricesAsOf,
    refreshingPrices,
    refreshPrices,
  } = usePortfolio();

  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const summaries = accounts.map((a) =>
    summariseAccount(
      a,
      transactions.filter((t) => t.account_id === a.id),
      holdings.filter((h) => h.account_id === a.id),
      quotes,
      fxUsdCad,
    ),
  );
  const total = summaries.reduce((s, x) => s + x.totalValue, 0);
  const dayChange = summaries.reduce((s, x) => s + x.dayChange, 0);
  const dayPct = total - dayChange !== 0 ? (dayChange / (total - dayChange)) * 100 : 0;

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-4 px-4 py-3 md:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="h-4 w-4" />
          </span>
          <span className="font-display text-base font-semibold">MapleWealth</span>
        </Link>

        <div className="hidden items-center gap-1 rounded-lg bg-muted p-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "bg-card text-foreground shadow-sm" }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Portfolio (CAD)
            </p>
            <p className="num text-sm font-semibold">{formatCad(total)}</p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Day</p>
            <p
              className={`num text-sm font-semibold ${dayChange >= 0 ? "text-gain" : "text-loss"}`}
            >
              {formatCad(dayChange)} ({formatPct(dayPct)})
            </p>
          </div>
          <div className="hidden text-right lg:block">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">USD/CAD</p>
            <p className="num text-sm font-semibold">{fxUsdCad.toFixed(4)}</p>
          </div>
          <div className="hidden text-right lg:block">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prices as of</p>
            <p className="num text-sm font-semibold">{pricesAsOf ?? "—"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh prices"
            disabled={refreshingPrices}
            onClick={() => refreshPrices()}
          >
            <RefreshCw className={`h-4 w-4 ${refreshingPrices ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={() => {
              void supabase.auth.signOut();
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
            activeProps={{ className: "bg-muted text-foreground" }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
