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

        let body: { items?: Item[]; mode?: "line" | "word"; targetLang?: "english" | "french" };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }

        const items = Array.isArray(body.items)
          ? body.items.filter((it) => it && typeof it.text === "string")
          : [];
        if (items.length === 0) return Response.json({ items: [] });

        const apiKey: string = key;
        const mode = body.mode === "word" ? "word" : "line";
        const targetLang = body.targetLang === "french" ? "french" : "english";
        const CHUNK = mode === "word" ? 60 : 25;
        const CONCURRENCY = 4;

        // Split into chunks and run in parallel for much lower latency on long videos.
        const chunks: Item[][] = [];
        for (let i = 0; i < items.length; i += CHUNK) {
          chunks.push(items.slice(i, i + CHUNK));
        }

        const results: Item[][] = new Array(chunks.length);
        let next = 0;
        async function worker() {
          while (true) {
            const idx = next++;
            if (idx >= chunks.length) return;
            results[idx] = await translateChunk(chunks[idx], mode, targetLang, apiKey).catch((e) => {
              console.error("translate-en chunk failed:", e);
              return chunks[idx];
            });
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()),
        );
        const out: Item[] = results.flat();

        return Response.json({ items: out });
      },
    },
  },
});

async function translateChunk(
  items: Item[],
  mode: "line" | "word",
  targetLang: "english" | "french",
  key: string,
): Promise<Item[]> {
  const langName = targetLang === "french" ? "French" : "English";
  const system =
    mode === "word"
      ? `You translate single Tunisian Arabic (Derja) tokens into ${langName}. ` +
        `Return the most natural single-word or very short ${langName} equivalent for each item. ` +
        "Keep proper nouns, brand names, and code-switched French/English words exactly as-is. " +
        "If a token is filler, hesitation, or untranslatable in isolation, return it unchanged. " +
        "Do not add explanations, alternatives, or parentheses. " +
        'Return JSON only: {"items":[{"id":...,"text":"..."}]}'
      : `You are an expert translator of Tunisian Arabic (Derja) into fluent, natural ${langName}. ` +
        "Translate meaning, not word-by-word. Make it sound like a native speaker — idiomatic, clear, conversational. " +
        "Preserve tone (casual stays casual, formal stays formal), punctuation, and sentence boundaries. " +
        "Keep proper nouns, brand names, and code-switched French/English words intact. " +
        "Common Derja: برشا=a lot, ياسر=very/a lot, شنوة=what, علاش=why, كيفاش=how, وقتاش=when, " +
        "باهي=good/okay, موش=not, ماكش=you aren't, توا=now, يعيشك=thanks/please, زادا=also, " +
        "خاطر=because, نجم=I can, فما=there is, أما=but, إيا=come on, مالا=so/then. " +
        "Do not add or remove information. Do not add disclaimers. " +
        'Return JSON only with the same structure: {"items":[{"id":...,"text":"..."}]}';

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
