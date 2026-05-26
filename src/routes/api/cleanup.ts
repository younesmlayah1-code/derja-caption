import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
        }

        try {
          const { text } = (await request.json()) as { text?: string };
          if (!text || typeof text !== "string") {
            return Response.json({ error: "Missing text" }, { status: 400 });
          }

          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              temperature: 0.2,
              messages: [
                {
                  role: "system",
                  content:
                    "You clean up Tunisian Arabic (Derja) transcripts. Fix punctuation, spacing, line breaks and obvious spelling. NEVER translate, NEVER convert Derja words to MSA, NEVER change meaning. Keep the exact same dialect words. Return only the cleaned transcript, no commentary.",
                },
                { role: "user", content: text },
              ],
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            return Response.json({ error: `OpenAI error: ${errText}` }, { status: res.status });
          }

          const data = (await res.json()) as {
            choices: Array<{ message: { content: string } }>;
          };

          return Response.json({ text: data.choices[0]?.message?.content?.trim() ?? text });
        } catch (err) {
          console.error(err);
          return Response.json({ error: (err as Error).message }, { status: 500 });
        }
      },
    },
  },
});
