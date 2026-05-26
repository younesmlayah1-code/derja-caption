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

        // Groq free tier limit is 25MB per file.
        const MAX = 25 * 1024 * 1024;
        if (file.size > MAX) {
          return Response.json(
            { error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Groq Whisper accepts up to 25MB. Please trim or compress the audio.` },
            { status: 413 },
          );
        }

        // A Derja-focused prompt biases Whisper toward Tunisian Arabic spelling,
        // common words, and code-switching with French — this dramatically reduces
        // grammar mistakes vs. the default Modern Standard Arabic decoding.
        const derjaPrompt =
          "نقل صوتي باللهجة التونسية الدارجة. كلمات شائعة: برشا، ياسر، شنوة، علاش، كيفاش، وقتاش، نحب، نجم، باهي، نرمال، فما، موش، ماكش، تو، توا، يعيشك، صحة، ربي، إنشاء الله، يزي، أهلا، مرحبا. قد تتضمن كلمات فرنسية مثل: normal, voilà, donc, parce que, déjà, bon, bref.";

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
