import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Tier = "free" | "pro" | "invite";

export type Entitlement = {
  tier: Tier;
  readOnly: boolean;
  /** ISO date when a lapsed plan's one month of read-only viewing ends. */
  graceUntil: string | null;
  /** ISO date the paid or invited access ended / will end. */
  accessEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  plan: string | null;
  accountLimit: number | null;
  holdingLimit: number | null;
  isAdmin: boolean;
};

export const FREE_ACCOUNT_LIMIT = 1;
export const FREE_HOLDING_LIMIT = 10;

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export const getEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: "sandbox" | "live" }) => data)
  .handler(async ({ data, context }): Promise<Entitlement> => {
    const { supabase, userId } = context;
    const now = Date.now();

    const [{ data: subs }, { data: redemptions }, { data: isAdmin }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("status, price_id, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("invite_redemptions")
        .select("access_until, redeemed_at")
        .eq("user_id", userId)
        .order("redeemed_at", { ascending: false })
        .limit(5),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    ]);

    const base = {
      cancelAtPeriodEnd: false,
      isAdmin: Boolean(isAdmin),
    };

    // The app owner always has full access.
    if (base.isAdmin) {
      return {
        ...base,
        tier: "pro",
        readOnly: false,
        graceUntil: null,
        accessEndsAt: null,
        plan: "owner",
        accountLimit: null,
        holdingLimit: null,
      };
    }



    // Invite-code access wins when it is still valid.
    const invite = (redemptions ?? []).find(
      (r) => r.access_until == null || new Date(r.access_until).getTime() > now,
    );
    if (invite) {
      return {
        ...base,
        tier: "invite",
        readOnly: false,
        graceUntil: null,
        accessEndsAt: invite.access_until ?? null,
        plan: "invite",
        accountLimit: null,
        holdingLimit: null,
      };
    }

    const active = (subs ?? []).find(
      (s) =>
        (ACTIVE_STATUSES.includes(s.status) &&
          (s.current_period_end == null || new Date(s.current_period_end).getTime() > now)) ||
        (s.status === "canceled" &&
          s.current_period_end != null &&
          new Date(s.current_period_end).getTime() > now),
    );
    if (active) {
      return {
        ...base,
        tier: "pro",
        readOnly: false,
        graceUntil: null,
        accessEndsAt: active.current_period_end ?? null,
        cancelAtPeriodEnd: Boolean(active.cancel_at_period_end),
        plan: active.price_id ?? null,
        accountLimit: null,
        holdingLimit: null,
      };
    }

    // A plan or invite that has ended: everything becomes read-only.
    const lapsedEnd =
      (subs ?? []).map((s) => s.current_period_end).find(Boolean) ??
      (redemptions ?? []).map((r) => r.access_until).find(Boolean) ??
      null;

    if (lapsedEnd) {
      const end = new Date(lapsedEnd);
      const grace = new Date(end);
      grace.setMonth(grace.getMonth() + 1);
      return {
        ...base,
        tier: "free",
        readOnly: true,
        graceUntil: grace.toISOString(),
        accessEndsAt: end.toISOString(),
        plan: null,
        accountLimit: FREE_ACCOUNT_LIMIT,
        holdingLimit: FREE_HOLDING_LIMIT,
      };
    }

    return {
      ...base,
      tier: "free",
      readOnly: false,
      graceUntil: null,
      accessEndsAt: null,
      plan: null,
      accountLimit: FREE_ACCOUNT_LIMIT,
      holdingLimit: FREE_HOLDING_LIMIT,
    };
  });

export const redeemInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => {
    const code = data.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) throw new Error("That code does not look right.");
    return { code };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; accessUntil: string | null } | { error: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("invite_codes")
      .select("id, max_uses, uses, expires_at, access_until, revoked")
      .eq("code", data.code)
      .maybeSingle();

    if (!row) return { error: "We could not find that code." };
    if (row.revoked) return { error: "That code is no longer active." };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { error: "That code has expired." };
    }
    if (row.uses >= row.max_uses) return { error: "That code has already been used." };

    const { error: insertError } = await supabaseAdmin.from("invite_redemptions").insert({
      code_id: row.id,
      user_id: context.userId,
      access_until: row.access_until,
    });
    if (insertError) {
      if (insertError.code === "23505") return { error: "You have already used that code." };
      return { error: "Could not apply that code." };
    }

    await supabaseAdmin
      .from("invite_codes")
      .update({ uses: row.uses + 1 })
      .eq("id", row.id);

    return { ok: true, accessUntil: row.access_until };
  });

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export type InviteCodeRow = {
  id: string;
  code: string;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  access_until: string | null;
  revoked: boolean;
  note: string | null;
  created_at: string;
};

export const listInviteCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InviteCodeRow[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("invite_codes")
      .select("id, code, max_uses, uses, expires_at, access_until, revoked, note, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as InviteCodeRow[];
  });

export const createInviteCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { count: number; maxUses: number; note?: string; accessUntil?: string | null }) => ({
      count: Math.min(Math.max(Math.round(data.count || 1), 1), 50),
      maxUses: Math.min(Math.max(Math.round(data.maxUses || 1), 1), 1000),
      note: data.note?.trim() || null,
      accessUntil: data.accessUntil || null,
    }),
  )
  .handler(async ({ data, context }): Promise<{ codes: string[] }> => {
    await assertAdmin(context);
    const rows = Array.from({ length: data.count }, () => ({
      code: randomCode(),
      created_by: context.userId,
      max_uses: data.maxUses,
      note: data.note,
      access_until: data.accessUntil,
    }));
    const { error } = await context.supabase.from("invite_codes").insert(rows);
    if (error) throw error;
    return { codes: rows.map((r) => r.code) };
  });

export const revokeInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; revoked: boolean }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("invite_codes")
      .update({ revoked: data.revoked })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
