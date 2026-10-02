import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeHeader } from "./institution-profiles";
import type { LearnedColumnField } from "./csv-learn";

const Input = z.object({
  fileName: z.string(),
  /** First ~30 lines of the CSV: header candidates plus sample data rows. */
  sample: z.string().min(1).max(20_000),
});

const LearnedMapping = z.object({
  institution_name: z.string().min(1).max(80),
  columns: z.object({
    date: z.string().min(1),
    type: z.string().optional(),
    symbol: z.string().optional(),
    quantity: z.string().optional(),
    price: z.string().optional(),
    amount: z.string().optional(),
    fee: z.string().optional(),
    currency: z.string().optional(),
    account: z.string().optional(),
    description: z.string().optional(),
    fx: z.string().optional(),
  }),
  type_map: z.record(z.string(), z.string()).optional(),
});

export type LearnedMapping = z.infer<typeof LearnedMapping>;

const CANONICAL_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "DRIP",
  "SPLIT",
  "DEPOSIT",
  "WITHDRAWAL",
  "FEE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
].join(", ");

const MAPPING_SYSTEM_PROMPT = `You map CSV statement columns to a fixed schema. Return ONLY a JSON object, no markdown fences, no commentary.

Output shape:
{
  "institution_name": "Broker name guessed from the file, or 'CSV import'",
  "columns": {
    "date": "EXACT header text of the trade/transaction date column (REQUIRED)",
    "type": "EXACT header text of the action/type column",
    "symbol": "EXACT header text of the ticker/symbol column",
    "quantity": "EXACT header text of the shares/units column",
    "price": "EXACT header text of the per-share price column",
    "amount": "EXACT header text of the total/net amount column",
    "fee": "EXACT header text of the commission/fee column",
    "currency": "EXACT header text of the currency column",
    "account": "EXACT header text of the account/portfolio column",
    "description": "EXACT header text of the description/memo column",
    "fx": "EXACT header text of the FX/exchange-rate column"
  },
  "type_map": { "raw action word in lowercase": "CANONICAL_TYPE" }
}

Rules:
- Column values must be the EXACT header text from the file, character for character. Never invent a header.
- Omit any field whose column does not exist in the file. "date" is required; if no date column exists, set "institution_name" to "UNREADABLE" and omit columns.
- type_map maps each distinct action word seen in the sample (lowercased, trimmed) to one of: ${CANONICAL_TYPES}. Map only words actually present in the sample rows.
- Prefer a trade/transaction date over a settlement date, and a net amount over a gross amount.
- Ignore footer, total and subtotal rows when reading the sample.`;

/** Strip a markdown fence if the model wrapped the JSON. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced?.[1] ?? raw).trim();
}

/**
 * Learn a CSV's column layout with the AI, once per format. Authenticated and
 * Pro-gated on the server like the statement reader. The returned mapping is
 * deterministic input for the local parser — the AI never sees the full file
 * and never returns transactions.
 */
export const learnCsvMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<LearnedMapping> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: planState } = await supabaseAdmin.rpc("plan_state", {
      _user_id: context.userId,
    });
    if (planState !== "pro") {
      throw new Error("Learning a CSV layout with AI is part of Pro. Upgrade to use it.");
    }

    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this app.");

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env["GEMINI_MODEL"] ?? "gemini-3.8-flash";
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction: MAPPING_SYSTEM_PROMPT,
    });

    let rawText: string;
    try {
      const result = await model.generateContent([
        { text: `Map the columns of this CSV (${data.fileName}):` },
        { text: data.sample },
      ]);
      rawText = result.response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[import] CSV mapping learn failed: ${message}`);
      if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("AI is busy right now. Wait a moment and try again.");
      }
      throw new Error("The AI could not read that layout. Please try again.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(rawText));
    } catch {
      throw new Error("The AI returned an unreadable mapping. Please try again.");
    }
    const mapping = LearnedMapping.safeParse(parsed);
    if (!mapping.success || mapping.data.institution_name === "UNREADABLE") {
      throw new Error(
        "The AI could not find a usable date column in that file. It needs at least a date column.",
      );
    }

    // Drop any mapped header that does not actually appear in the sample —
    // the model must not invent columns.
    const sampleHeaders = new Set(
      data.sample
        .split("\n")
        .slice(0, 25)
        .flatMap((line) => line.split(","))
        .map((h) => normalizeHeader(h.replace(/^"|"$/g, ""))),
    );
    const columns = { ...mapping.data.columns } as Record<string, string | undefined>;
    for (const [field, header] of Object.entries(columns)) {
      if (header && !sampleHeaders.has(normalizeHeader(header))) {
        delete columns[field];
      }
    }
    if (!columns["date"]) {
      throw new Error(
        "The AI mapped a date column that is not in the file. Please try again.",
      );
    }

    // Keep only type_map entries pointing at real canonical types.
    const canonical = new Set(CANONICAL_TYPES.split(", "));
    const typeMap: Record<string, string> = {};
    for (const [raw, canonicalType] of Object.entries(mapping.data.type_map ?? {})) {
      const upper = canonicalType.toUpperCase().trim();
      if (canonical.has(upper)) typeMap[raw.toLowerCase().trim()] = upper;
    }

    return {
      institution_name: mapping.data.institution_name,
      columns: columns as LearnedMapping["columns"],
      type_map: Object.keys(typeMap).length > 0 ? typeMap : undefined,
    };
  });

export type { LearnedColumnField };
