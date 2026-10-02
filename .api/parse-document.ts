import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // Allows larger PDFs/images
    },
  },
};

interface ParseRequest {
  method?: string;
  body?: unknown;
}

interface ParseResponse {
  status(statusCode: number): ParseResponse;
  json(body: unknown): ParseResponse;
}

export default async function handler(req: ParseRequest, res: ParseResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const fileContent = typeof body.fileContent === "string" ? body.fileContent : "";
    const hasTextContent = fileContent.length > 0;
    const hasBinaryContent = fileBase64.length > 0 && mimeType.length > 0;

    if (!hasTextContent && !hasBinaryContent) {
      return res.status(400).json({ error: "Provide fileContent or both fileBase64 and mimeType" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on server" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // JSON mode avoids strict schema sequence mismatch errors.
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-pro",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
      You are an expert Canadian financial data parser for Apis Financial.
      Analyze the provided input. It could be CSV text, a PDF brokerage statement, or a mobile screenshot of trades or holdings.
      Determine the format and accurately extract all financial records, holdings, or transactions.
      Return a valid JSON object with exactly this structure:
      {
        "detectedFormat": "csv",
        "institution": "Name of institution (e.g. Wealthsimple, TD, Questrade) or null",
        "accountType": "RRSP, TFSA, Non-Registered, or null",
        "columnsFound": ["date", "ticker", "quantity", "price"],
        "records": [
          {
            "date": "YYYY-MM-DD or null",
            "nameOrTicker": "Asset name or ticker symbol",
            "action": "Buy, Sell, Deposit, Dividend, or Transfer",
            "quantity": 0,
            "price": 0,
            "totalAmount": 0
          }
        ]
      }
      Set detectedFormat to csv, pdf_statement, or mobile_screenshot based on the input.
      Use null for unavailable values and an empty array when no columns or records are found.
      Do not include markdown code blocks. Return raw JSON only.
    `;

    const result = hasTextContent
      ? await model.generateContent([prompt, `Here is the CSV file text content:\n${fileContent}`])
      : await model.generateContent([
          prompt,
          {
            inlineData: {
              data: fileBase64.replace(/^data:(.*);base64,/, ""),
              mimeType,
            },
          },
        ]);

    const rawText = result.response.text();
    const cleanedJsonText = rawText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const parsedJson = JSON.parse(cleanedJsonText);
    return res.status(200).json(parsedJson);
  } catch (error: unknown) {
    console.error("Unified parsing error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to process document",
    });
  }
}
