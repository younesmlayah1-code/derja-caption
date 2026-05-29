import { createFileRoute } from "@tanstack/react-router";
import createFFmpegCore from "@ffmpeg/core";

export const Route = createFileRoute("/api/cut-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const start = Number(form.get("start"));
          const end = Number(form.get("end"));
          const remoteUrl = String(form.get("url") || "").trim();
          const upload = form.get("file");

          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return Response.json({ error: "Invalid clip start/end." }, { status: 400 });
          }

          const source = remoteUrl
            ? await fetchRemoteVideo(remoteUrl)
            : upload instanceof File
              ? new Uint8Array(await upload.arrayBuffer())
              : null;

          if (!source) {
            return Response.json({ error: "Missing video file or source URL." }, { status: 400 });
          }

          const clip = await cutWithServerFFmpeg(source, start, end, request.url);
          return new Response(clip, {
            status: 200,
            headers: {
              "content-type": "video/mp4",
              "content-disposition": 'attachment; filename="clip.mp4"',
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          console.error("server clip failed:", error);
          const message = error instanceof Error && error.message ? error.message : "Server clip export failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

type FFmpegCore = {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
  exec: (...args: string[]) => number;
};

async function fetchRemoteVideo(url: string): Promise<Uint8Array> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Invalid remote video URL.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download source video (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function cutWithServerFFmpeg(
  input: Uint8Array,
  startSec: number,
  endSec: number,
  requestUrl: string,
): Promise<Uint8Array> {
  const logs: string[] = [];
  const g = globalThis as typeof globalThis & { self?: unknown; location?: unknown };
  g.self ??= g;
  g.location ??= { href: requestUrl };

  const wasmRes = await fetch(new URL("/ffmpeg/ffmpeg-core.wasm", requestUrl));
  if (!wasmRes.ok) throw new Error(`Could not load server video encoder (${wasmRes.status}).`);

  const core = (await createFFmpegCore({
    wasmBinary: new Uint8Array(await wasmRes.arrayBuffer()),
    logger: ({ message }: { message: string }) => {
      logs.push(message);
      if (logs.length > 80) logs.shift();
    },
  })) as FFmpegCore;

  const inputName = "/input.mp4";
  const outputName = "/clip.mp4";
  core.FS.writeFile(inputName, input);
  try {
    const duration = Math.max(0.1, endSec - startSec).toFixed(3);
    const start = Math.max(0, startSec).toFixed(3);
    const modes: string[][] = [
      ["-ss", start, "-i", inputName, "-t", duration, "-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-f", "mp4", outputName],
      ["-i", inputName, "-ss", start, "-t", duration, "-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-f", "mp4", outputName],
      ["-ss", start, "-i", inputName, "-t", duration, "-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "mpeg4", "-q:v", "5", "-tag:v", "mp4v", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4", outputName],
      ["-ss", start, "-i", inputName, "-t", duration, "-map", "0:v:0?", "-an", "-sn", "-dn", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "mpeg4", "-q:v", "5", "-tag:v", "mp4v", "-movflags", "+faststart", "-f", "mp4", outputName],
    ];

    let last = "unknown";
    for (const args of modes) {
      try {
        try {
          core.FS.unlink(outputName);
        } catch {
          /* ignore */
        }
        const code = core.exec(...args);
        if (code === 0) {
          const out = core.FS.readFile(outputName);
          if (out.byteLength > 1024) return out;
          last = `empty output (${out.byteLength}B)`;
        } else {
          last = `encoder exited with ${code}`;
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
    }
    const tail = logs.slice(-8).join(" | ").slice(0, 600);
    throw new Error(`Server clip export failed: ${last}${tail ? `. ${tail}` : ""}`);
  } finally {
    try {
      core.FS.unlink(inputName);
    } catch {
      /* ignore */
    }
    try {
      core.FS.unlink(outputName);
    } catch {
      /* ignore */
    }
  }
}