import { loadStripe, type Stripe } from "@stripe/stripe-js";

type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Payments are not configured for this build. Complete go-live in your Lovable project to enable checkout.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

/** The two paid plans, each billed monthly or yearly. */
export const PLAN_PRICES = {
  pro: {
    monthly: { id: "pro_monthly", label: "$1 / month" },
    yearly: { id: "pro_yearly", label: "$10 / year" },
  },
  pro_plus: {
    monthly: { id: "pro_plus_monthly", label: "$2 / month" },
    yearly: { id: "pro_plus_yearly", label: "$20 / year" },
  },
} as const;

export const PRO_PRICES = PLAN_PRICES.pro;

export type PaidPlan = keyof typeof PLAN_PRICES;
export type ProBilling = "monthly" | "yearly";

/** Which plan a stored price id belongs to. */
export function planOfPrice(priceId: string | null): PaidPlan | null {
  if (!priceId) return null;
  if (priceId.startsWith("pro_plus")) return "pro_plus";
  if (priceId.startsWith("pro_")) return "pro";
  return null;
}
