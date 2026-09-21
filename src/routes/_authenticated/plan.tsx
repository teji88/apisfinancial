import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { PlanUpgrade } from "@/components/PlanUpgrade";
import { useEntitlement, formatDate } from "@/lib/entitlement";
import { getStripeEnvironment, PLAN_PRICES, planOfPrice, type PaidPlan } from "@/lib/stripe";
import {
  createPortalSession,
  syncSubscription,
  changeSubscriptionPlan,
  setSubscriptionCancel,
} from "@/utils/payments.functions";

export const Route = createFileRoute("/_authenticated/plan")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search['session_id'] === "string" ? { session_id: search['session_id'] } : {},
  head: () => ({
    meta: [
      { title: "Your plan — Apis Financial" },
      {
        name: "description",
        content:
          "Stay on the free plan with one account and ten holdings, or go Pro for unlimited accounts and holdings.",
      },
      { property: "og:title", content: "Your plan — Apis Financial" },
      {
        property: "og:description",
        content: "Free covers one account and ten holdings. Pro is $1 a month or $10 a year.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanPage,
});

function PlanPage() {
  const { entitlement, refetch } = useEntitlement();
  const { session_id: sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const portal = useServerFn(createPortalSession);
  const sync = useServerFn(syncSubscription);
  const changePlan = useServerFn(changeSubscriptionPlan);
  const setCancel = useServerFn(setSubscriptionCancel);

  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isOwner = entitlement.plan === "owner";
  const isPaid = (entitlement.tier === "pro" || entitlement.tier === "pro_plus") && !isOwner;
  const isInvite = entitlement.tier === "invite";
  const isTrial = entitlement.tier === "trial";
  const isReferral = entitlement.tier === "referral";
  const currentPlan: PaidPlan = planOfPrice(entitlement.plan) ?? "pro";
  const billing = (entitlement.plan ?? "").endsWith("monthly") ? "monthly" : "yearly";
  const otherPlan: PaidPlan = currentPlan === "pro" ? "pro_plus" : "pro";
  const planName = (plan: PaidPlan) => (plan === "pro_plus" ? "Pro+" : "Pro");



  async function refreshFromProvider(quiet = false) {
    const result = await sync({ data: { environment: getStripeEnvironment() } });
    await qc.invalidateQueries({ queryKey: ["entitlement"] });
    const next = await refetch();
    if (!quiet && result && "error" in result) toast.error(result.error);
    return next.data;
  }

  // Coming back from the payment window: wait for the payment to register.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setConfirming(true);
    (async () => {
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        const data = await refreshFromProvider(true);
        if (data && data.tier !== "free") {
          toast.success("Payment received — your plan is active. Thank you!");
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setConfirming(false);
        void navigate({ to: "/plan", search: {}, replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(key: string, fn: () => Promise<{ ok?: true } | { error: string } | void>) {
    setBusy(key);
    try {
      const result = await fn();
      if (result && "error" in result) {
        toast.error(result.error);
        return;
      }
      await refreshFromProvider(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    try {
      const result = await portal({
        data: { environment: getStripeEnvironment(), returnUrl: window.location.href },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing");
    }
  }

  return (
    <div className="space-y-6">
      <PaymentTestModeBanner />

      <div>
        <h1 className="text-2xl font-semibold">Your plan</h1>
        <p className="text-sm text-muted-foreground">
          Free covers one account and ten holdings. Pro removes both limits.
        </p>
      </div>

      {confirming && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
          Confirming your payment… this usually takes a few seconds.
        </div>
      )}

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <p className="font-medium">
            {isOwner
              ? "Owner — full access"
              : isPaid
                ? `${planName(currentPlan)} — ${
                    currentPlan === "pro"
                      ? billing === "monthly"
                        ? "$1 a month"
                        : "$10 a year"
                      : billing === "monthly"
                        ? "$2 a month"
                        : "$20 a year"
                  }`
                : isInvite
                  ? "Pro+ — invite code"
                  : isTrial
                    ? "Free trial — everything unlocked"
                    : isReferral
                      ? `${entitlement.plan === "pro_plus" ? "Pro+" : "Pro"} — free year from a referral`
                      : "Free"}

          </p>
          {entitlement.readOnly && <Badge variant="destructive">View only</Badge>}
          {entitlement.cancelAtPeriodEnd && <Badge variant="secondary">Ends at period end</Badge>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={busy === "sync"}
            onClick={() => void run("sync", async () => void (await refreshFromProvider()))}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {entitlement.readOnly ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {entitlement.readOnlyReason === "overlimit"
              ? "You are carrying more than the free plan allows (1 account, 10 holdings). Everything stays visible, and you can delete the extras to start editing again — or restart Pro to keep it all."
              : `Your access ended on ${formatDate(entitlement.accessEndsAt)}. Your data stays safe and readable — nothing is deleted. Restart Pro at any time to make changes again.`}
          </p>
        ) : entitlement.accessEndsAt ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {isInvite
              ? `Free access runs until ${formatDate(entitlement.accessEndsAt)}.`
              : entitlement.cancelAtPeriodEnd
                ? `Pro stays on until ${formatDate(entitlement.accessEndsAt)}, then you return to the free plan.`
                : `Renews on ${formatDate(entitlement.accessEndsAt)}.`}
          </p>
        ) : isInvite ? (
          <p className="mt-3 text-sm text-muted-foreground">Free access with no end date.</p>
        ) : isOwner ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You own Apis Financial, so no limits apply to your own account.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            You are on the free plan: 1 account and up to 10 holdings.
          </p>
        )}

        {isPaid && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run("switch", () =>
                  changePlan({
                    data: {
                      priceId:
                        PLAN_PRICES[currentPlan][billing === "monthly" ? "yearly" : "monthly"].id,
                      environment: getStripeEnvironment(),
                    },
                  }),
                )
              }
            >
              Switch to {billing === "monthly" ? "yearly" : "monthly"} (
              {PLAN_PRICES[currentPlan][billing === "monthly" ? "yearly" : "monthly"].label})
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run("plan", () =>
                  changePlan({
                    data: {
                      priceId: PLAN_PRICES[otherPlan][billing].id,
                      environment: getStripeEnvironment(),
                    },
                  }),
                )
              }
            >
              {currentPlan === "pro" ? "Upgrade to" : "Change to"} {planName(otherPlan)} (
              {PLAN_PRICES[otherPlan][billing].label})
            </Button>


            {entitlement.cancelAtPeriodEnd ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void run("resume", () =>
                    setCancel({ data: { cancel: false, environment: getStripeEnvironment() } }),
                  )
                }
              >
                Keep Pro running
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void run("cancel", () =>
                    setCancel({ data: { cancel: true, environment: getStripeEnvironment() } }),
                  )
                }
              >
                Cancel at period end
              </Button>
            )}

            <Button variant="ghost" size="sm" onClick={() => void openPortal()}>
              <CreditCard className="mr-2 h-4 w-4" />
              Card &amp; receipts
            </Button>
          </div>
        )}
      </div>

      {!isPaid && !isInvite && !isOwner && <PlanUpgrade />}
    </div>
  );
}
