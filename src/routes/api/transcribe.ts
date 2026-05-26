import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
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
        upstream.append("language", "ar");
        upstream.append("response_format", "verbose_json");
        upstream.append("temperature", "0");
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
        };

        const rawSegments = (data.segments ?? []).map((s, i) => ({
          id: typeof s.id === "number" ? s.id : i,
          start: s.start,
          end: s.end,
          text: dedupeRepeats((s.text || "").trim()),
        }));

        // Drop segments that became empty after dedupe.
        const segments = rawSegments.filter((s) => s.text.length > 0);

        const fullText = dedupeRepeats((data.text || "").trim());

        // Forward Groq rate-limit headers so the UI can show "minutes left today".
        const h = res.headers;
        const rate = {
          limitAudioSeconds: numOrNull(h.get("x-ratelimit-limit-audio-seconds")),
          remainingAudioSeconds: numOrNull(h.get("x-ratelimit-remaining-audio-seconds")),
          resetAudioSeconds: h.get("x-ratelimit-reset-audio-seconds"),
          limitRequests: numOrNull(h.get("x-ratelimit-limit-requests")),
          remainingRequests: numOrNull(h.get("x-ratelimit-remaining-requests")),
        };

        return Response.json({ text: fullText, segments, rate });
      },
    },
  },
});

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Collapse Whisper repetition artifacts:
//  - identical consecutive words ("نعم نعم نعم" -> "نعم")
//  - identical consecutive short phrases (up to 5 words)
//  - long runs of the same character ("اااااا" -> "اا")
function dedupeRepeats(input: string): string {
  if (!input) return input;
  let s = input.replace(/(.)\1{4,}/g, "$1$1");

  const tokens = s.split(/(\s+)/); // keep whitespace
  const words = tokens.filter((t) => t.trim().length > 0);
  if (words.length < 2) return s.trim();

  // Remove consecutive duplicate words
  const out: string[] = [];
  for (const w of words) {
    if (out.length && out[out.length - 1] === w) continue;
    out.push(w);
  }

  // Remove consecutive duplicate n-grams (n=2..5)
  for (let n = 5; n >= 2; n--) {
    let i = 0;
    while (i + 2 * n <= out.length) {
      const a = out.slice(i, i + n).join(" ");
      const b = out.slice(i + n, i + 2 * n).join(" ");
      if (a === b) {
        out.splice(i + n, n);
      } else {
        i++;
      }
    }
  }

  return out.join(" ").replace(/\s+([،.؟!,?.])/g, "$1").trim();
}
