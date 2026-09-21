import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApisLogo } from "@/components/brand/ApisLogo";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import { applyReferralCode } from "@/lib/referral.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REF_KEY = "apis_referral_code";

export const Route = createFileRoute("/auth")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): { ref?: string } =>
    typeof search['ref'] === "string" ? { ref: search['ref'] } : {},

  head: () => ({
    meta: [
      { title: "Sign in — Apis Financial" },
      {
        name: "description",
        content:
          "Sign in to Apis Financial to track your TFSA, RRSP and non-registered portfolios in Canadian dollars.",
      },
      { property: "og:title", content: "Sign in — Apis Financial" },
      {
        property: "og:description",
        content: "Canadian portfolio tracking with ACB, MWRR and TWRR built in.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const { ref } = Route.useSearch();
  const applyReferral = useServerFn(applyReferralCode);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(ref ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Remember who invited them until their account exists.
  useEffect(() => {
    if (ref && typeof window !== "undefined") {
      window.localStorage.setItem(REF_KEY, ref.trim().toUpperCase());
    }
  }, [ref]);

  // Arriving from a password-reset email: let them set a new password.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("reset");
    });
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      setMode("reset");
    }
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading || !session || mode === "reset") return;
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(REF_KEY) : null;
    void (async () => {
      if (stored) {
        try {
          await applyReferral({ data: { code: stored } });
        } catch {
          // An invalid or already-used code simply does nothing.
        }
        window.localStorage.removeItem(REF_KEY);
      }
      void navigate({ to: "/dashboard" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, mode]);




  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast.success("Check your email for a link to set a new password.");
        setMode("signin");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Your password is updated.");
        void navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        void navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }


  async function handleOAuth(provider: "google" | "microsoft") {
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      const name = provider === "microsoft" ? "Microsoft" : "Google";
      toast.error(`${name} sign-in failed. Try email instead.`);
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <ApisLogo variant="stacked" size="lg" />
          <p className="text-xs text-muted-foreground">Canadian portfolio tracking</p>
        </div>


        <div className="panel p-6">
          <h2 className="text-xl font-semibold">
            {mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create your account"
                : mode === "forgot"
                  ? "Reset your password"
                  : "Set a new password"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "We will email you a link to choose a new password."
              : mode === "reset"
                ? "Choose a new password for your account."
                : "Track TFSA, RRSP, FHSA and taxable accounts in CAD."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode !== "reset" && (
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            )}
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  {mode === "reset" ? "New password" : "Password"}
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Email me a reset link"
                      : "Save new password"}
            </Button>
          </form>

          {mode !== "reset" && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button variant="outline" className="w-full" onClick={() => void handleOAuth("google")}>
                Continue with Google
              </Button>


              <button
                type="button"
                onClick={() => setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup")}
                className="mt-5 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                {mode === "signin"
                  ? "No account yet? Create one"
                  : "Already have an account? Sign in"}
              </button>

              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="mt-2 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot your password?
                </button>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
