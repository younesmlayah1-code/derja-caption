// Direct Google Gemini API helper (uses GEMINI_API_KEY).
// Drop-in replacement for the OpenAI-compat Lovable AI Gateway chat call.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function geminiChat(opts: {
  system: string;
  user: string;
  jsonMode?: boolean;
  temperature?: number;
  model?: string;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const model = opts.model ?? DEFAULT_MODEL;
  const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Gemini API failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p?.text ?? "").join("").trim();
}
