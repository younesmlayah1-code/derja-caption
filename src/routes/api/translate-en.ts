import { createFileRoute } from "@tanstack/react-router";

type Item = { id: number | string; text: string };

export const Route = createFileRoute("/api/translate-en")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ error: "LOVABLE_API_KEY is not configured." }, { status: 500 });
        }

        let body: { items?: Item[]; mode?: "line" | "word" };
        try {
          body = (await request.json()) as { items?: Item[]; mode?: "line" | "word" };
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }

        const items = Array.isArray(body.items)
          ? body.items.filter((it) => it && typeof it.text === "string")
          : [];
        if (items.length === 0) return Response.json({ items: [] });

        const mode = body.mode === "word" ? "word" : "line";
        const CHUNK = 40;
        const out: Item[] = [];
        for (let i = 0; i < items.length; i += CHUNK) {
          const slice = items.slice(i, i + CHUNK);
          const translated = await translateChunk(slice, mode, key).catch((e) => {
            console.error("translate-en chunk failed:", e);
            return slice;
          });
          out.push(...translated);
        }

        return Response.json({ items: out });
      },
    },
  },
});

async function translateChunk(items: Item[], mode: "line" | "word", key: string): Promise<Item[]> {
  const system =
    mode === "word"
      ? "You translate single Tunisian Arabic (Derja) words/tokens into English. " +
        "For each item return the most natural single-word or short English equivalent. " +
        "Keep proper nouns and code-switched French/English words as-is. " +
        "Do not add explanations. Return JSON only: " +
        '{"items":[{"id":...,"text":"..."}]}'
      : "You are a professional translator. Translate Tunisian Arabic (Derja) into clear, natural English. " +
        "Preserve meaning, tone and punctuation. Keep proper nouns. Do not add or remove information. " +
        "Return JSON only with the same structure: " +
        '{"items":[{"id":...,"text":"..."}]}';

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ items }) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`AI translate-en failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return items;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return items;
    parsed = JSON.parse(m[0]);
  }
  const arr = (parsed as { items?: Array<{ id?: number | string; text?: string }> }).items;
  if (!Array.isArray(arr)) return items;

  const byId = new Map<string, string>();
  for (const it of arr) {
    if (it && (typeof it.id === "number" || typeof it.id === "string") && typeof it.text === "string") {
      byId.set(String(it.id), it.text.trim());
    }
  }
  return items.map((it) => ({
    id: it.id,
    text: byId.get(String(it.id)) ?? it.text,
  }));
}
