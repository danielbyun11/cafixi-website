export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

const SYSTEM_PROMPT = `You are Cafixi, an expert automotive AI diagnostic assistant. Analyze the provided car photo together with the user-reported symptoms and return a structured triage.

Respond ONLY with valid JSON (no markdown, no code fences) using EXACTLY this shape:
{
  "issue": "<short issue name, e.g. 'Worn Brake Pads'>",
  "severity": "<one of: Safe, Inspection Required, Urgent>",
  "safeToDrive": <true|false>,
  "safeToDIY": <true|false>,
  "causes": ["<cause 1>", "<cause 2>", "<cause 3>"],
  "estimatedCost": {
    "parts": "<USD range, e.g. '$30-50'>",
    "labor": "<USD range, e.g. '$100-150'>",
    "diySavings": "<USD savings if user does it themselves, e.g. '~$100'>"
  }
}

Rules:
- Keep every string short (under 90 chars).
- 3 causes maximum, ordered from most to least likely.
- If the photo is unclear, not a car, or no clear issue is visible, set issue to "Unable to Diagnose" and put the reason in causes.
- This is educational triage — recommend a certified mechanic for safety-critical work.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { image, symptoms = [], description = "" } = req.body || {};

    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "A car photo is required." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set");
      return res.status(500).json({ error: "Server is not configured. Please contact support." });
    }

    const symptomText = Array.isArray(symptoms) && symptoms.length
      ? `Reported symptoms: ${symptoms.slice(0, 8).join(", ")}.`
      : "No specific symptoms reported.";
    const desc = typeof description === "string" && description.trim()
      ? ` User notes: ${description.trim().slice(0, 400)}.`
      : "";
    const userText = `${symptomText}${desc} Please diagnose what's most likely wrong.`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: image, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("OpenAI API error:", aiResponse.status, errText);
      return res.status(502).json({ error: "The AI service is temporarily unavailable. Please try again." });
    }

    const payload = await aiResponse.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "Empty AI response. Please try again." });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI JSON:", content);
      return res.status(502).json({ error: "AI returned an unexpected format. Please try again." });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
