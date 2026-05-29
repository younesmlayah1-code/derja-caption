import { createFileRoute } from "@tanstack/react-router";
import { transliterateDerja } from "@/lib/subtitles";
import { getSecret } from "@/lib/secrets.server";
import { requireActiveUser } from "@/lib/access.server";
import { geminiChat } from "@/lib/gemini.server";


type Item = { id: number | string; text: string };

export const Route = createFileRoute("/api/transliterate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gate = await requireActiveUser(request);
        if (gate instanceof Response) return gate;
        const key = await getSecret("GEMINI_API_KEY");
        if (!key) {
          return Response.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
        }
        void key;

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
          const translit = await transliterateChunk(slice).catch((e) => {
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
    "استعمل الأرقام: 3=ع، 5=خ، 7=ح، 9=ق، 2=ء/همزة. " +
    "أمثلة دارجة: نخدم→nekhdem، مريول→maryoul، يعيشك→y3aychek، شنوة→chnowa، برشا→barcha، علاش→3lech، كيفاش→kifech، صباح الخير→sba7 el khir، الناس→ennes، اتبعها→ettab3a. " +
    "ممنوع منعاً باتاً استعمال الشرطة '-' داخل أو بين الكلمات. اكتب الكلمات ملتصقة بدون أي '-' (مثال: ennes وليس en-nes، ettab3a وليس ett-ab3a، essa77a وليس es-sa77a). " +
    "مهم جداً: إذا كانت كلمة مكتوبة بالحروف العربية لكنها في الأصل كلمة فرنسية أو إنجليزية، اكتبها بالإملاء الفرنسي/الإنجليزي الصحيح، وليس transliteration حرفي. " +
    "أمثلة لكلمات قروض فرنسية شائعة في الدارجة التونسية يجب كتابتها بإملائها الأصلي: " +
    "باك=bac (شهادة الباكالوريا)، ليسي=lycée، تريزا=treize، كاتورز=quatorze، كانز=quinze، سيز=seize، ديزانوف=dix-neuf، " +
    "برودو=produit، مونتاج=montage، بيزنس=business، ماركتينغ=marketing، بروبلام=problème، سارفيس=service، " +
    "أورديناتور=ordinateur، تيليفون=téléphone، فيديو=vidéo، إيمايل=email، كومبيوتر=computer، " +
    "كار=car، طوموبيل=automobile، تاكسي=taxi، ميترو=métro، طرين=train، أوتيل=hôtel، ريستوران=restaurant، كافي=café، " +
    "بوتيك=boutique، ماغازا=magasin، فاميليا=famille، أوسبيتال=hôpital، فارماسي=pharmacie، دوكتور=docteur، أنفيرمياي=infirmier، " +
    "تيلي=télé، راديو=radio، جورنال=journal، فوطو=photo، آبارتمو=appartement، كوزينا=cuisine، فريجو=frigo. " +
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
      temperature: 0,
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
      byId.set(String(it.id), finalize(it.text));
    }
  }
  return items.map((it) => ({
    id: it.id,
    text: byId.get(String(it.id)) ?? finalize(it.text),
  }));
}

// Final cleanup: strip intra-word hyphens AND guarantee no Arabic characters
// remain (rule-based fallback for any word the AI left in Arabic script).
function finalize(text: string): string {
  const noArabic = text
    .split(/(\s+)/)
    .map((seg) => (/[\u0600-\u06FF]/.test(seg) ? transliterateDerja(seg) : seg))
    .join("");
  return stripHyphens(noArabic);
}

// Remove hyphens inserted between Latin letters / digits within a single word
// (e.g. "en-nes" → "ennes", "ett-ab3a" → "ettab3a").
function stripHyphens(text: string): string {
  return text.replace(/([A-Za-z0-9'])-+([A-Za-z0-9'])/g, "$1$2");
}

