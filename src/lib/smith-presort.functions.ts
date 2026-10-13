import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "./gemini-parse";
import { checkAndConsumeAiQuota } from "./ai-usage.functions";
import { nextResetLabel, quotaExhaustedMessage } from "./ai-usage";

const PresortItem = z.object({
  key: z.string(),
  kind: z.enum(["tranche", "outflow"]),
  date: z.string(),
  amount: z.number(),
  symbol: z.string().nullable(),
  note: z.string(),
});

const Input = z.object({
  /** Proposed items awaiting review (tranches and outflows). */
  items: z.array(PresortItem).max(500),
  /** Existing confirmed tranches, for draw-amount/timing matching. */
  existingTranches: z.array(z.object({ drawDate: z.string(), principal: z.number() })).max(200),
  helocName: z.string().max(80),
});

const PresortDecision = z.object({
  key: z.string(),
  suggest_checked: z.boolean(),
  reason: z.string().max(200),
});

const Output = z.object({ decisions: z.array(PresortDecision) });

const PRESORT_SYSTEM_PROMPT = `You pre-sort reconstructed Smith-manoeuvre transactions for human review.
The Smith manoeuvre: borrow from a HELOC, invest the money. Each invested draw is a
tax-deductible tranche. The human confirms every item afterwards — you only suggest
the initial checked/unchecked state.

For each TRANCHE item decide suggest_checked:
- true when it looks like HELOC money invested: the amount matches a known HELOC draw
  (see existing tranches), or it fits the pattern of the other draws (similar amounts,
  regular timing, plausible investment purchase).
- false when it looks unrelated: tiny amounts, timing far from any draw, or activity
  that looks like ordinary (non-Smith) investing. When in doubt, choose false — the
  human decides ambiguous items.
- reason: one short plain-language sentence (e.g. "Matches the $25,000 draw on 2024-02-10.").

Rules:
- Only judge tranche items. Outflows are never pre-checked by you — leave them alone.
- Never invent items; only return keys exactly as given in the input.
- A draw that was NOT invested is not a tranche: if the note suggests the money went
  elsewhere, choose false.

Respond with JSON only: { "decisions": [ { "key": "...", "suggest_checked": true, "reason": "..." } ] }.`;

/** Strip a markdown fence if the model wrapped the JSON. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced?.[1] ?? raw).trim();
}

/**
 * AI pre-sort for the HELOC tracker's import review queue. Authenticated and
 * Pro-gated on the server. Suggests only — the client applies suggestions to
 * the checked set and the user still confirms every item before anything is
 * recorded.
 */
export const presortSmithProposals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<z.infer<typeof Output>> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: planState } = await supabaseAdmin.rpc("plan_state", {
      _user_id: context.userId,
    });
    if (planState !== "pro") {
      throw new Error("AI pre-sort is part of Pro. Upgrade to use it.");
    }

    // Monthly fair-use cap (counts as 1 AI page). Fail-open when unusable.
    const quota = await checkAndConsumeAiQuota(supabaseAdmin, context.userId, 1);
    if (!quota.ok) throw new Error(quotaExhaustedMessage(nextResetLabel()));

    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this app.");

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction: PRESORT_SYSTEM_PROMPT,
    });

    const tranches = data.items.filter((i) => i.kind === "tranche");
    let rawText: string;
    try {
      const result = await model.generateContent([
        {
          text: `Pre-sort these proposed tranches from the "${data.helocName}" history reconstruction.`,
        },
        {
          text: `Existing confirmed tranches (drawDate, principal): ${JSON.stringify(
            data.existingTranches,
          )}`,
        },
        { text: `Proposed tranches: ${JSON.stringify(tranches)}` },
      ]);
      rawText = result.response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[smith] presort failed: ${message}`);
      if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("AI is busy right now. Wait a moment and try again.");
      }
      throw new Error("The AI could not pre-sort these items. Please try again.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(rawText));
    } catch {
      throw new Error("The AI returned an unreadable pre-sort. Please try again.");
    }
    const output = Output.safeParse(parsed);
    if (!output.success) {
      throw new Error("The AI returned an unreadable pre-sort. Please try again.");
    }
    // Drop decisions for unknown keys — the model must not invent items.
    const known = new Set(data.items.map((i) => i.key));
    return { decisions: output.data.decisions.filter((d) => known.has(d.key)) };
  });
