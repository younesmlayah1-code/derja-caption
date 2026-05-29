import { useCallback, useMemo, useRef, useState } from "react";
import { Film, Loader2, Download, Upload, X, Sparkles } from "lucide-react";
import {
  BURN_STYLES,
  type BurnStyle,
  type BurnMode,
  type BurnScript,
  buildAss,
  burnSubtitles,
  ARABIC_FONT_NAME,
  LATIN_FONT_NAME,
} from "@/lib/burn";
import type { Segment } from "@/lib/subtitles";

type Props = {
  segments: Segment[];
  mode: BurnMode;
  script: BurnScript;
  /** Optional: the original file the user uploaded for transcription.
   * If it's a video we offer to reuse it. */
  sourceFile: File | null;
};

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function isVideoFile(f: File | null): boolean {
  if (!f) return false;
  return f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(f.name);
}

export function VideoBurner({ segments, mode, script, sourceFile }: Props) {
  const [video, setVideo] = useState<File | null>(isVideoFile(sourceFile) ? sourceFile : null);
  const [style, setStyle] = useState<BurnStyle>(BURN_STYLES[0]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickVideo = (f: File) => {
    setError(null);
    if (!isVideoFile(f)) {
      setError("Please upload a video file (MP4, MOV, WEBM).");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video exceeds 500MB browser limit.");
      return;
    }
    setVideo(f);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultSize(0);
  };

  const fontName = script === "arabic" ? ARABIC_FONT_NAME : LATIN_FONT_NAME;

  const probeDimensions = useCallback((file: File): Promise<{ w: number; h: number }> => {
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
  }, []);

  const run = async () => {
    if (!video) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setPhase("Preparing FFmpeg…");
    try {
      const { w, h } = await probeDimensions(video);
      const ass = buildAss(segments, {
        style,
        mode,
        script,
        width: w,
        height: h,
        fontName,
      });
      setPhase("Burning captions into video…");
      const blob = await burnSubtitles({
        videoFile: video,
        ass,
        onProgress: (r) => setProgress(r),
      });
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setResultSize(blob.size);
      setPhase("Done");
    } catch (e) {
      console.error(e);
      setError((e as Error).message || "Failed to burn captions.");
    } finally {
      setBusy(false);
    }
  };

  const baseName = useMemo(
    () => (video ? video.name.replace(/\.[^.]+$/, "") : "video"),
    [video],
  );

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Burn captions into video</h3>
          <p className="text-xs text-muted-foreground">
            100% in your browser · up to 500MB · MP4 output
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
                if (resultUrl) URL.revokeObjectURL(resultUrl);
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
              <span>{phase}</span>
              <span className="ml-auto font-mono text-xs">
                {Math.round(progress * 100)}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/60">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.max(2, progress * 100)}%` }}
              />
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
              <p className="text-xs text-muted-foreground">
                {(resultSize / 1024 / 1024).toFixed(1)} MB · MP4
              </p>
              <a
                href={resultUrl}
                download={`${baseName}-captioned.mp4`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Download className="h-4 w-4" /> Download video
              </a>
            </div>
            <button
              onClick={() => {
                URL.revokeObjectURL(resultUrl);
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
          Tip: shorter clips (under ~3 min at 1080p) render fastest. Your video never leaves your
          device.
        </p>
      </div>
    </div>
  );
}

function StylePreview({ style, script }: { style: BurnStyle; script: BurnScript }) {
  // Convert ASS &HBBGGRR → CSS rgb
  const cssColor = (ass: string): string => {
    const m = ass.match(/&H([0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
    if (!m) return "#fff";
    const a = parseInt(m[1] || "00", 16);
    const b = parseInt(m[2], 16);
    const g = parseInt(m[3], 16);
    const r = parseInt(m[4], 16);
    const alpha = (255 - a) / 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };
  const primary = cssColor(style.primary);
  const outline = cssColor(style.outline);
  const back = cssColor(style.back);
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
