import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const ParsedTransaction = z.object({
  account_type: z.string(),
  account_hint: z.string().nullable(),
  date: z.string(),
  type: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  quantity: z.number().nullable(),
  price: z.number().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  fee: z.number().nullable(),
  confidence: z.number(),
  note: z.string().nullable(),
});
export type ParsedTransaction = z.infer<typeof ParsedTransaction>;

const ParseResult = z.object({
  broker: z.string().nullable(),
  transactions: z.array(ParsedTransaction),
});
export type ParseResult = z.infer<typeof ParseResult>;

const Input = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  /** Base64 data URL for PDFs and images. */
  dataUrl: z.string().nullable(),
  /** Plain text for CSV / pasted statements. */
  text: z.string().nullable(),
});

const SYSTEM = `You extract investment transactions from Canadian brokerage statements
(Questrade, Wealthsimple, TD Direct Investing, RBC Direct Investing, Interactive Brokers,
BMO InvestorLine, Scotia iTRADE, CIBC Investor's Edge and similar).

Rules:
- Output one row per transaction actually shown in the document. Never invent rows.
- type must be exactly one of: BUY, SELL, DIVIDEND, DRIP, DEPOSIT, WITHDRAWAL, FEE.
- date must be ISO YYYY-MM-DD.
- account_type must be one of: TFSA, RRSP, Spousal RRSP, LIRA, LRSP, RESP, RDSP, FHSA,
  Non-Registered, Corporate. Infer it from the statement; if truly unknown use Non-Registered
  and lower the confidence.
- account_hint: the account label/number printed on the statement, or null.
- currency must be CAD or USD.
- For BUY/SELL/DRIP give quantity and price per unit; amount may be null.
- For DIVIDEND/DEPOSIT/WITHDRAWAL/FEE give amount (positive number); quantity and price null.
- symbol: the ticker in uppercase, with the .TO suffix for TSX listings. Null for cash rows.
- fee: commission charged on that row, 0 when none shown.
- confidence: 0 to 1, how certain you are of the whole row. Flag anything you had to guess
  below 0.8 and explain briefly in note.`;

export const parseStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ParseResult> => {
    const { data: planState } = await context.supabase.rpc("plan_state", {
      _user_id: context.userId,
    });
    if (planState !== "pro") {
      throw new Error("Reading statements with AI is part of Pro. Upgrade to use file upload.");
    }

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this app.");

    const { streamText, Output, NoObjectGeneratedError } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createLovableAiGatewayRunIdFetch } = await import("./ai-gateway.server");

    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });

    const parts: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `Extract every transaction from this file (${data.fileName}). Today is ${new Date()
          .toISOString()
          .slice(0, 10)}.`,
      },
    ];

    if (data.text) {
      parts.push({ type: "text", text: data.text.slice(0, 200_000) });
    } else if (data.dataUrl) {
      if (data.mimeType.startsWith("image/")) {
        parts.push({ type: "image", image: data.dataUrl });
      } else {
        parts.push({
          type: "file",
          data: data.dataUrl,
          mediaType: data.mimeType || "application/pdf",
          filename: data.fileName,
        });
      }
    } else {
      throw new Error("Nothing to read in that file.");
    }

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        messages: [{ role: "user", content: parts as never }],
        output: Output.object({ schema: ParseResult }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const output = await result.output;
      return ParseResult.parse(output);
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        console.error(`[import] model returned unusable output: ${error.text?.slice(0, 500)}`);
        throw new Error("Could not read any transactions from that file. Try a clearer file.");
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[import] parse failed: ${message}`);
      if (message.includes("402")) {
        throw new Error("The workspace is out of AI credits. Add credits in Lovable to continue.");
      }
      if (message.includes("429")) {
        throw new Error("AI is busy right now. Wait a moment and try again.");
      }
      throw new Error("Reading that statement failed. Please try again.");
    }
  });
