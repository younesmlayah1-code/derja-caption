import { createFileRoute } from "@tanstack/react-router";
import { getSecret } from "@/lib/secrets.server";
import { requireActiveUser } from "@/lib/access.server";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const gate = await requireActiveUser(request);
        if (gate instanceof Response) return gate;

        const apiKey = await getSecret("GROQ_API_KEY");
        if (!apiKey) {
          return Response.json({ error: "GROQ_API_KEY is not configured on the server." }, { status: 500 });
        }

        let incoming: FormData;
        try {
          incoming = await request.formData();
        } catch {
          return Response.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
        }

        const file = incoming.get("file");
        if (!(file instanceof File)) {
          return Response.json({ error: "Missing 'file' upload." }, { status: 400 });
        }
        const languageRaw = incoming.get("language");
        const language = typeof languageRaw === "string" && languageRaw.length > 0 ? languageRaw : "ar";

        const MAX = 25 * 1024 * 1024;
        if (file.size > MAX) {
          return Response.json(
            { error: `File chunk is ${(file.size / 1024 / 1024).toFixed(1)}MB. Limit is 25MB.` },
            { status: 413 },
          );
        }

        // Derja-biased Arabic prompt: includes common Tunisian dialect words
        // so Whisper transcribes in Derja (not Fosha/MSA), while staying in
        // Arabic script. Keep it focused — overly long word lists cause
        // repetition artifacts (handled separately by dedupeRepeats).
        const derjaPrompt =
          "تفريغ صوتي باللهجة التونسية الدارجة بالحروف العربية فقط، مع علامات الترقيم. " +
          "أمثلة كلمات دارجة: برشا، ياسر، شنوة، علاش، كيفاش، وقتاش، باهي، موش، ماكش، توا، يعيشك، زادا، خاطر، نحب، نجم، نمشي، نشوف، نحكي، فما، أما، إيا.";

        const upstream = new FormData();
        upstream.append("file", file, file.name || "audio.wav");
        upstream.append("model", "whisper-large-v3");
        upstream.append("response_format", "verbose_json");
        upstream.append("timestamp_granularities[]", "segment");
        upstream.append("timestamp_granularities[]", "word");
        upstream.append("temperature", "0");
        upstream.append("language", language);
        upstream.append("prompt", derjaPrompt);

        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: upstream,
        });

        if (!res.ok) {
          const text = await res.text();
          return Response.json(
            { error: `Groq API error (${res.status}): ${text.slice(0, 500)}` },
            { status: 502 },
          );
        }

        const data = (await res.json()) as {
          text?: string;
          segments?: Array<{ id?: number; start: number; end: number; text: string }>;
          words?: Array<{ word?: string; text?: string; start: number; end: number }>;
        };

        const allWords = (data.words ?? []).map((w) => ({
          start: w.start,
          end: w.end,
          text: ((w.word ?? w.text) || "").trim(),
        })).filter((w) => w.text.length > 0);

        const segs = (data.segments ?? []).map((s, i) => ({
          id: typeof s.id === "number" ? s.id : i,
          start: s.start,
          end: s.end,
          text: dedupeRepeats((s.text || "").trim()),
          words: [] as typeof allWords,
        }));
        for (const w of allWords) {
          const mid = (w.start + w.end) / 2;
          let idx = segs.findIndex((s) => mid >= s.start && mid <= s.end);
          if (idx === -1) {
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < segs.length; i++) {
              const d = Math.min(Math.abs(mid - segs[i].start), Math.abs(mid - segs[i].end));
              if (d < bestDist) { bestDist = d; best = i; }
            }
            idx = best;
          }
          if (idx >= 0 && segs[idx]) segs[idx].words.push(w);
        }
        const segments = segs.filter((s) => s.text.length > 0);

        const polishedSegments = await polishSegments(segments).catch((e: unknown) => {
          console.error("polishSegments failed:", e);
          return segments;
        });

        const fullText = polishedSegments.map((s: { text: string }) => s.text).join(" ").trim()
          || dedupeRepeats((data.text || "").trim());

        const h = res.headers;
        const rate = {
          limitAudioSeconds: numOrNull(h.get("x-ratelimit-limit-audio-seconds")),
          remainingAudioSeconds: numOrNull(h.get("x-ratelimit-remaining-audio-seconds")),
          resetAudioSeconds: h.get("x-ratelimit-reset-audio-seconds"),
          limitRequests: numOrNull(h.get("x-ratelimit-limit-requests")),
          remainingRequests: numOrNull(h.get("x-ratelimit-remaining-requests")),
        };

        return Response.json({ text: fullText, segments: polishedSegments, words: allWords, rate });
      },
    },
  },
});

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type PolishSeg = { id: number; start: number; end: number; text: string; words?: Array<{ start: number; end: number; text: string }> };

async function polishSegments(segments: PolishSeg[]): Promise<PolishSeg[]> {
  if (segments.length === 0) return segments;
  const key = await getSecret("LOVABLE_API_KEY");
  if (!key) return segments;

  const payload = segments.map((s) => ({ id: s.id, text: s.text }));

  const system =
    "أنت محرر لغوي للهجة التونسية الدارجة. مهمتك تنظيف نص تفريغ صوتي: " +
    "صحح الإملاء، أضف علامات الترقيم المناسبة (،.؟!)، أصلح المسافات، " +
    "وأزل الكلمات المكررة بشكل خاطئ. " +
    "حافظ بدقة على نفس الكلمات والمعنى واللهجة التونسية. لا تترجم للفصحى. " +
    "لا تضف ولا تحذف معلومات. أرجع JSON فقط بنفس البنية: " +
    '[{"id":number,"text":string}, ...]';

  const userMsg = JSON.stringify(payload);

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
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Lovable AI polish failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = j.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return segments;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return segments;
    parsed = JSON.parse(m[0]);
  }

  const arr: Array<{ id?: number; text?: string }> = Array.isArray(parsed)
    ? (parsed as Array<{ id?: number; text?: string }>)
    : Array.isArray((parsed as { segments?: unknown }).segments)
      ? ((parsed as { segments: Array<{ id?: number; text?: string }> }).segments)
      : [];

  if (arr.length === 0) return segments;

  const byId = new Map<number, string>();
  for (const item of arr) {
    if (typeof item?.id === "number" && typeof item?.text === "string") {
      byId.set(item.id, item.text.trim());
    }
  }

  return segments.map((s) => {
    const cleaned = byId.get(s.id);
    return cleaned && cleaned.length > 0 ? { ...s, text: cleaned } : s;
  });
}

function dedupeRepeats(input: string): string {
  if (!input) return input;
  let s = input.replace(/(.)\1{5,}/g, "$1$1");

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 3) return s.trim();

  const out: string[] = [];
  let run = 1;
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i] === words[i - 1]) {
      run++;
      if (run >= 3) continue;
      out.push(words[i]);
    } else {
      run = 1;
      out.push(words[i]);
    }
  }

  for (let n = 2; n <= 5; n++) {
    let i = 0;
    while (i + 3 * n <= out.length) {
      const a = out.slice(i, i + n).join(" ");
      const b = out.slice(i + n, i + 2 * n).join(" ");
      const c = out.slice(i + 2 * n, i + 3 * n).join(" ");
      if (a === b && b === c) {
        out.splice(i + 2 * n, n);
      } else {
        i++;
      }
    }
  }

  return out.join(" ").replace(/\s+([،.؟!,?.])/g, "$1").trim();
}
