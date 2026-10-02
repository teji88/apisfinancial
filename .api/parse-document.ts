import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Allows larger PDFs/images
    },
  },
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileBase64, mimeType } = req.body;

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: 'Missing fileBase64 or mimeType' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on server' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Using Pro for maximum financial document accuracy
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-pro',
      generationConfig: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            institution: { type: SchemaType.STRING },
            accountType: { type: SchemaType.STRING, description: "Must be RRSP, TFSA, RRIF, or Non-Registered" },
            transactions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  ticker: { type: SchemaType.STRING, nullable: true },
                  transactionType: { type: SchemaType.STRING, description: "Buy, Sell, Dividend, or Deposit" },
                  amount: { type: SchemaType.NUMBER },
                  date: { type: SchemaType.STRING, description: "YYYY-MM-DD" }
                },
                required: ["transactionType", "amount", "date"]
              }
            }
          },
          required: ["institution", "accountType", "transactions"]
        }
      },
    });

    const prompt = `You are an expert Canadian financial document parser for Apis Financial. Analyze this image or PDF document and extract the holdings and transactions exactly as defined by the schema.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBase64.replace(/^data:(.*);base64,/, ''), // Strip data URI prefix
          mimeType: mimeType,
        },
      },
    ]);

    const parsedJson = JSON.parse(result.response.text());
    return res.status(200).json(parsedJson);
  } catch (error: any) {
    console.error('Parsing error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process document' });
  }
}