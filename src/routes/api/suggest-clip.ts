import { createFileRoute } from "@tanstack/react-router";

type SegIn = { id: number; start: number; end: number; text: string };

export const Route = createFileRoute("/api/suggest-clip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ error: "LOVABLE_API_KEY is not configured." }, { status: 500 });
        }

        let body: { segments?: SegIn[] };
        try {
          body = (await request.json()) as { segments?: SegIn[] };
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }

        const segments = Array.isArray(body.segments) ? body.segments : [];
        if (segments.length === 0) {
          return Response.json({ error: "No segments provided." }, { status: 400 });
        }

        // Trim payload — id, rounded times, text only.
        const compact = segments.map((s) => ({
          id: s.id,
          s: Math.round(s.start * 10) / 10,
          e: Math.round(s.end * 10) / 10,
          t: (s.text || "").slice(0, 240),
        }));

        const totalDur = segments[segments.length - 1].end;

        const system =
          "You are a short-form video editor. Given a transcript with timestamps from a longer video, " +
          "pick the SINGLE best contiguous clip between 120 and 240 seconds long (2–4 minutes) that would work " +
          "as a standalone short — a complete thought, hook + payoff, surprising/funny/insightful moment. " +
          "Snap start and end to segment boundaries. The clip must NOT exceed the video's total duration. " +
          'Return JSON only: {"start": <seconds>, "end": <seconds>, "title": "<short title>", "reason": "<one sentence why>"}';

        const user = JSON.stringify({ totalDurationSec: totalDur, segments: compact });

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            temperature: 0.3,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          return Response.json(
            { error: `AI suggest-clip failed (${res.status}): ${text.slice(0, 300)}` },
            { status: 502 },
          );
        }

        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = j.choices?.[0]?.message?.content?.trim() ?? "";
        let parsed: { start?: number; end?: number; title?: string; reason?: string } = {};
        try {
          parsed = JSON.parse(content);
        } catch {
          const m = content.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              parsed = JSON.parse(m[0]);
            } catch {
              /* ignore */
            }
          }
        }

        const start = clamp(Number(parsed.start ?? 0), 0, totalDur);
        const end = clamp(Number(parsed.end ?? start + 180), start + 30, totalDur);

        return Response.json({
          start,
          end,
          title: typeof parsed.title === "string" ? parsed.title : "Best clip",
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
        });
      },
    },
  },
});

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
