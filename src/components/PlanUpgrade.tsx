import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Gift, Sparkle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { SUBSCRIPTION_PRICE } from "@/lib/stripe";
import { redeemInviteCode } from "@/lib/entitlement.functions";

const FREE_POINTS = [
  "Unlimited accounts and holdings",
  "Ledger with adjusted cost base",
  "Dividends, benchmarking and performance",
  "The full household retirement planner",
  "CSV imports and typing transactions in",
];

const PAID_POINTS = [
  "Everything in the free plan",
  "Upload a PDF statement and have it read for you",
  "Upload a screenshot or photo of a statement",
  "Rows are drafted for you to check before saving",
];

export function PlanUpgrade({ onDone }: { onDone?: () => void }) {
  const [checkout, setCheckout] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const redeem = useServerFn(redeemInviteCode);
  const qc = useQueryClient();

  async function applyCode() {
    setRedeeming(true);
    try {
      const result = await redeem({ data: { code } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["entitlement"] });
      toast.success("Your invite code is applied — everything is unlocked.");
      setCode("");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply that code");
    } finally {
      setRedeeming(false);
    }
  }

  if (checkout) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>
          ← Back to plans
        </Button>
        <StripeEmbeddedCheckout
          priceId={checkout}
          returnUrl={`${window.location.origin}/plan?session_id={CHECKOUT_SESSION_ID}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Free</p>
          <p className="mt-1 text-2xl font-semibold">$0</p>
          <p className="text-sm text-muted-foreground">forever, no card needed</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {FREE_POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border-2 border-primary p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <Sparkle className="h-4 w-4" /> Statement reading
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl font-semibold">{SUBSCRIPTION_PRICE.amount}</p>
            <p className="text-sm text-muted-foreground">{SUBSCRIPTION_PRICE.period}</p>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {PAID_POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {p}
              </li>
            ))}
          </ul>
          <Button className="mt-4 w-full" onClick={() => setCheckout(SUBSCRIPTION_PRICE.id)}>
            Subscribe — {SUBSCRIPTION_PRICE.label}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Gift className="h-4 w-4" /> Have an invite code?
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Codes from the Apis Financial team unlock everything at no charge.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-code">Code</Label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              className="w-44 font-mono"
            />
          </div>
          <Button
            variant="secondary"
            disabled={!code.trim() || redeeming}
            onClick={() => void applyCode()}
          >
            Apply code
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UpgradeDialog({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apis Financial plans</DialogTitle>
          <DialogDescription>
            {reason ??
              "Everything is free. The only paid extra is having PDFs and photos read for you."}
          </DialogDescription>
        </DialogHeader>
        <PlanUpgrade onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
