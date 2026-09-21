import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReferralReward = {
  plan: string;
  access_until: string;
  created_at: string;
};

export type ReferralInfo = {
  code: string | null;
  /** How many friends signed up with this member's code. */
  signups: number;
  /** Rewards earned so far (one per friend on a yearly plan). */
  rewards: ReferralReward[];
  /** When the stacked free time runs out, if any is earned. */
  freeUntil: string | null;
};

export const getReferralInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferralInfo> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profile }, { data: rewards }, { count }] = await Promise.all([
      supabaseAdmin.from("profiles").select("referral_code").eq("id", userId).maybeSingle(),
      supabaseAdmin
        .from("referral_rewards")
        .select("plan, access_until, created_at")
        .eq("referrer_id", userId)
        .order("access_until", { ascending: false }),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("referred_by", userId),
    ]);

    const list = (rewards ?? []) as ReferralReward[];
    const freeUntil =
      list.length && new Date(list[0]!.access_until).getTime() > Date.now()
        ? list[0]!.access_until
        : null;

    return {
      code: profile?.referral_code ?? null,
      signups: count ?? 0,
      rewards: list,
      freeUntil,
    };
  });

/** Record who invited this member. Only ever set once, and never to themselves. */
export const applyReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => {
    const code = data.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new Error("That code does not look right.");
    return { code };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("referred_by, referral_code")
      .eq("id", userId)
      .maybeSingle();
    if (!me || me.referred_by || me.referral_code === data.code) return { ok: false };

    const { data: referrer } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("referral_code", data.code)
      .maybeSingle();
    if (!referrer || referrer.id === userId) return { ok: false };

    await supabaseAdmin.from("profiles").update({ referred_by: referrer.id }).eq("id", userId);
    return { ok: true };
  });
