/**
 * Referral rewards: when somebody a member referred buys a yearly plan,
 * the member gets a free year of that same plan. Years stack.
 */

const YEARLY_PRICES = new Set(["pro_yearly", "pro_plus_yearly"]);

export async function grantReferralReward(
  userId: string | null | undefined,
  priceId: string | null | undefined,
  status?: string | null,
): Promise<void> {
  if (!userId || !priceId) return;
  if (!YEARLY_PRICES.has(priceId)) return;
  if (status && !["active", "trialing", "past_due"].includes(status)) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("referred_by")
    .eq("id", userId)
    .maybeSingle();

  const referrerId = profile?.referred_by;
  if (!referrerId || referrerId === userId) return;

  // One reward per referred person.
  const { data: already } = await supabaseAdmin
    .from("referral_rewards")
    .select("id")
    .eq("referred_user_id", userId)
    .maybeSingle();
  if (already) return;

  // Stack on top of any free time the referrer already earned.
  const { data: latest } = await supabaseAdmin
    .from("referral_rewards")
    .select("access_until")
    .eq("referrer_id", referrerId)
    .order("access_until", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const startMs = latest?.access_until
    ? Math.max(new Date(latest.access_until).getTime(), now)
    : now;
  const start = new Date(startMs);
  const until = new Date(startMs);
  until.setFullYear(until.getFullYear() + 1);

  await supabaseAdmin.from("referral_rewards").insert({
    referrer_id: referrerId,
    referred_user_id: userId,
    plan: priceId.startsWith("pro_plus") ? "pro_plus" : "pro",
    price_id: priceId,
    access_from: start.toISOString(),
    access_until: until.toISOString(),
  });
}
