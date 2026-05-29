import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
const recentLogs: string[] = [];

// Keep a local single-thread core in /public so clip export does not depend on
// CDN availability and does not require cross-origin isolation headers.
const LOCAL_CORE = "/ffmpeg";
const CDN_CORE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let ff = new FFmpeg();
    const logHandler = ({ message }: { message: string }) => {
      recentLogs.push(message);
      if (recentLogs.length > 60) recentLogs.shift();
    };
    ff.on("log", logHandler);
    try {
      await ff.load({
        coreURL: `${LOCAL_CORE}/ffmpeg-core.js`,
        wasmURL: `${LOCAL_CORE}/ffmpeg-core.wasm`,
      });
    } catch (localError) {
      console.warn("local ffmpeg core failed, trying CDN fallback:", localError);
      try { ff.terminate(); } catch { /* ignore */ }
      ff = new FFmpeg();
      ff.on("log", logHandler);
      await ff.load({
        coreURL: await toBlobURL(`${CDN_CORE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CDN_CORE}/ffmpeg-core.wasm`, "application/wasm"),
      });
    }
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
  mode: "fast-copy" | "copy" | "reencode",
) {
  const ss = startSec.toFixed(3);
  const t = duration.toFixed(3);
  const commonMaps = ["-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn"];
  const args = mode === "fast-copy"
    ? [
        "-hide_banner",
        "-ss", ss,
        "-i", inputName,
        "-t", t,
        ...commonMaps,
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        outputName,
      ]
    : mode === "copy"
      ? [
          "-hide_banner",
          "-i", inputName,
          "-ss", ss,
          "-t", t,
          ...commonMaps,
          "-c", "copy",
          "-avoid_negative_ts", "make_zero",
          "-movflags", "+faststart",
          outputName,
        ]
      : [
          "-hide_banner",
          "-ss", ss,
          "-i", inputName,
          "-t", t,
          ...commonMaps,
          "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "28",
          "-profile:v", "baseline",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "44100",
          "-ac", "2",
          "-movflags", "+faststart",
          outputName,
        ];
  return ff.exec(args);
}

function resetFFmpeg() {
  if (ffmpegInstance) {
    try { ffmpegInstance.terminate(); } catch { /* ignore */ }
  }
  ffmpegInstance = null;
  loadPromise = null;
}

function errorDetails(error: unknown) {
  const message = error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error
      ? error
      : "browser video encoder stopped unexpectedly";
  const tail = recentLogs.slice(-10).join(" | ");
  return tail ? `${message}. ${tail.slice(0, 500)}` : message;
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
  const inputFileName = "input" + extensionFor(file);
  let inputName = `/input/${inputFileName}`;
  const outputName = `clip-${Date.now()}.mp4`;
  let mounted = false;

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.({ stage: "cutting", pct: Math.max(0, Math.min(1, progress)) });
  };
  ff.on("progress", progressHandler);

  recentLogs.length = 0;

  try {
    try {
      await ff.createDir("/input");
    } catch { /* already exists */ }
    try {
      await ff.mount(FFFSType.WORKERFS, { files: [new File([file], inputFileName, { type: file.type })] }, "/input");
      mounted = true;
    } catch (mountError) {
      console.warn("ffmpeg WORKERFS mount failed, copying file instead:", mountError);
      inputName = inputFileName;
      await ff.writeFile(inputName, await fetchFile(file));
    }

    let lastError: unknown = null;
    let outputBytes: Uint8Array | null = null;
    for (const mode of ["fast-copy", "copy", "reencode"] as const) {
      try {
        try { await ff.deleteFile(outputName); } catch { /* ignore */ }
        const code = await runCut(ff, inputName, outputName, startSec, duration, mode);
        if (code === 0) {
          const data = await ff.readFile(outputName);
          const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
          if (bytes.byteLength >= 1024) {
            outputBytes = bytes;
            lastError = null;
            break;
          }
          lastError = new Error(`${mode} output too small (${bytes.byteLength}B)`);
          continue;
        }
        lastError = new Error(`${mode} exited with code ${code}`);
      } catch (e) {
        console.warn(`ffmpeg ${mode} threw:`, e);
        lastError = e;
      }
    }
    if (lastError || !outputBytes) {
      throw new Error(errorDetails(lastError));
    }

    onProgress?.({ stage: "done", pct: 1 });
    const buf = new ArrayBuffer(outputBytes.byteLength);
    new Uint8Array(buf).set(outputBytes);
    return new Blob([buf], { type: "video/mp4" });
  } catch (e) {
    resetFFmpeg();
    throw new Error(errorDetails(e));
  } finally {
    ff.off("progress", progressHandler);
    if (mounted) {
      try { await ff.unmount("/input"); } catch { /* ignore */ }
      try { await ff.deleteDir("/input"); } catch { /* ignore */ }
    } else {
      try { await ff.deleteFile(inputName); } catch { /* ignore */ }
    }
    try { await ff.deleteFile(outputName); } catch { /* ignore */ }
  }
}

function extensionFor(file: File) {
  const raw = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const safe = raw.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
  return `.${safe}`;
}
