// Client-side video burn-in using ffmpeg.wasm + libass (ASS subtitles).
// Single-threaded core so we don't need cross-origin isolation.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Segment } from "./subtitles";
import { segmentToWordCues } from "./subtitles";

export type BurnStyleId =
  | "tiktok"
  | "youtube"
  | "karaoke"
  | "neon"
  | "minimal";

export type BurnMode = "line" | "word";
export type BurnScript = "arabic" | "french";

export type BurnStyle = {
  id: BurnStyleId;
  name: string;
  description: string;
  // ASS style fields
  fontSize: number;
  primary: string; // &HBBGGRR
  secondary: string; // karaoke highlight
  outline: string;
  back: string;
  borderStyle: 1 | 3; // 1=outline+shadow, 3=opaque box
  outlineW: number;
  shadow: number;
  bold: 0 | 1;
  italic: 0 | 1;
  alignment: number; // numpad
  marginV: number;
};

export const BURN_STYLES: BurnStyle[] = [
  {
    id: "tiktok",
    name: "TikTok Bold",
    description: "Big white text in a black box. Reads on any background.",
    fontSize: 56,
    primary: "&H00FFFFFF",
    secondary: "&H0000D7FF",
    outline: "&H00000000",
    back: "&H80000000",
    borderStyle: 3,
    outlineW: 8,
    shadow: 0,
    bold: 1,
    italic: 0,
    alignment: 2,
    marginV: 120,
  },
  {
    id: "youtube",
    name: "YouTube Clean",
    description: "White text with crisp black outline. Classic.",
    fontSize: 48,
    primary: "&H00FFFFFF",
    secondary: "&H0000D7FF",
    outline: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outlineW: 3,
    shadow: 2,
    bold: 1,
    italic: 0,
    alignment: 2,
    marginV: 80,
  },
  {
    id: "karaoke",
    name: "Karaoke Pop",
    description: "Word-by-word yellow highlight as it's spoken.",
    fontSize: 54,
    primary: "&H00FFFFFF",
    secondary: "&H0000D7FF", // yellow highlight (BGR)
    outline: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outlineW: 4,
    shadow: 0,
    bold: 1,
    italic: 0,
    alignment: 2,
    marginV: 100,
  },
  {
    id: "neon",
    name: "Neon Derja",
    description: "Cyan glow with magenta shadow. Loud and modern.",
    fontSize: 52,
    primary: "&H00FFFF66", // cyan-ish
    secondary: "&H00FF66FF",
    outline: "&H00FF00C8", // magenta outline
    back: "&H00000000",
    borderStyle: 1,
    outlineW: 3,
    shadow: 4,
    bold: 1,
    italic: 0,
    alignment: 2,
    marginV: 110,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Smaller white text with a soft shadow.",
    fontSize: 38,
    primary: "&H00FFFFFF",
    secondary: "&H0000D7FF",
    outline: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outlineW: 1,
    shadow: 3,
    bold: 0,
    italic: 0,
    alignment: 2,
    marginV: 60,
  },
];

function pad(n: number, len = 2) {
  return n.toString().padStart(len, "0");
}
function fmtAss(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(c)}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

