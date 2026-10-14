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

/** The one and only paid plan: $10 a year (Pro) — AI statement reading plus the HELOC investing tracker. */
export const SUBSCRIPTION_PRICE = {
  id: "pro_yearly",
  label: "$10 / year",
  amount: "$10",
  period: "per year",
} as const;

/** The single paid plan: Pro, $10/year. (Legacy "pro_plus" tiers are still
 * recognized by the entitlement system for existing subscriptions.) */
export type PaidPlan = "pro";

export const PLAN_PRICES: Record<PaidPlan, { id: string; label: string }> = {
  pro: { id: "pro_yearly", label: "$10 / year" },
};

export function planOfPrice(priceId: string | null): PaidPlan | null {
  if (!priceId) return null;
  if (priceId.startsWith("pro")) return "pro";
  return null;
}
