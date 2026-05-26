import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
        }

        try {
          const incoming = await request.formData();
          const file = incoming.get("file");
          if (!(file instanceof File)) {
            return Response.json({ error: "No file provided" }, { status: 400 });
          }

          // OpenAI hard limit for whisper/transcriptions endpoint is 25MB.
          if (file.size > 25 * 1024 * 1024) {
            return Response.json(
              { error: "File too large for transcription API (25MB max). Please trim or compress the video." },
              { status: 413 },
            );
          }

          const fd = new FormData();
          fd.append("file", file, file.name || "audio.mp4");
          fd.append("model", "whisper-1");
          fd.append("language", "ar");
          fd.append("response_format", "verbose_json");
          fd.append(
            "prompt",
            "This is Tunisian Arabic (Derja). Transcribe naturally in Arabic script, preserving Tunisian dialect words.",
          );

          const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: fd,
          });

          if (!res.ok) {
            const errText = await res.text();
            return Response.json({ error: `OpenAI error: ${errText}` }, { status: res.status });
          }

          const data = (await res.json()) as {
            text: string;
            segments?: Array<{ id: number; start: number; end: number; text: string }>;
          };

          return Response.json({
            text: data.text,
            segments:
              data.segments?.map((s) => ({
                id: s.id,
                start: s.start,
                end: s.end,
                text: s.text.trim(),
              })) ?? [],
          });
        } catch (err) {
          console.error(err);
          return Response.json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
  },
});
