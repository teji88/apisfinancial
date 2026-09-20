import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Coins,
  CreditCard,
  Gift,
  LayoutDashboard,
  FileUp,

  LogOut,
  Menu,
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
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ApisLogo } from "@/components/brand/ApisLogo";

import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/lib/portfolio";
import { useProfile, useUpdateProfile } from "@/lib/profile";
import { useEntitlement, formatDate } from "@/lib/entitlement";
import { deleteMyAccount } from "@/lib/account.functions";
import { getStripeEnvironment } from "@/lib/stripe";
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
  staticData: { sitemap: "exclude-subtree" },
  component: AppLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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
      <ReadOnlyBanner />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function ReadOnlyBanner() {
  const { entitlement } = useEntitlement();
  if (!entitlement.readOnly) return null;
  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
      Your plan ended on {formatDate(entitlement.accessEndsAt)} — Apis Financial is view-only. Nothing
      has been deleted.{" "}
      <Link to="/plan" className="font-medium underline">
        Restart Pro
      </Link>
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
    <header className="sticky top-0 z-30 overflow-hidden border-b bg-background backdrop-blur">
      <div className="pointer-events-none absolute inset-0 bg-card" aria-hidden />
      <div className="pointer-events-none absolute inset-0 honey-cascade" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 hex-mesh hex-cascade-soft"
        aria-hidden
      />
      <div className="relative mx-auto flex w-full max-w-7xl flex-wrap items-center gap-4 px-4 py-3 md:px-6">
        <MobileNav />
        <Link to="/dashboard" className="flex items-center gap-2">
          <ApisLogo variant="full" size="sm" />
        </Link>


        <div className="hidden items-center gap-1 rounded-lg bg-secondary/70 p-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
              activeProps={{
                className:
                  "bg-accent/20 text-foreground shadow-sm ring-1 ring-accent/40 font-medium",
              }}
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

    </header>
  );
}

function ProfileMenu() {
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const { entitlement } = useEntitlement();
  const removeAccount = useServerFn(deleteMyAccount);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [province, setProvince] = useState("AB");
  const [currency, setCurrency] = useState("CAD");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const profile = profileQuery.data;
  const planLabel =
    entitlement.tier === "pro" ? "Pro" : entitlement.tier === "invite" ? "Pro (invite)" : "Free";

  function openSettings() {
    setName(profile?.display_name ?? "");
    setProvince(profile?.province ?? "AB");
    setCurrency(profile?.base_currency ?? "CAD");
    setNewPassword("");
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

  async function changePassword() {
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Your password is updated.");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change your password");
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        "This permanently deletes your Apis Financial account and all of your accounts, holdings and transactions. This cannot be undone. Continue?",
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const result = await removeAccount({ data: { environment: getStripeEnvironment() } });
      if ("error" in result) throw new Error(result.error);
      toast.success("Your account is deleted.");
      await supabase.auth.signOut();
      window.location.href = "/auth";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete your account");
    } finally {
      setDeleting(false);
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
              {profile?.province ?? "AB"} · {profile?.base_currency ?? "CAD"} · {planLabel}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/plan">
              <CreditCard className="mr-2 h-4 w-4" />
              Your plan
            </Link>
          </DropdownMenuItem>
          {entitlement.isAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/invites">
                <Gift className="mr-2 h-4 w-4" />
                Invite codes
              </Link>
            </DropdownMenuItem>
          )}
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

            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="new-password">New password</Label>
              <div className="flex gap-2">
                <Input
                  id="new-password"
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                />
                <Button
                  variant="secondary"
                  disabled={newPassword.length < 6 || savingPassword}
                  onClick={() => void changePassword()}
                >
                  Change
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <p className="text-sm font-medium text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Removes your login and every account, holding and transaction. This cannot be
                undone.
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => void deleteAccount()}
              >
                Delete my account
              </Button>
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
