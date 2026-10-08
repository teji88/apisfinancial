import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  DEFAULT_GEMINI_MODEL,
  STATEMENT_SYSTEM_PROMPT,
  parseGeminiResponse,
} from "./gemini-parse";

// The canonical schemas live in ./gemini-parse (pure, unit-tested). They are
// re-exported here so existing imports from "@/lib/import.functions" — the
// import page's ParsedTransaction type — keep working unchanged.
export { ParsedTransaction as ParsedTransactionSchema } from "./gemini-parse";
export type { ParsedTransaction, ParseResult } from "./gemini-parse";
import type { ParseResult } from "./gemini-parse";

const Input = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  /** Base64 data URL for PDFs and images. */
  dataUrl: z.string().nullable(),
  /** Plain text for CSV / pasted statements. */
  text: z.string().nullable(),
});

/**
 * Statements carry pages of legal boilerplate, marketing and blank filler that
 * cost money to send to the reader and add nothing. Strip the obvious noise and
 * keep the transaction lines, so a typical upload costs a fraction as much.
 */
const NOISE =
  /(terms and conditions|privacy (policy|notice)|member[-\s]?(cipf|iiroc|ciro)|this statement is|please (review|retain|contact)|if you have any questions|investor protection|complaint|all rights reserved|page \d+ of \d+|www\.|https?:\/\/|1-8\d\d[-\s]\d)/i;

function condenseStatement(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      blanks++;
      continue;
    }
    blanks = 0;
    if (trimmed.length > 400) continue; // wall-of-text disclaimer block
    // Keep anything that looks like data; drop prose-only boilerplate.
    const hasData = /\d/.test(trimmed);
    if (!hasData && trimmed.split(/\s+/).length > 12) continue;
    if (NOISE.test(trimmed) && !/\d{4}-\d{2}-\d{2}/.test(trimmed)) continue;
    kept.push(trimmed.replace(/[ \t]{2,}/g, " "));
    if (kept.length >= 4000) break;
  }
  void blanks;
  const out = kept.join("\n");
  return out.length > 60_000 ? out.slice(0, 60_000) : out;
}

export const parseStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ParseResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: planState } = await supabaseAdmin.rpc("plan_state", {
      _user_id: context.userId,
    });
    if (planState !== "pro") {
      throw new Error("Reading statements with AI is part of Pro. Upgrade to use file upload.");
    }

    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this app.");

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
      systemInstruction: STATEMENT_SYSTEM_PROMPT,
    });

    const intro = {
      text: `Extract every transaction from this file (${data.fileName}). Today is ${new Date()
        .toISOString()
        .slice(0, 10)}.`,
    };

    type Part = { text: string } | { inlineData: { data: string; mimeType: string } };
    let parts: Part[];
    if (data.text) {
      parts = [intro, { text: condenseStatement(data.text) }];
    } else if (data.dataUrl) {
      parts = [
        intro,
        {
          inlineData: {
            data: data.dataUrl.replace(/^data:[^;]+;base64,/, ""),
            mimeType: data.mimeType || "application/pdf",
          },
        },
      ];
    } else {
      throw new Error("Nothing to read in that file.");
    }

    let rawText: string;
    try {
      const result = await model.generateContent(parts);
      rawText = result.response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[import] Gemini parse failed: ${message}`);
      if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("AI is busy right now. Wait a moment and try again.");
      }
      if (
        message.includes("403") ||
        message.includes("PERMISSION_DENIED") ||
        message.includes("API_KEY_INVALID") ||
        message.includes("API key")
      ) {
        throw new Error("The Gemini API key was rejected. Check GEMINI_API_KEY on the server.");
      }
      if (
        message.includes("404") ||
        message.includes("NOT_FOUND") ||
        (message.toLowerCase().includes("not found") && message.toLowerCase().includes("model"))
      ) {
        throw new Error(
          `The configured AI model "${modelName}" is not available. Check the GEMINI_MODEL environment variable.`,
        );
      }
      throw new Error("Reading that statement failed. Please try again.");
    }

    // Validation errors from parseGeminiResponse are already user-friendly;
    // let them propagate untouched.
    return parseGeminiResponse(rawText);
  });
