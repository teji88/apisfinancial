import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    );
  }
  return _supabase;
}

function priceIdOf(item: any): string | null {
  return item?.price?.lookup_key ?? item?.price?.metadata?.lovable_external_id ?? item?.price?.id ?? null;
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        product_id: typeof item?.price?.product === "string" ? item.price.product : null,
        price_id: priceIdOf(item),
        status: subscription.status,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );
}

async function markCanceled(subscription: any, env: StripeEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function refreshFromStripe(subscriptionId: string | null | undefined, env: StripeEnv) {
  if (!subscriptionId) return;
  const { createStripeClient } = await import("@/lib/stripe.server");
  const stripe = createStripeClient(env);
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertSubscription(sub as any, env);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertSubscription(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await markCanceled(event.data.object, env);
      break;
    case "checkout.session.completed": {
      // Fast path: record access as soon as checkout finishes.
      const session: any = event.data.object;
      if (session.payment_status !== "unpaid") {
        await refreshFromStripe(
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
          env,
        );
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_succeeded": {
      // Renewals and failed renewals: re-read the subscription so dates and status stay right.
      const invoice: any = event.data.object;
      const subId =
        (typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id) ??
        invoice.parent?.subscription_details?.subscription ??
        invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ??
        null;
      await refreshFromStripe(typeof subId === "string" ? subId : subId?.id, env);
      break;
    }
    default:
      console.log("Unhandled event:", event.type);
  }
}


export const Route = createFileRoute("/api/public/payments/webhook")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook received with invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
