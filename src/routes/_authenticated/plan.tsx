import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { PlanUpgrade } from "@/components/PlanUpgrade";
import { useEntitlement, formatDate } from "@/lib/entitlement";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/utils/payments.functions";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({
    meta: [
      { title: "Your plan — MapleWealth" },
      {
        name: "description",
        content:
          "Stay on the free plan with one account and ten holdings, or go Pro for unlimited accounts and holdings.",
      },
      { property: "og:title", content: "Your plan — MapleWealth" },
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
  const portal = useServerFn(createPortalSession);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const isOwner = entitlement.plan === "owner";
  const isPaid = entitlement.tier === "pro" && !isOwner;
  const isInvite = entitlement.tier === "invite";


  return (
    <div className="space-y-6">
      <PaymentTestModeBanner />

      <div>
        <h1 className="text-2xl font-semibold">Your plan</h1>
        <p className="text-sm text-muted-foreground">
          Free covers one account and ten holdings. Pro removes both limits.
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <p className="font-medium">
            {isOwner ? "Owner — full access" : isPaid ? "Pro" : isInvite ? "Pro — invite code" : "Free"}
          </p>

          {entitlement.readOnly && <Badge variant="destructive">View only</Badge>}
          {entitlement.cancelAtPeriodEnd && <Badge variant="secondary">Ends at period end</Badge>}
          {isPaid && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => void openPortal()}>
              <CreditCard className="mr-2 h-4 w-4" />
              Manage subscription
            </Button>
          )}
        </div>

        {entitlement.readOnly ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Your access ended on {formatDate(entitlement.accessEndsAt)}. Your data stays safe and
            readable — nothing is deleted. You can start Pro again at any time to make changes.
          </p>
        ) : entitlement.accessEndsAt ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {isInvite ? "Free access runs until" : "Renews on"} {formatDate(entitlement.accessEndsAt)}.
          </p>
        ) : isInvite ? (
          <p className="mt-3 text-sm text-muted-foreground">Free access with no end date.</p>
        ) : isOwner ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You own MapleWealth, so no limits apply to your own account.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            You are on the free plan: 1 account and up to 10 holdings.
          </p>
        )}
      </div>

      {!isPaid && !isInvite && !isOwner && <PlanUpgrade />}

    </div>
  );
}
