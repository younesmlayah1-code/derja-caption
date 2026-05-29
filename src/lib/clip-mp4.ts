import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// Single-thread core works without cross-origin isolation headers.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ff = new FFmpeg();
    if (onLog) ff.on("log", ({ message }) => onLog(message));
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

export async function cutMp4Clip(
  file: File,
  startSec: number,
  endSec: number,
  onProgress?: ClipProgress,
): Promise<Blob> {
  onProgress?.({ stage: "loading" });
  const ff = await getFFmpeg();

  const duration = Math.max(0.1, endSec - startSec);
  const inputName = "input." + (file.name.split(".").pop() || "mp4").toLowerCase();
  const outputName = "clip.mp4";

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.({ stage: "cutting", pct: Math.max(0, Math.min(1, progress)) });
  };
  ff.on("progress", progressHandler);

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    // Re-encode for reliable cut + browser MP4 playback (faststart for streaming).
    // Stream-copy (-c copy) is faster but often produces blank leading frames
    // because cuts don't land on keyframes.
    await ff.exec([
      "-ss",
      startSec.toFixed(3),
      "-i",
      inputName,
      "-t",
      duration.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    const data = await ff.readFile(outputName);
    onProgress?.({ stage: "done", pct: 1 });
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    ff.off("progress", progressHandler);
    try {
      await ff.deleteFile(inputName);
      await ff.deleteFile(outputName);
    } catch {
      /* ignore */
    }
  }
}