export function buildAss(
  segments: Segment[],
  opts: {
    style: BurnStyle;
    mode: BurnMode;
    script: BurnScript;
    width: number;
    height: number;
    fontName: string;
  },
): string {
  const { style, mode, script, width, height, fontName } = opts;
  // Scale style for video resolution; ASS is resolution-aware via PlayResX/Y.
  const playResX = width;
  const playResY = height;
  const fontSize = Math.round((style.fontSize * height) / 1080);
  const outlineW = Math.max(1, Math.round((style.outlineW * height) / 1080));
  const shadow = Math.round((style.shadow * height) / 1080);
  const marginV = Math.round((style.marginV * height) / 1080);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${style.primary},${style.secondary},${style.outline},${style.back},${style.bold},${style.italic},0,0,100,100,0,0,${style.borderStyle},${outlineW},${shadow},${style.alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dir = script === "arabic" ? "" : ""; // libass handles bidi via fribidi
  const lines: string[] = [];

  if (mode === "line" || style.id !== "karaoke") {
    for (const s of segments) {
      const text = (s.text || "").trim();
      if (!text) continue;
      lines.push(
        `Dialogue: 0,${fmtAss(s.start)},${fmtAss(s.end)},Default,,0,0,0,,${dir}${escapeAss(text)}`,
      );
    }
  } else {
    // Karaoke style with \k tags from word cues
    for (const s of segments) {
      const cues = segmentToWordCues(s);
      if (cues.length === 0) continue;
      const parts: string[] = [];
      for (const c of cues) {
        const durCs = Math.max(1, Math.round((c.end - c.start) * 100));
        parts.push(`{\\kf${durCs}}${escapeAss(c.text)} `);
      }
      lines.push(
        `Dialogue: 0,${fmtAss(s.start)},${fmtAss(s.end)},Default,,0,0,0,,${dir}${parts.join("")}`,
      );
    }
  }

  // For word-by-word mode (non-karaoke styles), emit one cue per word
  if (mode === "word" && style.id !== "karaoke") {
    lines.length = 0;
    for (const s of segments) {
      const cues = segmentToWordCues(s);
      for (const c of cues) {
        const t = (c.text || "").trim();
        if (!t) continue;
        lines.push(
          `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Default,,0,0,0,,${dir}${escapeAss(t)}`,
        );
      }
    }
  }

  return header + lines.join("\n") + "\n";
}

// --- ffmpeg.wasm singleton ---
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
const ARABIC_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Bold.ttf";
const LATIN_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/Inter/font_bundle/single-axis/Inter-Bold.ttf";

export const ARABIC_FONT_NAME = "Noto Naskh Arabic";
export const LATIN_FONT_NAME = "Inter";

export async function loadFFmpeg(
  onLog?: (msg: string) => void,
): Promise<FFmpeg> {
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

let fontsWritten = false;
async function ensureFonts(ff: FFmpeg) {
  if (fontsWritten) return;
  await ff.createDir("/fonts").catch(() => {});
  const [arabic, latin] = await Promise.all([
    fetch(ARABIC_FONT_URL).then((r) => r.arrayBuffer()),
    fetch(LATIN_FONT_URL).then((r) => r.arrayBuffer()),
  ]);
  await ff.writeFile("/fonts/NotoNaskhArabic-Bold.ttf", new Uint8Array(arabic));
  await ff.writeFile("/fonts/Inter-Bold.ttf", new Uint8Array(latin));
  fontsWritten = true;
}

export async function burnSubtitles(opts: {
  videoFile: File;
  ass: string;
  targetWidth?: number;
  targetHeight?: number;
  durationSec?: number;
  onPhase?: (phase: string) => void;
  onProgress?: (ratio: number) => void;
  onLog?: (msg: string) => void;
}): Promise<Blob> {
  opts.onPhase?.("Loading video engine…");
  opts.onProgress?.(0.01);
  const ff = await loadFFmpeg(opts.onLog);
  opts.onProgress?.(0.03);
  opts.onPhase?.("Loading caption fonts…");
  await ensureFonts(ff);
  opts.onProgress?.(0.05);

  const ext = opts.videoFile.name.split(".").pop()?.toLowerCase() || "mp4";
  const inputName = `input.${ext}`;
  const outputName = "output.mp4";
  const subName = "subs.ass";

  opts.onPhase?.("Copying video into browser renderer…");
  await ff.writeFile(inputName, await fetchFile(opts.videoFile));
  opts.onProgress?.(0.08);
  await ff.writeFile(subName, new TextEncoder().encode(opts.ass));
  opts.onProgress?.(0.1);
  opts.onPhase?.("Rendering captions into video…");

  // Progress: the built-in "progress" event is unreliable with filter graphs,
  // so parse "time=HH:MM:SS.cs" from logs as a robust fallback.
  let lastRatio = 0.1;
  const report = (r: number) => {
    if (!opts.onProgress) return;
    const v = Math.min(0.99, Math.max(0, r));
    if (v > lastRatio) {
      lastRatio = v;
      opts.onProgress(v);
    }
  };
  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress) && progress > 0) report(progress);
  };
  const logHandler = ({ message }: { message: string }) => {
    if (opts.onLog) opts.onLog(message);
    if (!opts.durationSec) return;
    const time = message.match(/(?:out_time|time)=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (time) {
      const t = +time[1] * 3600 + +time[2] * 60 + parseFloat(time[3]);
      report(0.1 + (t / opts.durationSec) * 0.88);
      return;
    }
    const rawTime = message.match(/out_time_(?:us|ms)=(\d+)/);
    if (rawTime) {
      const raw = Number(rawTime[1]);
      const t = raw > opts.durationSec * 1000 ? raw / 1_000_000 : raw / 1000;
      report(0.1 + (t / opts.durationSec) * 0.88);
    }
  };
  ff.on("progress", progressHandler);
  ff.on("log", logHandler);

  // libass filter; fontsdir lets it find our bundled fonts.
  const scaleFilter =
    opts.targetWidth && opts.targetHeight
      ? `scale=${opts.targetWidth}:${opts.targetHeight}:flags=fast_bilinear,`
      : "";
  const filter = `${scaleFilter}subtitles=${subName}:fontsdir=/fonts`;

  try {
    await ff.exec([
      "-progress",
      "pipe:1",
      "-i",
      inputName,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "fastdecode,zerolatency",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-threads",
      "0",
      "-y",
      outputName,
    ]);
  } finally {
    ff.off("progress", progressHandler);
    ff.off("log", logHandler);
  }

  opts.onPhase?.("Finalizing download…");
  opts.onProgress?.(0.99);
  const data = (await ff.readFile(outputName)) as Uint8Array;
  // Cleanup
  await ff.deleteFile(inputName).catch(() => {});
  await ff.deleteFile(outputName).catch(() => {});
  await ff.deleteFile(subName).catch(() => {});

  if (opts.onProgress) opts.onProgress(1);
  return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
}
