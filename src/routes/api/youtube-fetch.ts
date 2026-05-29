import { createFileRoute } from "@tanstack/react-router";

// Proxies a YouTube video URL into an MP4 download using RapidAPI's `yt-api`
// (https://rapidapi.com/ytjar/api/yt-api). Requires a RAPIDAPI_KEY secret.
// Two modes:
//   POST { url } -> { videoId, title, mp4Url, sizeBytes? }   (resolve only)
//   GET  ?stream=<encoded mp4Url>&name=<filename>           (proxy stream)

export const Route = createFileRoute("/api/youtube-fetch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = process.env.RAPIDAPI_KEY;
        if (!key) {
          return Response.json(
            { error: "RAPIDAPI_KEY is not configured. Add it in project secrets." },
            { status: 500 },
          );
        }
        const url = new URL(request.url);
        const target = url.searchParams.get("stream");
        const name = url.searchParams.get("name") || "youtube.mp4";
        if (!target) return Response.json({ error: "Missing stream param." }, { status: 400 });

        const upstream = await fetch(target);
        if (!upstream.ok || !upstream.body) {
          return Response.json(
            { error: `Upstream fetch failed (${upstream.status}).` },
            { status: 502 },
          );
        }
        const headers = new Headers();
        const ct = upstream.headers.get("content-type") || "video/mp4";
        headers.set("content-type", ct);
        const cl = upstream.headers.get("content-length");
        if (cl) headers.set("content-length", cl);
        headers.set(
          "content-disposition",
          `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        );
        return new Response(upstream.body, { status: 200, headers });
      },

      POST: async ({ request }) => {
        const key = process.env.RAPIDAPI_KEY;
        if (!key) {
          return Response.json(
            { error: "RAPIDAPI_KEY is not configured. Add it in project secrets." },
            { status: 500 },
          );
        }

        let body: { url?: string };
        try {
          body = (await request.json()) as { url?: string };
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }
        const ytUrl = (body.url || "").trim();
        if (!ytUrl) return Response.json({ error: "Missing url." }, { status: 400 });

        const videoId = extractVideoId(ytUrl);
        if (!videoId) {
          return Response.json({ error: "Could not parse a YouTube video ID." }, { status: 400 });
        }

        const apiRes = await fetch(`https://yt-api.p.rapidapi.com/dl?id=${videoId}`, {
          headers: {
            "x-rapidapi-key": key,
            "x-rapidapi-host": "yt-api.p.rapidapi.com",
          },
        });

        if (!apiRes.ok) {
          const text = await apiRes.text();
          return Response.json(
            { error: `RapidAPI yt-api error (${apiRes.status}): ${text.slice(0, 300)}` },
            { status: 502 },
          );
        }

        const data = (await apiRes.json()) as YtApiResponse;
        const formats = (data.formats || []).concat(data.adaptiveFormats || []);

        // Pick smallest MP4 with both audio+video. yt-api combined "formats"
        // entries (itag 18 = 360p mp4 with audio) are ideal for transcription.
        const combined = (data.formats || []).filter(
          (f) =>
            (f.mimeType || "").includes("video/mp4") &&
            (f.audioQuality || f.audioChannels || (f.mimeType || "").includes("mp4a")),
        );
        const sizeOf = (f: YtFormat) =>
          f.contentLength != null ? Number(f.contentLength) || 1e15 : 1e15;
        let chosen = combined.sort((a, b) => sizeOf(a) - sizeOf(b))[0];

        // Fallback: any mp4 video format.
        if (!chosen) {
          chosen = formats
            .filter((f) => (f.mimeType || "").includes("video/mp4") && f.url)
            .sort((a, b) => sizeOf(a) - sizeOf(b))[0];
        }

        if (!chosen || !chosen.url) {
          return Response.json(
            { error: "No downloadable MP4 format returned for this video." },
            { status: 502 },
          );
        }

        const title = (data.title || "youtube").replace(/[^\p{L}\p{N} _.-]+/gu, "").trim();
        const safeName = (title || "youtube") + ".mp4";
        const size = chosen.contentLength ? Number(chosen.contentLength) : undefined;

        return Response.json({
          videoId,
          title: data.title || "YouTube video",
          mp4Url: chosen.url,
          sizeBytes: Number.isFinite(size) ? size : undefined,
          filename: safeName,
          quality: chosen.qualityLabel || null,
        });
      },
    },
  },
});

type YtFormat = {
  url?: string;
  mimeType?: string;
  qualityLabel?: string;
  contentLength?: string | number;
  audioQuality?: string;
  audioChannels?: number;
};

type YtApiResponse = {
  title?: string;
  formats?: YtFormat[];
  adaptiveFormats?: YtFormat[];
};

function extractVideoId(input: string): string | null {
  // Plain 11-char id
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.findIndex((p) => p === "shorts" || p === "embed" || p === "v");
      if (i >= 0 && parts[i + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[i + 1])) return parts[i + 1];
    }
  } catch {
    /* fallthrough */
  }
  return null;
}
