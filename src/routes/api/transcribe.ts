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

        // Derja-biasing prompt + optional running context from previous chunk
        // to keep vocabulary and spelling consistent across long videos.
        const context = (incoming.get("context") as string | null) || "";
        const derjaPrompt =
          "نقل صوتي دقيق باللهجة التونسية الدارجة مع علامات الترقيم. " +
          "كلمات شائعة: برشا، ياسر، شنوة، علاش، كيفاش، وقتاش، نحب، نجم، باهي، نرمال، فما، موش، ماكش، تو، توا، يعيشك، صحة، ربي، إنشاء الله، يزي، أهلا، مرحبا، زادا، كان، إيا، أما، خاطر، حتى، عندي، عندك، نعمل، نمشي، نجي، شفت، قلت، قال، قالت. " +
          "قد تتضمن كلمات فرنسية مثل: normal, voilà, donc, parce que, déjà, bon, bref, ok, merci, salut.";
        const fullPrompt = context ? `${derjaPrompt}\n\nسياق سابق: ${context}` : derjaPrompt;

        const upstream = new FormData();
        upstream.append("file", file, file.name || "audio.wav");
        // whisper-large-v3 = highest accuracy Groq offers for Arabic dialects.
        upstream.append("model", "whisper-large-v3");
        upstream.append("language", "ar");
        upstream.append("response_format", "verbose_json");
        upstream.append("temperature", "0");
        upstream.append("prompt", fullPrompt);

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

        return Response.json({ text: (data.text || "").trim(), segments });
      },
    },
  },
});
