import { GoogleGenerativeAI } from '@google/generative-ai';

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
    
    // JSON mode avoids strict schema sequence mismatch errors.
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-pro',
      generationConfig: { 
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
      You are an expert Canadian financial document parser for Apis Financial.
      Analyze this uploaded document image or PDF. Extract stock transactions, holdings, and account details.
      You MUST return your answer as a valid JSON object matching this exact structure:
      {
        "institution": "Name of financial institution (e.g. Wealthsimple, TD, RBC) or null",
        "accountType": "RRSP, TFSA, RRIF, or Non-Registered, or null",
        "totalBalance": 0.00,
        "transactions": [
          {
            "ticker": "Stock ticker symbol or asset name",
            "transactionType": "Buy, Sell, Dividend, or Deposit",
            "amount": 0.00,
            "date": "YYYY-MM-DD"
          }
        ]
      }
      If any field cannot be found, use null or an empty array. Do not include markdown code blocks like \`\`\`json in your response, just return the raw JSON string.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBase64.replace(/^data:(.*);base64,/, ''), // Strip data URI prefix
          mimeType: mimeType,
        },
      },
    ]);

    const rawText = result.response.text();
    const cleanedJsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedJson = JSON.parse(cleanedJsonText);
    return res.status(200).json(parsedJson);
  } catch (error: any) {
    console.error('Parsing error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process document' });
  }
}