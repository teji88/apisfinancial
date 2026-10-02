import { z } from "zod";

/**
 * Gemini statement parsing — shared prompt, canonical schemas, and response
 * validation. Pure module: no framework or server imports, safe to unit test
 * and safe to import from both client and server code.
 *
 * The schemas are the single canonical shape every import path produces.
 * Invalid model output is an error — values are never silently coerced
 * (an unrecognized transaction type must surface, never become a DEPOSIT).
 */

/** Default Gemini model for statement reading. Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const ParsedTransaction = z.object({
  account_type: z.string(),
  account_hint: z.string().nullable(),
  date: z.string(),
  type: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable().optional().default(null),
  quantity: z.number().nullable(),
  price: z.number().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  fee: z.number().nullable(),
  confidence: z.number(),
  note: z.string().nullable(),
});
export type ParsedTransaction = z.infer<typeof ParsedTransaction>;

export const ParseResult = z.object({
  broker: z.string().nullable(),
  transactions: z.array(ParsedTransaction),
});
export type ParseResult = z.infer<typeof ParseResult>;

export const STATEMENT_SYSTEM_PROMPT = `You extract investment transactions from Canadian brokerage statements
(Questrade, Wealthsimple, TD Direct Investing, RBC Direct Investing, Interactive Brokers,
BMO InvestorLine, Scotia iTRADE, CIBC Investor's Edge and similar) and from screenshots
of portfolio-tracking apps.

Rules:
- Output one row per transaction actually shown in the document. Never invent rows.
- broker: the institution named on the statement, or null if it is not shown.
- type must be exactly one of: BUY, SELL, DIVIDEND, DRIP, DEPOSIT, WITHDRAWAL, FEE.
- Statements and apps abbreviate actions: Dep = DEPOSIT, Out = WITHDRAWAL, Div = DIVIDEND,
  Reinv = DRIP. Map abbreviations to the canonical types above.
- date must be ISO YYYY-MM-DD.
- account_type must be one of: TFSA, RRSP, Spousal RRSP, LIRA, LRSP, RESP, RDSP, FHSA,
  Non-Registered, Corporate. Infer it from the statement; if truly unknown use Non-Registered
  and lower the confidence.
- account_hint: the account label/number printed on the statement, or null.
- currency must be CAD or USD.
- For BUY/SELL/DRIP give quantity and price per unit; amount may be null.
- For DIVIDEND/DEPOSIT/WITHDRAWAL/FEE give amount (positive number); quantity and price null.
- Exception to the previous rule: dividend rows in apps and statements often show shares
  held and a per-share payout instead of a total (e.g. quantity 419.3768, price 0.03004).
  For those rows set amount = quantity × price (rounded to 2 decimals) and still report
  the quantity and price as shown.
- Amounts for money leaving the account may be shown negative (e.g. -139.83);
  report a WITHDRAWAL with the positive amount.
- symbol: the ticker in uppercase, with the .TO suffix for TSX listings. Null for cash rows.
- name: the security's full name as shown on the statement (company or fund name), or null if not shown.
- fee: commission charged on that row, 0 when none shown.
- confidence: 0 to 1, how certain you are of the whole row. Flag anything you had to guess
  below 0.8 and explain briefly in note.

Respond with a single JSON object of the form
{ "broker": string | null, "transactions": [ ... ] } and nothing else.`;

/**
 * Validates a raw Gemini response body against the canonical schema.
 * JSON mode usually returns bare JSON, but a markdown fence is stripped if
 * one shows up anyway. Throws a friendly Error on unusable output.
 */
export function parseGeminiResponse(rawText: string): ParseResult {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Could not read any transactions from that file. Try a clearer file.");
  }

  const result = ParseResult.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[import] Gemini output failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    throw new Error("Could not read any transactions from that file. Try a clearer file.");
  }
  return result.data;
}
