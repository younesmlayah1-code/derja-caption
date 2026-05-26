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

        // Short, neutral Arabic prompt. Long keyword lists were biasing the
        // model and causing it to repeat the same words. A minimal hint is
        // enough to lock the script to Arabic without skewing output.
        const derjaPrompt =
          "تفريغ صوتي باللهجة التونسية بالحروف العربية فقط، مع علامات الترقيم.";

        const upstream = new FormData();
        upstream.append("file", file, file.name || "audio.wav");
        upstream.append("model", "whisper-large-v3");
        upstream.append("language", "ar");
        upstream.append("response_format", "verbose_json");
        // Small non-zero temperature lets Whisper's fallback decoder break
        // out of repetition loops when compression_ratio is too high.
        upstream.append("temperature", "0.2");
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

        const segments = (data.segments ?? []).map((s, i) => ({
          id: typeof s.id === "number" ? s.id : i,
          start: s.start,
          end: s.end,
          text: (s.text || "").trim(),
        }));

        // Forward Groq rate-limit headers so the UI can show "minutes left today".
        // Groq sends values like "28800" (seconds) and reset like "23h59m59s".
        const h = res.headers;
        const rate = {
          limitAudioSeconds: numOrNull(h.get("x-ratelimit-limit-audio-seconds")),
          remainingAudioSeconds: numOrNull(h.get("x-ratelimit-remaining-audio-seconds")),
          resetAudioSeconds: h.get("x-ratelimit-reset-audio-seconds"),
          limitRequests: numOrNull(h.get("x-ratelimit-limit-requests")),
          remainingRequests: numOrNull(h.get("x-ratelimit-remaining-requests")),
        };

        return Response.json({ text: (data.text || "").trim(), segments, rate });
      },
    },
  },
});

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
