import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently removes the signed-in person's account.
 * Any running subscription is stopped first, then the login and all
 * linked data (accounts, holdings, transactions, profile) are deleted.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: "sandbox" | "live" }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    const { supabase, userId } = context;

    try {
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("stripe_subscription_id, status")
        .eq("user_id", userId)
        .eq("environment", data.environment);

      const live = (subs ?? []).filter((s) =>
        ["active", "trialing", "past_due", "unpaid"].includes(s.status),
      );

      if (live.length) {
        const { createStripeClient } = await import("@/lib/stripe.server");
        const stripe = createStripeClient(data.environment);
        for (const sub of live) {
          try {
            await stripe.subscriptions.cancel(sub.stripe_subscription_id);
          } catch {
            // Already gone on the provider side — carry on with the deletion.
          }
        }
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) return { error: error.message };
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not delete your account." };
    }
  });
