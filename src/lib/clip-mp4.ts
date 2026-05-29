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
      try {
        ff.terminate();
      } catch {
        /* ignore */
      }
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

export type ClipProgress = (info: {
  stage: "loading" | "cutting" | "recording" | "done";
  pct?: number;
  note?: string;
}) => void;

async function runCut(
  ff: FFmpeg,
  inputName: string,
  outputName: string,
  startSec: number,
  duration: number,
  mode: "fast-copy" | "copy" | "remux-audio" | "h264-aac" | "native-mp4" | "video-only",
) {
  const ss = startSec.toFixed(3);
  const t = duration.toFixed(3);
  const commonMaps = ["-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn"];
  const safeScale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  let args: string[];

  switch (mode) {
    case "fast-copy":
      args = [
          "-hide_banner",
          "-ss",
          ss,
          "-i",
          inputName,
          "-t",
          t,
          ...commonMaps,
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputName,
        ];
      break;
    case "copy":
      args = [
            "-hide_banner",
            "-i",
            inputName,
            "-ss",
            ss,
            "-t",
            t,
            ...commonMaps,
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            outputName,
          ];
      break;
    case "remux-audio":
      args = [
              "-hide_banner",
              "-ss",
              ss,
              "-i",
              inputName,
              "-t",
              t,
              ...commonMaps,
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-movflags",
              "+faststart",
              "-f",
              "mp4",
              outputName,
            ];
      break;
    case "h264-aac":
      args = [
                "-hide_banner",
                "-ss",
                ss,
                "-i",
                inputName,
                "-t",
                t,
                ...commonMaps,
                "-vf",
                safeScale,
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "30",
                "-profile:v",
                "baseline",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ar",
                "44100",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                outputName,
              ];
      break;
    case "native-mp4":
      args = [
                  "-hide_banner",
                  "-ss",
                  ss,
                  "-i",
                  inputName,
                  "-t",
                  t,
                  ...commonMaps,
                  "-vf",
                  safeScale,
                  "-c:v",
                  "mpeg4",
                  "-q:v",
                  "5",
                  "-tag:v",
                  "mp4v",
                  "-c:a",
                  "aac",
                  "-b:a",
                  "128k",
                  "-movflags",
                  "+faststart",
                  "-f",
                  "mp4",
                  outputName,
                ];
      break;
    case "video-only":
      args = [
                    "-hide_banner",
                    "-ss",
                    ss,
                    "-i",
                    inputName,
                    "-t",
                    t,
                    "-map",
                    "0:v:0?",
                    "-an",
                    "-sn",
                    "-dn",
                    "-vf",
                    safeScale,
                    "-c:v",
                    "mpeg4",
                    "-q:v",
                    "5",
                    "-tag:v",
                    "mp4v",
                    "-movflags",
                    "+faststart",
                    "-f",
                    "mp4",
                    outputName,
                  ];
      break;
  }
  return ff.exec(args);
}

function resetFFmpeg() {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      /* ignore */
    }
  }
  ffmpegInstance = null;
  loadPromise = null;
}

function errorDetails(error: unknown) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string" && error
        ? error
        : "browser video encoder stopped unexpectedly";
  const tail = recentLogs.slice(-10).join(" | ");
  return tail ? `${message}. ${tail.slice(0, 500)}` : message;
}

function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}

function waitForVideoEvent(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap) {
  return new Promise<void>((resolve, reject) => {
    const onOk = () => cleanup(resolve);
    const onError = () => cleanup(() => reject(new Error(`Video ${event} failed.`)));
    const cleanup = (finish: () => void) => {
      video.removeEventListener(event, onOk);
      video.removeEventListener("error", onError);
      finish();
    };
    video.addEventListener(event, onOk, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function recordClipFallback(
  file: File,
  startSec: number,
  endSec: number,
  onProgress?: ClipProgress,
): Promise<Blob> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record video clips.");
  }

  const mimeType = pickRecorderMime();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  const duration = Math.max(0.1, endSec - startSec);
  let progressTimer = 0;

  video.src = url;
  video.preload = "auto";
  video.playsInline = true;
  video.volume = 0;
  video.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);

  try {
    await waitForVideoEvent(video, "loadedmetadata");
    video.currentTime = Math.max(0, Math.min(startSec, Math.max(0, video.duration - 0.1)));
    await waitForVideoEvent(video, "seeked");

    const stream =
      (video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream })
        .captureStream?.() ??
      (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
    if (!stream || stream.getTracks().length === 0) {
      throw new Error("This browser cannot capture the selected video range.");
    }

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("Browser recording failed."));
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "video/webm";
        if (chunks.length === 0) reject(new Error("Browser recording produced an empty clip."));
        else resolve(new Blob(chunks, { type }));
      };
    });

    const stopRecording = () => {
      if (recorder.state !== "inactive") recorder.stop();
      video.pause();
    };
    video.addEventListener("timeupdate", () => {
      if (video.currentTime >= endSec) stopRecording();
    });
    progressTimer = window.setInterval(() => {
      const pct = Math.max(0, Math.min(1, (video.currentTime - startSec) / duration));
      onProgress?.({ stage: "recording", pct, note: "Encoder fallback" });
    }, 500);

    recorder.start(1000);
    try {
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }
    window.setTimeout(stopRecording, duration * 1000 + 1500);
    return await stopped;
  } finally {
    if (progressTimer) window.clearInterval(progressTimer);
    video.remove();
    URL.revokeObjectURL(url);
  }
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
    } catch {
      /* already exists */
    }
    try {
      await ff.mount(
        FFFSType.WORKERFS,
        { files: [new File([file], inputFileName, { type: file.type })] },
        "/input",
      );
      mounted = true;
    } catch (mountError) {
      console.warn("ffmpeg WORKERFS mount failed, copying file instead:", mountError);
      inputName = inputFileName;
      await ff.writeFile(inputName, await fetchFile(file));
    }

    let lastError: unknown = null;
    let outputBytes: Uint8Array | null = null;
    for (const mode of [
      "fast-copy",
      "copy",
      "remux-audio",
      "h264-aac",
      "native-mp4",
      "video-only",
    ] as const) {
      try {
        try {
          await ff.deleteFile(outputName);
        } catch {
          /* ignore */
        }
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
    try {
      onProgress?.({ stage: "recording", pct: 0, note: "Encoder fallback" });
      const fallback = await recordClipFallback(file, startSec, endSec, onProgress);
      onProgress?.({ stage: "done", pct: 1 });
      return fallback;
    } catch (fallbackError) {
      throw new Error(`${errorDetails(e)}. Fallback failed: ${errorDetails(fallbackError)}`);
    }
  } finally {
    ff.off("progress", progressHandler);
    if (mounted) {
      try {
        await ff.unmount("/input");
      } catch {
        /* ignore */
      }
      try {
        await ff.deleteDir("/input");
      } catch {
        /* ignore */
      }
    } else {
      try {
        await ff.deleteFile(inputName);
      } catch {
        /* ignore */
      }
    }
    try {
      await ff.deleteFile(outputName);
    } catch {
      /* ignore */
    }
  }
}

function extensionFor(file: File) {
  const raw = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const safe = raw.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
  return `.${safe}`;
}
