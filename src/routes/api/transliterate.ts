import { createFileRoute } from "@tanstack/react-router";

type Item = { id: number | string; text: string };

export const Route = createFileRoute("/api/transliterate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ error: "LOVABLE_API_KEY is not configured." }, { status: 500 });
        }

        let body: { items?: Item[] };
        try {
          body = (await request.json()) as { items?: Item[] };
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }

        const items = Array.isArray(body.items) ? body.items.filter((it) => it && typeof it.text === "string") : [];
        if (items.length === 0) return Response.json({ items: [] });

        // Process in chunks to avoid huge prompts.
        const CHUNK = 40;
        const out: Item[] = [];
        for (let i = 0; i < items.length; i += CHUNK) {
          const slice = items.slice(i, i + CHUNK);
          const translit = await transliterateChunk(slice, key).catch((e) => {
            console.error("transliterate chunk failed:", e);
            return slice; // fallback: original text
          });
          out.push(...translit);
        }

        return Response.json({ items: out });
      },
    },
  },
});

async function transliterateChunk(items: Item[], key: string): Promise<Item[]> {
  const system =
    "أنت خبير في كتابة اللهجة التونسية (الدارجة) بالحروف اللاتينية كما يكتبها التوانسة في الشات (Arabizi / Franco-Arabe). " +
    "حوّل كل نص عربي مكتوب بالحروف العربية إلى نفس الكلام بالحروف اللاتينية بأسلوب تونسي طبيعي. " +
    "استعمل الأرقام: 3=ع، 5=خ، 7=ح، 9=ق، 2=ء/همزة. مثال: نخدم→nekhdem أو ne5dem، مريول→maryoul، يعيشك→y3aychek، شنوة→chnowa، برشا→barcha، علاش→3lech، كيفاش→kifech، صباح الخير→sba7 el khir. " +
    "أي كلمة فرنسية أو إنجليزية مكتوبة أصلاً بالحروف اللاتينية اتركها كما هي. " +
    "حافظ على نفس الكلمات والمعنى وعلامات الترقيم. لا تترجم ولا تضيف ولا تحذف شيء. " +
    'أرجع JSON فقط بنفس البنية: {"items":[{"id":...,"text":"..."}]}';

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ items }) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`AI transliterate failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
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
      byId.set(String(it.id), it.text);
    }
  }
  return items.map((it) => ({ id: it.id, text: byId.get(String(it.id)) ?? it.text }));
}
