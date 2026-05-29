import { createFileRoute } from "@tanstack/react-router";
import { getSecret } from "@/lib/secrets.server";
import { requireActiveUser } from "@/lib/access.server";
import { geminiChat } from "@/lib/gemini.server";

type SegIn = { id: number; start: number; end: number; text: string };
type Range = { start: number; end: number };

export const Route = createFileRoute("/api/suggest-clip")({
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

        let body: {
          segments?: SegIn[];
          excludeRanges?: Range[];
          minSec?: number;
          maxSec?: number;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }

        const segments = Array.isArray(body.segments) ? body.segments : [];
        if (segments.length === 0) {
          return Response.json({ error: "No segments provided." }, { status: 400 });
        }

        const minSec = Math.max(15, Number(body.minSec) || 90);
        const maxSec = Math.max(minSec + 15, Number(body.maxSec) || 180);
        const excludeRanges = Array.isArray(body.excludeRanges) ? body.excludeRanges : [];

        const compact = segments.map((s) => ({
          id: s.id,
          s: Math.round(s.start * 10) / 10,
          e: Math.round(s.end * 10) / 10,
          t: (s.text || "").slice(0, 240),
        }));

        const totalDur = segments[segments.length - 1].end;

        const excludeStr =
          excludeRanges.length > 0
            ? ` Avoid overlapping these already-tried ranges (seconds): ${excludeRanges
                .map((r) => `[${Math.round(r.start)}-${Math.round(r.end)}]`)
                .join(", ")}. Pick a DIFFERENT moment.`
            : "";

        const system =
          "You are a short-form video editor. Given a transcript with timestamps from a longer video, " +
          `pick the SINGLE best contiguous clip between ${minSec} and ${maxSec} seconds long that works ` +
          "as a standalone short-form video. The clip MUST have: " +
          "(1) a strong HOOK in the first sentence that grabs attention, " +
          "(2) a self-contained payoff or insight in the middle, " +
          "(3) a clean ENDING that feels resolved — not cut off mid-thought. " +
          "Snap start and end to segment boundaries. Do not exceed total duration." +
          excludeStr +
          ' Return JSON only: {"start": <seconds>, "end": <seconds>, "title": "<short title>", "reason": "<one sentence why it works>"}';

        const user = JSON.stringify({ totalDurationSec: totalDur, segments: compact });

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            temperature: excludeRanges.length > 0 ? 0.7 : 0.3,
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
        const end = clamp(Number(parsed.end ?? start + minSec), start + 15, totalDur);

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

