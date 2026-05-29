import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
const recentLogs: string[] = [];

// Single-thread core works without cross-origin isolation headers.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      recentLogs.push(message);
      if (recentLogs.length > 60) recentLogs.shift();
    });
    await ff.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ff;
    return ff;
  })();

  return loadPromise;
}

export type ClipProgress = (info: { stage: "loading" | "cutting" | "done"; pct?: number }) => void;

async function runCut(
  ff: FFmpeg,
  inputName: string,
  outputName: string,
  startSec: number,
  duration: number,
  mode: "reencode" | "copy",
) {
  const args =
    mode === "reencode"
      ? [
          "-ss", startSec.toFixed(3),
          "-i", inputName,
          "-t", duration.toFixed(3),
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outputName,
        ]
      : [
          "-ss", startSec.toFixed(3),
          "-i", inputName,
          "-t", duration.toFixed(3),
          "-c", "copy",
          "-movflags", "+faststart",
          outputName,
        ];
  return ff.exec(args);
}

export async function cutMp4Clip(
  file: File,
  startSec: number,
  endSec: number,
  onProgress?: ClipProgress,
): Promise<Blob> {
  onProgress?.({ stage: "loading" });
  const ff = await getFFmpeg();

  const duration = Math.max(0.1, endSec - startSec);
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
  const inputName = "input." + ext;
  const outputName = "clip.mp4";

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.({ stage: "cutting", pct: Math.max(0, Math.min(1, progress)) });
  };
  ff.on("progress", progressHandler);

  recentLogs.length = 0;

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    let code: number | undefined;
    try {
      code = await runCut(ff, inputName, outputName, startSec, duration, "reencode");
    } catch (e) {
      // ffmpeg.exec throws on non-zero in some versions; fall through to copy fallback
      console.warn("ffmpeg reencode threw:", e);
      code = 1;
    }

    if (code !== 0) {
      // Fallback: stream-copy (faster, no re-encode). Works if cut lands near a keyframe.
      try {
        try { await ff.deleteFile(outputName); } catch { /* ignore */ }
        code = await runCut(ff, inputName, outputName, startSec, duration, "copy");
      } catch (e) {
        console.warn("ffmpeg copy threw:", e);
        code = 1;
      }
    }

    if (code !== 0) {
      const tail = recentLogs.slice(-6).join(" | ");
      throw new Error(`ffmpeg exited (${code}). ${tail.slice(0, 300)}`);
    }

    const data = await ff.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (bytes.byteLength < 1024) {
      const tail = recentLogs.slice(-6).join(" | ");
      throw new Error(`Output too small (${bytes.byteLength}B). ${tail.slice(0, 300)}`);
    }
    onProgress?.({ stage: "done", pct: 1 });
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    ff.off("progress", progressHandler);
    try { await ff.deleteFile(inputName); } catch { /* ignore */ }
    try { await ff.deleteFile(outputName); } catch { /* ignore */ }
  }
}
