const clientToken = import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"] as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Checkout is not configured yet. Add your Stripe publishable key to this environment.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        Payments are in Stripe test mode in this environment.
      </div>
    );
  }
  return null;
}
