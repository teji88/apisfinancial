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
  Settings,
  Sun,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile } from "@/lib/profile";
import { PROVINCES, PROVINCE_CODES } from "@/lib/tax";
import { formatCad, formatPct, summariseAccount } from "@/lib/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

          <ProfileMenu />
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

function ProfileMenu() {
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [province, setProvince] = useState("AB");
  const [currency, setCurrency] = useState("CAD");

  const profile = profileQuery.data;

  function openSettings() {
    setName(profile?.display_name ?? "");
    setProvince(profile?.province ?? "AB");
    setCurrency(profile?.base_currency ?? "CAD");
    setOpen(true);
  }

  async function save() {
    try {
      await updateProfile.mutateAsync({
        display_name: name.trim() || null,
        province,
        base_currency: currency,
      });
      toast.success("Profile saved");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Profile">
            <User className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <p className="text-sm font-medium">{profile?.display_name ?? "Your profile"}</p>
            <p className="text-xs font-normal text-muted-foreground">
              {profile?.province ?? "AB"} · {profile?.base_currency ?? "CAD"}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTimeout(openSettings, 0)}>
            <Settings className="mr-2 h-4 w-4" />
            Profile settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void supabase.auth.signOut();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Profile settings</DialogTitle>
            <DialogDescription>
              Your home province sets the tax rates used across the retirement plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Province</Label>
              <Select value={province} onValueChange={setProvince}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCE_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {PROVINCES[code].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Display currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={updateProfile.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
