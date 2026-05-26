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

        // Pure-Arabic Derja prompt. We intentionally do NOT include English
        // or French words here — listing them was causing Whisper to switch
        // languages and emit Latin-script text in the middle of Arabic
        // transcripts. Keeping the prompt 100% Arabic locks the model to
        // Arabic script output.
        const derjaPrompt =
          "النص التالي مكتوب باللهجة التونسية الدارجة فقط، بالحروف العربية، مع علامات الترقيم الصحيحة. " +
          "كلمات شائعة في الدارجة التونسية: برشا، ياسر، شنوة، علاش، كيفاش، وقتاش، نحب، نجم، باهي، نرمال، فما، موش، ماكش، تو، توا، يعيشك، صحة، ربي، إن شاء الله، يزي، أهلا، مرحبا، زادا، كان، إيا، أما، خاطر، حتى، عندي، عندك، نعمل، نمشي، نجي، شفت، قلت، قال، قالت، نقعد، نخدم، نشوف، نسمع، نقرا، نكتب، نتفرج، نضحك، نحكي. " +
          "اكتب كل شيء بالعربية فقط، ولا تستعمل الحروف اللاتينية أبدا.";

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
