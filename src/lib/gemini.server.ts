// AI chat helper. Prefer Lovable AI Gateway, fall back to direct Gemini if configured.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const LOVABLE_AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export async function geminiChat(opts: {
  system: string;
  user: string;
  jsonMode?: boolean;
  temperature?: number;
  model?: string;
}): Promise<string> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const res = await fetch(LOVABLE_AI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Lovable AI Gateway failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const model = (opts.model ?? "google/gemini-2.5-flash").replace(/^google\//, "");
  if (!model.startsWith("gemini-"))
    throw new Error(`Model ${opts.model} requires LOVABLE_API_KEY.`);
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
  return parts
    .map((p) => p?.text ?? "")
    .join("")
    .trim();
}
