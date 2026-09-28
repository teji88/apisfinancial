import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type CheckoutSessionResult = { clientSecret: string } | { error: string };
type PortalSessionResult = { url: string } | { error: string };

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string | undefined; userId?: string | undefined },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length) return found.data[0]!.id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0]!;
      if (options.userId && customer.metadata?.["userId"] !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

/** Pull every subscription Stripe knows about for this user into our own table. */
async function syncFromStripe(
  stripe: ReturnType<typeof createStripeClient>,
  userId: string,
  email: string | undefined,
  env: StripeEnv,
): Promise<number> {
  const customerId = await resolveOrCreateCustomer(stripe, { email, userId });
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });
  if (!subs.data.length) return 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = subs.data.map((sub) => {
    const item = sub.items?.data?.[0] as any;
    const start = item?.current_period_start ?? (sub as any).current_period_start;
    const end = item?.current_period_end ?? (sub as any).current_period_end;
    return {
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      product_id: typeof item?.price?.product === "string" ? item.price.product : null,
      price_id: item?.price?.lookup_key ?? item?.price?.metadata?.lovable_external_id ?? null,
      status: sub.status,
      current_period_start: start ? new Date(start * 1000).toISOString() : null,
      current_period_end: end ? new Date(end * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      environment: env,
      updated_at: new Date().toISOString(),
    };
  });

  await supabaseAdmin.from("subscriptions").upsert(rows, { onConflict: "stripe_subscription_id" });

  // Safety net for referral rewards when the provider callback was missed.
  const { grantReferralReward } = await import("@/lib/referral.server");
  for (const row of rows) {
    await grantReferralReward(row.user_id, row.price_id, row.status);
  }
  return rows.length;
}

/** The subscription Stripe currently considers live for this user, if any. */
async function activeStripeSubscription(
  stripe: ReturnType<typeof createStripeClient>,
  userId: string,
  email: string | undefined,
) {
  const customerId = await resolveOrCreateCustomer(stripe, { email, userId });
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  return (
    subs.data.find((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status)) ?? null
  );
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; returnUrl: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    const { supabase, userId } = context;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    try {
      const stripe = createStripeClient(data.environment);

      // Never let somebody buy a second subscription on top of a live one.
      const existing = await activeStripeSubscription(stripe, userId, user?.email ?? undefined);
      if (existing) {
        await syncFromStripe(stripe, userId, user?.email ?? undefined, data.environment);
        return {
          error:
            "You already have an active Pro plan. Use the plan page to switch between monthly and yearly.",
        };
      }

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0]!;

      const customerId = await resolveOrCreateCustomer(stripe, {
        email: user?.email ?? undefined,
        userId,
      });

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        managed_payments: { enabled: true },
        metadata: { userId, managed_payments: "true" },
        subscription_data: { metadata: { userId } },
      } as any);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Safety net when a provider callback is slow or missed: read the truth from Stripe. */
export const syncSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ synced: number } | { error: string }> => {
    const { supabase, userId } = context;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    try {
      const stripe = createStripeClient(data.environment);
      const synced = await syncFromStripe(
        stripe,
        userId,
        user?.email ?? undefined,
        data.environment,
      );
      return { synced };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const changeSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    const { supabase, userId } = context;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    try {
      const stripe = createStripeClient(data.environment);
      const sub = await activeStripeSubscription(stripe, userId, user?.email ?? undefined);
      if (!sub) return { error: "You do not have an active plan to change." };

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) return { error: "That plan is not available." };
      const price = prices.data[0]!;
      const item = sub.items.data[0]!;
      if (item.price.id === price.id) return { ok: true };

      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
      });
      await syncFromStripe(stripe, userId, user?.email ?? undefined, data.environment);
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const setSubscriptionCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cancel: boolean; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    const { supabase, userId } = context;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    try {
      const stripe = createStripeClient(data.environment);
      const sub = await activeStripeSubscription(stripe, userId, user?.email ?? undefined);
      if (!sub) return { error: "You do not have an active plan." };
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: data.cancel });
      await syncFromStripe(stripe, userId, user?.email ?? undefined, data.environment);
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalSessionResult> => {
    const { supabase, userId } = context;

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.stripe_customer_id) return { error: "No subscription found" };

    try {
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
