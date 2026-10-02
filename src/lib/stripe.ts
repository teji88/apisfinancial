import { loadStripe, type Stripe } from "@stripe/stripe-js";

type StripeEnv = "sandbox" | "live";

const publishableKey = import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"] as string | undefined;

function paymentsEnvironment(): StripeEnv {
  if (publishableKey?.startsWith("pk_test_")) return "sandbox";
  if (publishableKey?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Payments are not configured for this build. Add VITE_STRIPE_PUBLISHABLE_KEY to the environment.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(publishableKey as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

/** The one and only paid plan: $10 a year, for AI statement reading. */
export const SUBSCRIPTION_PRICE = {
  id: "pro_yearly",
  label: "$10 / year",
  amount: "$10",
  period: "per year",
} as const;

export type PaidPlan = "pro" | "pro_plus";
export type ProBilling = "monthly" | "yearly";

export const PLAN_PRICES: Record<PaidPlan, Record<ProBilling, { id: string; label: string }>> = {
  pro: {
    monthly: { id: "pro_monthly", label: "$1 / month" },
    yearly: { id: "pro_yearly", label: "$10 / year" },
  },
  pro_plus: {
    monthly: { id: "pro_plus_monthly", label: "$2 / month" },
    yearly: { id: "pro_plus_yearly", label: "$20 / year" },
  },
};

export function planOfPrice(priceId: string | null): PaidPlan | null {
  if (!priceId) return null;
  if (priceId.startsWith("pro_plus")) return "pro_plus";
  if (priceId.startsWith("pro")) return "pro";
  return null;
}
