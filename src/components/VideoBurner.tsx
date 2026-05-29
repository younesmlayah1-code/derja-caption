import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Loader2, Download, Upload, X, Sparkles, Clock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  BURN_STYLES,
  type BurnStyle,
  type BurnMode,
  type BurnScript,
} from "@/lib/burn";
import {
  createShotstackUpload,
  getShotstackSource,
  submitShotstackRender,
  getShotstackRender,
} from "@/lib/shotstack.functions";
import { segmentToWordCues, type Segment } from "@/lib/subtitles";

type Props = {
  segments: Segment[];
  mode: BurnMode;
  script: BurnScript;
  /** Optional original file user uploaded for transcription (reused if it's a video). */
  sourceFile: File | null;
};

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function isVideoFile(f: File | null): boolean {
  if (!f) return false;
  return f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(f.name);
}

// ASS &HAABBGGRR → CSS color
function assToCss(ass: string): string {
  const m = ass.match(/&H([0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
  if (!m) return "#ffffff";
  const a = parseInt(m[1] || "00", 16);
  const b = parseInt(m[2], 16);
  const g = parseInt(m[3], 16);
  const r = parseInt(m[4], 16);
  const alpha = (255 - a) / 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

function buildShotstackStyle(style: BurnStyle, script: BurnScript) {
  const isBox = style.borderStyle === 3;
  return {
    id: style.id,
    fontSize: Math.round(style.fontSize * 0.85),
    color: assToCss(style.primary),
    outline: assToCss(style.outline),
    background: isBox ? assToCss(style.back) : "transparent",
    bold: style.bold === 1,
    rtl: script === "arabic",
  };
}

function buildClips(segments: Segment[], mode: BurnMode): { start: number; length: number; text: string }[] {
  const out: { start: number; length: number; text: string }[] = [];
  if (mode === "word") {
    for (const s of segments) {
      const cues = segmentToWordCues(s);
      for (const c of cues) {
        const t = (c.text || "").trim();
        if (!t) continue;
        out.push({ start: c.start, length: Math.max(0.1, c.end - c.start), text: t });
      }
    }
  } else {
    for (const s of segments) {
      const t = (s.text || "").trim();
      if (!t) continue;
      out.push({ start: s.start, length: Math.max(0.3, s.end - s.start), text: t });
    }
  }
  return out;
}

function probeVideoMeta(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      const w = v.videoWidth || 1080;
      const h = v.videoHeight || 1920;
      URL.revokeObjectURL(v.src);
      resolve({ w, h });
    };
    v.onerror = () => {
      URL.revokeObjectURL(v.src);
      resolve({ w: 1080, h: 1920 });
    };
  });
}

function uploadWithProgress(url: string, file: File, onProgress: (r: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function VideoBurner({ segments, mode, script, sourceFile }: Props) {
  const [video, setVideo] = useState<File | null>(isVideoFile(sourceFile) ? sourceFile : null);
  const [style, setStyle] = useState<BurnStyle>(BURN_STYLES[0]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const createUpload = useServerFn(createShotstackUpload);
  const sourceStatus = useServerFn(getShotstackSource);
  const submitRender = useServerFn(submitShotstackRender);
  const renderStatus = useServerFn(getShotstackRender);

  useEffect(() => {
    if (!busy) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [busy]);

  const pickVideo = (f: File) => {
    setError(null);
    if (!isVideoFile(f)) {
      setError("Please upload a video file (MP4, MOV, WEBM).");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video exceeds 500MB limit.");
      return;
    }
    setVideo(f);
    setResultUrl(null);
  };

  const run = useCallback(async () => {
    if (!video) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setResultUrl(null);

    try {
      setPhase("Preparing upload…");
      const { w, h } = await probeVideoMeta(video);
      const { uploadUrl, sourceId } = await createUpload();

      setPhase("Uploading video to render service…");
      await uploadWithProgress(uploadUrl, video, (r) => setProgress(0.05 + r * 0.35));

      setPhase("Ingesting video…");
      let sourceUrl: string | null = null;
      for (let i = 0; i < 120; i++) {
        await sleep(2000);
        const s = await sourceStatus({ data: { sourceId } });
        if (s.status === "ready" && s.sourceUrl) {
          sourceUrl = s.sourceUrl;
          break;
        }
        if (s.status === "failed") throw new Error(s.error || "Ingest failed");
        setProgress(0.4 + Math.min(0.1, i * 0.005));
      }
      if (!sourceUrl) throw new Error("Ingest timed out.");

      setPhase("Submitting render job…");
      setProgress(0.55);
      const clips = buildClips(segments, mode);
      if (clips.length === 0) throw new Error("No caption segments to render.");
      const { renderId } = await submitRender({
        data: {
          sourceUrl,
          width: w,
          height: h,
          clips,
          style: buildShotstackStyle(style, script),
        },
      });

      setPhase("Rendering captions into video…");
      let finalUrl: string | null = null;
      for (let i = 0; i < 300; i++) {
        await sleep(2500);
        const r = await renderStatus({ data: { renderId } });
        if (r.status === "done" && r.url) {
          finalUrl = r.url;
          break;
        }
        if (r.status === "failed") throw new Error(r.error || "Render failed");
        // status: queued | fetching | rendering | saving | done
        const stageMap: Record<string, number> = {
          queued: 0.6,
          fetching: 0.65,
          rendering: 0.75,
          saving: 0.95,
        };
        setProgress(Math.max(progress, stageMap[r.status] ?? 0.7));
        setPhase(`Rendering · ${r.status}…`);
      }
      if (!finalUrl) throw new Error("Render timed out.");

      setProgress(1);
      setPhase("Done");
      setResultUrl(finalUrl);
    } catch (e) {
      console.error(e);
      setError((e as Error).message || "Render failed.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, segments, mode, style, script]);

  const baseName = useMemo(() => (video ? video.name.replace(/\.[^.]+$/, "") : "video"), [video]);

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Burn captions into video</h3>
          <p className="text-xs text-muted-foreground">
            Cloud render · up to 500MB · MP4 output
          </p>
        </div>
      </div>

      {/* Video source */}
      {!video ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) pickVideo(f);
          }}
          className="flex flex-col items-center rounded-xl border-2 border-dashed border-border bg-background/40 p-6 text-center"
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickVideo(f);
            }}
          />
          <Film className="mb-2 h-6 w-6 text-primary" />
          <p className="text-sm font-medium">Add the video to burn into</p>
          <p className="mt-1 text-xs text-muted-foreground">MP4, MOV, WEBM · up to 500MB</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Upload className="h-4 w-4" /> Choose video
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-secondary/60 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Film className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{video.name}</p>
            <p className="text-xs text-muted-foreground">
              {(video.size / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
          {!busy && (
            <button
              onClick={() => {
                setVideo(null);
                setResultUrl(null);
              }}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-background/50 hover:text-foreground"
              aria-label="Remove video"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Style picker */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Style
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BURN_STYLES.map((s) => {
            const active = s.id === style.id;
            return (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => setStyle(s)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background/40 hover:border-primary/40"
                }`}
              >
                <StylePreview style={s} script={script} />
                <p className="mt-2 text-sm font-medium">{s.name}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{s.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 space-y-3">
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {busy && (
          <div className="rounded-lg bg-primary/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="truncate">{phase}</span>
              <span className="ml-auto font-mono text-xs">{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/60">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.max(2, progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-primary/80">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {fmtTime(elapsed)} elapsed
              </span>
              <span>
                {progress > 0.15
                  ? `~${fmtTime(Math.max(1, Math.round(elapsed / progress - elapsed)))} left`
                  : "estimating…"}
              </span>
            </div>
          </div>
        )}

        {!busy && !resultUrl && (
          <button
            onClick={run}
            disabled={!video || segments.length === 0}
            className="w-full rounded-xl py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            style={{
              background: "var(--gradient-primary)",
              boxShadow: "var(--shadow-glow)",
            }}
          >
            Burn captions into video
          </button>
        )}

        {resultUrl && (
          <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <video
              src={resultUrl}
              controls
              className="w-full rounded-lg bg-black"
              style={{ maxHeight: 400 }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">MP4 · cloud rendered</p>
              <a
                href={resultUrl}
                download={`${baseName}-captioned.mp4`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Download className="h-4 w-4" /> Download video
              </a>
            </div>
            <button
              onClick={() => {
                setResultUrl(null);
                setProgress(0);
              }}
              className="w-full rounded-lg bg-secondary px-3 py-2 text-xs hover:bg-secondary/80"
            >
              Render another style
            </button>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          Tip: shorter clips render faster. Files are uploaded securely to the render service and
          deleted after processing.
        </p>
      </div>
    </div>
  );
}

function StylePreview({ style, script }: { style: BurnStyle; script: BurnScript }) {
  const primary = assToCss(style.primary);
  const outline = assToCss(style.outline);
  const back = assToCss(style.back);
  const sample = script === "arabic" ? "نص تجريبي" : "sample text";

  const isBox = style.borderStyle === 3;
  const textShadow = isBox
    ? "none"
    : `0 0 ${style.shadow}px ${outline}, -1px -1px 0 ${outline}, 1px -1px 0 ${outline}, -1px 1px 0 ${outline}, 1px 1px 0 ${outline}`;

  return (
    <div className="flex h-14 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900">
      <span
        dir={script === "arabic" ? "rtl" : "ltr"}
        style={{
          color: primary,
          fontWeight: style.bold ? 800 : 500,
          fontSize: 14,
          textShadow,
          background: isBox ? back : "transparent",
          padding: isBox ? "2px 6px" : 0,
          borderRadius: isBox ? 3 : 0,
        }}
      >
        {sample}
      </span>
    </div>
  );
}
