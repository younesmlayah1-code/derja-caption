import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  FileVideo,
  Loader2,
  Download,
  X,
  Youtube,
  Scissors,
  Sparkles,
  Play,
  Pause,
  RefreshCw,
  Languages,
  Lock,
  CheckCircle2,
} from "lucide-react";
import {
  toSrt,
  fmtTime,
  downloadFile,
  type Segment,
} from "@/lib/subtitles";
import { transcribeFile } from "@/lib/transcribe";
import { cutMp4Clip } from "@/lib/clip-mp4";

export const Route = createFileRoute("/beta")({
  head: () => ({
    meta: [
      { title: "Beta — AI Shorts Maker (Derja)" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BetaGate,
});

const BETA_PASSWORD = "youyou2010";
const BETA_KEY = "beta-auth-v1";

function BetaGate() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(BETA_KEY) === "1") {
      setAuthed(true);
    }
  }, []);

  if (authed) return <BetaApp />;

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw === BETA_PASSWORD) {
            sessionStorage.setItem(BETA_KEY, "1");
            setAuthed(true);
          } else {
            setErr("Wrong password.");
          }
        }}
        className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card/40 p-6 backdrop-blur"
      >
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Beta access</h1>
        </div>
        <p className="text-sm text-muted-foreground">Enter the password to continue.</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setErr(null);
          }}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {err && <p className="text-xs text-destructive-foreground">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}

type Lang = "derja-ar" | "derja-fr" | "french" | "english";

const LANG_LABELS: Record<Lang, string> = {
  "derja-ar": "Derja (Arabic)",
  "derja-fr": "Derja (Latin)",
  french: "French",
  english: "English",
};

type Clip = { start: number; end: number; title: string; reason: string };
type CutProgress = { stage: "loading" | "cutting" | "done"; pct?: number } | null;

function BetaApp() {
  // ------- Step 1: source -------
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const acceptFile = (f: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setError(null);
    // Reset downstream state
    setSegments([]);
    setTranscript("");
    setClip(null);
    setTriedRanges([]);
    setEnglishMap(new Map());
    setFrenchMap(new Map());
    setFrenchDerjaMap(new Map());
    setOverrides(new Map());
    setCutBlob(null);
  };

  const fetchYouTube = async () => {
    if (!ytUrl.trim()) return;
    setError(null);
    setYtLoading(true);
    try {
      const res = await fetch("/api/youtube-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim() }),
      });
      const j = (await res.json()) as { mp4Url?: string; filename?: string; error?: string };
      if (!res.ok || !j.mp4Url) throw new Error(j.error || `HTTP ${res.status}`);
      const proxyUrl = `/api/youtube-fetch?stream=${encodeURIComponent(j.mp4Url)}&name=${encodeURIComponent(j.filename || "youtube.mp4")}`;
      const blobRes = await fetch(proxyUrl);
      if (!blobRes.ok) throw new Error(`Download failed (${blobRes.status}).`);
      const blob = await blobRes.blob();
      const f = new File([blob], j.filename || "youtube.mp4", { type: blob.type || "video/mp4" });
      acceptFile(f);
      setYtUrl("");
    } catch (e) {
      setError((e as Error).message || "Failed to fetch YouTube video.");
    } finally {
      setYtLoading(false);
    }
  };

  // ------- Step 2: language selection -------
  const [lang, setLang] = useState<Lang>("derja-ar");

  // ------- Step 3: transcribe (full video) -------
  type Stage = "idle" | "extracting" | "uploading" | "transcribing" | "done" | "error";
  const [stage, setStage] = useState<Stage>("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);

  const runTranscribe = useCallback(async () => {
    if (!file) return;
    setError(null);
    setStage("extracting");
    try {
      const result = await transcribeFile(file, undefined, ({ stage: s, chunkIndex, chunkCount }) => {
        setStage(s);
        setProgressLabel(
          chunkCount && chunkCount > 1 && chunkIndex ? ` (part ${chunkIndex}/${chunkCount})` : "",
        );
      });
      setTranscript(result.text);
      setSegments(result.segments);
      setStage("done");
    } catch (e) {
      setError((e as Error).message || "Transcription failed.");
      setStage("error");
    }
  }, [file]);

  // ------- Step 4: AI clip suggestion + regenerate + manual -------
  const [clip, setClip] = useState<Clip | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [triedRanges, setTriedRanges] = useState<Array<{ start: number; end: number }>>([]);
  const [targetDuration, setTargetDuration] = useState<number>(90);
  const [manualMode, setManualMode] = useState(false);
  const [manualStart, setManualStart] = useState<string>("0");
  const [manualEnd, setManualEnd] = useState<string>("90");

  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  const suggestClip = async (regenerate: boolean) => {
    if (segments.length === 0) return;
    setError(null);
    setClipLoading(true);
    setCutBlob(null);
    try {
      const exclude = regenerate && clip ? [...triedRanges, { start: clip.start, end: clip.end }] : [];
      const minSec = Math.max(15, targetDuration - 10);
      const maxSec = targetDuration + 10;
      const res = await fetch("/api/suggest-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: segments.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text })),
          excludeRanges: exclude,
          minSec,
          maxSec,
        }),
      });
      const j = (await res.json()) as Partial<Clip> & { error?: string };
      if (!res.ok || j.start == null || j.end == null) throw new Error(j.error || `HTTP ${res.status}`);
      const newClip: Clip = {
        start: j.start,
        end: j.end,
        title: j.title || "Best clip",
        reason: j.reason || "",
      };
      if (regenerate && clip) setTriedRanges((prev) => [...prev, { start: clip.start, end: clip.end }]);
      setClip(newClip);
      setManualStart(newClip.start.toFixed(1));
      setManualEnd(newClip.end.toFixed(1));
    } catch (e) {
      setError((e as Error).message || "Clip suggestion failed.");
    } finally {
      setClipLoading(false);
    }
  };

  const applyManualClip = () => {
    const s = Math.max(0, Math.min(totalDuration, parseFloat(manualStart) || 0));
    const e = Math.max(s + 1, Math.min(totalDuration, parseFloat(manualEnd) || s + 1));
    setCutBlob(null);
    setClip({ start: s, end: e, title: "Manual clip", reason: "" });
  };

  // ------- Step 4b: clip preview (clamp to range) -------
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip) return;
    const onTime = () => {
      if (v.currentTime >= clip.end) {
        v.pause();
        v.currentTime = clip.start;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [clip]);

  useEffect(() => {
    if (clip && videoRef.current) {
      videoRef.current.currentTime = clip.start;
    }
  }, [clip]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !clip) return;
    if (v.paused) {
      if (v.currentTime < clip.start || v.currentTime >= clip.end) v.currentTime = clip.start;
      void v.play();
    } else {
      v.pause();
    }
  };

  // Clip-scoped segments (renumbered, relative time)
  const clipSegments = useMemo(() => {
    if (!clip) return [] as Segment[];
    return segments
      .filter((s) => s.end > clip.start && s.start < clip.end)
      .map((s, i) => ({
        id: i + 1,
        start: Math.max(0, s.start - clip.start),
        end: Math.max(0.1, Math.min(s.end, clip.end) - clip.start),
        text: s.text,
        words: s.words?.map((w) => ({
          ...w,
          start: Math.max(0, w.start - clip.start),
          end: Math.max(0.05, Math.min(w.end, clip.end) - clip.start),
        })),
      }));
  }, [segments, clip]);

  // ------- Translation maps (clip-scoped) -------
  const [englishMap, setEnglishMap] = useState<Map<string, string>>(new Map());
  const [frenchMap, setFrenchMap] = useState<Map<string, string>>(new Map()); // french translation
  const [frenchDerjaMap, setFrenchDerjaMap] = useState<Map<string, string>>(new Map()); // arabizi
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (!clip || clipSegments.length === 0) return;
    if (lang === "derja-ar") return;

    const texts = clipSegments.map((s) => s.text).filter(Boolean);
    let url = "";
    let body: Record<string, unknown> = {};
    let target: Map<string, string>;
    let setTarget: (m: Map<string, string>) => void;

    if (lang === "english") {
      target = englishMap;
      setTarget = setEnglishMap;
      url = "/api/translate-en";
      body = { mode: "line", targetLang: "english" };
    } else if (lang === "french") {
      target = frenchMap;
      setTarget = setFrenchMap;
      url = "/api/translate-en";
      body = { mode: "line", targetLang: "french" };
    } else {
      target = frenchDerjaMap;
      setTarget = setFrenchDerjaMap;
      url = "/api/transliterate";
    }

    const missing = texts.filter((t) => !target.has(t));
    if (missing.length === 0) return;

    let cancelled = false;
    setTranslating(true);
    (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, items: missing.map((t, i) => ({ id: i, text: t })) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { items?: Array<{ id: number; text: string }> };
        if (cancelled) return;
        const next = new Map(target);
        for (const it of j.items ?? []) {
          const orig = missing[it.id];
          if (orig != null && typeof it.text === "string") next.set(orig, it.text);
        }
        setTarget(next);
      } catch (e) {
        console.error("translation failed:", e);
      } finally {
        if (!cancelled) setTranslating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang, clipSegments, clip, englishMap, frenchMap, frenchDerjaMap]);

  const baseTextFor = (s: Segment): string => {
    if (lang === "derja-ar") return s.text;
    if (lang === "english") return englishMap.get(s.text) ?? s.text;
    if (lang === "french") return frenchMap.get(s.text) ?? s.text;
    return frenchDerjaMap.get(s.text) ?? s.text;
  };

  // ------- Step 5: editable transcript -------
  // Override key = `${lang}:${id}` so edits per language stay separate.
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const displayFor = (s: Segment): string => overrides.get(`${lang}:${s.id}`) ?? baseTextFor(s);

  const updateSegment = (id: number, value: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(`${lang}:${id}`, value);
      return next;
    });
  };

  // ------- Step 6: exports -------
  const isRtl = lang === "derja-ar";
  const base = file ? file.name.replace(/\.[^.]+$/, "") : "clip";

  const finalSegments = (): Segment[] =>
    clipSegments.map((s) => ({ ...s, text: displayFor(s), words: undefined }));

  const exportSrt = () => {
    const segs = finalSegments();
    downloadFile(`${base}-clip.srt`, toSrt(segs), "application/x-subrip;charset=utf-8");
  };

  // Client-side MP4 cut via ffmpeg.wasm
  const [cutBlob, setCutBlob] = useState<Blob | null>(null);
  const [cutting, setCutting] = useState<CutProgress>(null);

  const cutMp4 = async () => {
    if (!file || !clip) return;
    setError(null);
    try {
      setCutting({ stage: "loading" });
      const blob = await cutMp4Clip(file, clip.start, clip.end, (p) => setCutting(p));
      setCutBlob(blob);
      setCutting({ stage: "done", pct: 1 });
    } catch (e) {
      setError("Failed to cut MP4: " + ((e as Error).message || "unknown"));
      setCutting(null);
    }
  };

  const downloadMp4 = () => {
    if (!cutBlob) return;
    const url = URL.createObjectURL(cutBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}-clip.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null);
    setVideoUrl("");
    setSegments([]);
    setTranscript("");
    setClip(null);
    setTriedRanges([]);
    setEnglishMap(new Map());
    setFrenchMap(new Map());
    setFrenchDerjaMap(new Map());
    setOverrides(new Map());
    setStage("idle");
    setError(null);
    setCutBlob(null);
    setCutting(null);
  };

  const busy = stage === "extracting" || stage === "uploading" || stage === "transcribing";

  return (
    <main className="min-h-screen w-full px-4 py-10 md:py-16">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Beta · AI Shorts Maker
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            <span className="gradient-text">Pick. Caption. Ship.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Drop a video or paste a YouTube link. AI picks the best 1.5–3 min clip,
            transcribes it, and exports MP4 + SRT.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {/* ─── STEP 1: source ─── */}
        <Step number={1} title="Add a video" done={!!file}>
          {!file ? (
            <div className="space-y-4">
              <section
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) acceptFile(f);
                }}
                className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-card/30"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".mp4,.mov,.webm,.mp3,.wav,.m4a,video/*,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) acceptFile(f);
                  }}
                />
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">Drop your video here</p>
                <p className="mt-1 text-xs text-muted-foreground">MP4, MOV, WEBM — up to 500MB</p>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Upload Video
                </button>
              </section>

              <div className="rounded-2xl border border-border bg-card/30 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Youtube className="h-4 w-4 text-primary" />
                  Or paste a YouTube link
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    disabled={ytLoading}
                    className="flex-1 rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={fetchYouTube}
                    disabled={ytLoading || !ytUrl.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {ytLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {ytLoading ? "Fetching…" : "Fetch MP4"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <FileVideo className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              {!busy && (
                <button
                  onClick={reset}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-background/50 hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </Step>

        {/* ─── STEP 2: transcribe ─── */}
        {file && (
          <Step number={2} title="Transcribe" done={segments.length > 0}>
            {segments.length === 0 ? (
              <div className="space-y-3">
                {busy ? (
                  <div className="flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {stage === "extracting" && "Extracting audio…"}
                    {stage === "uploading" && `Uploading${progressLabel}…`}
                    {stage === "transcribing" && `Transcribing Derja${progressLabel}…`}
                  </div>
                ) : (
                  <button
                    onClick={runTranscribe}
                    className="w-full rounded-xl py-3 text-sm font-medium text-primary-foreground"
                    style={{
                      background: "var(--gradient-primary)",
                      boxShadow: "var(--shadow-glow)",
                    }}
                  >
                    Transcribe video
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {segments.length} segments · {fmtTime(segments[segments.length - 1].end)} total
              </p>
            )}
          </Step>
        )}

        {/* ─── STEP 3: AI clip ─── */}
        {segments.length > 0 && (
          <Step number={3} title="Pick the clip" done={!!clip}>
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Target duration</p>
                <div className="flex flex-wrap gap-2">
                  {[30, 60, 90, 120, 150, 180].map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setTargetDuration(d);
                        setManualEnd(((parseFloat(manualStart) || 0) + d).toFixed(1));
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        targetDuration === d
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setManualMode(false); void suggestClip(!!clip); }}
                  disabled={clipLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {clipLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : clip ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {clip ? "Try another (AI)" : "Find best clip with AI"}
                </button>
                <button
                  onClick={() => setManualMode((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-medium hover:border-primary/50"
                >
                  <Scissors className="h-4 w-4" />
                  {manualMode ? "Hide manual" : "Pick manually"}
                </button>
              </div>

              {manualMode && (
                <div className="rounded-xl border border-border bg-card/40 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Start (s)
                      <input
                        type="number"
                        min={0}
                        max={totalDuration}
                        step={0.1}
                        value={manualStart}
                        onChange={(e) => setManualStart(e.target.value)}
                        className="rounded-lg border border-border bg-background/80 px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      End (s)
                      <input
                        type="number"
                        min={0}
                        max={totalDuration}
                        step={0.1}
                        value={manualEnd}
                        onChange={(e) => setManualEnd(e.target.value)}
                        className="rounded-lg border border-border bg-background/80 px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Total: {fmtTime(totalDuration)} · Selected: {Math.max(0, (parseFloat(manualEnd) || 0) - (parseFloat(manualStart) || 0)).toFixed(1)}s
                  </p>
                  <button
                    onClick={applyManualClip}
                    className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Use this range
                  </button>
                </div>
              )}

              {clip && (
                <div className="space-y-3 pt-2">
                  <div className="overflow-hidden rounded-xl border border-border bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="block max-h-[60vh] w-full"
                      controls
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={togglePlay}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground"
                    >
                      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {playing ? "Pause" : "Play clip"}
                    </button>
                    <span className="rounded-md bg-primary/15 px-2 py-1 font-mono text-primary">
                      {fmtTime(clip.start)} → {fmtTime(clip.end)} · {Math.round(clip.end - clip.start)}s
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{clip.title}</p>
                    {clip.reason && <p className="text-xs text-muted-foreground">{clip.reason}</p>}
                  </div>
                </div>
              )}
            </div>
          </Step>
        )}


        {/* ─── STEP 4: language ─── */}
        {clip && (
          <Step number={4} title="Caption language" done={true}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                    lang === l
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Languages className="h-3.5 w-3.5" />
                  {LANG_LABELS[l]}
                </button>
              ))}
            </div>
          </Step>
        )}

        {/* ─── STEP 5: edit transcript ─── */}
        {clip && clipSegments.length > 0 && (
          <Step number={5} title="Review & edit captions">
            {translating ? (
              <div className="flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-6 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Translating to {LANG_LABELS[lang]}…
              </div>
            ) : (
              <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                {clipSegments.map((s) => {
                  const txt = displayFor(s);
                  return (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3"
                    >
                      <span className="mt-1 shrink-0 rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
                        {fmtTime(s.start)}
                      </span>
                      <textarea
                        value={txt}
                        onChange={(e) => updateSegment(s.id, e.target.value)}
                        dir={isRtl ? "rtl" : "ltr"}
                        rows={Math.min(3, Math.max(1, Math.ceil(txt.length / 60)))}
                        className={`w-full resize-y rounded-lg border border-border/70 bg-background/80 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                          isRtl ? "text-right" : "text-left"
                        }`}
                        style={
                          isRtl
                            ? { fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }
                            : undefined
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Step>
        )}

        {/* ─── STEP 6: export ─── */}
        {clip && clipSegments.length > 0 && (
          <Step number={6} title="Download">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={exportSrt}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm font-medium hover:border-primary/50 hover:bg-primary/10"
              >
                <Download className="h-4 w-4" />
                Download SRT
              </button>

              {!cutBlob ? (
                <button
                  onClick={cutMp4}
                  disabled={!!cutting && cutting.stage !== "done"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  style={{
                    background: "var(--gradient-primary)",
                    boxShadow: "var(--shadow-glow)",
                  }}
                >
                  {cutting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {cutting.stage === "loading" && "Loading encoder…"}
                      {cutting.stage === "cutting" &&
                        `Cutting${cutting.pct != null ? ` ${Math.round(cutting.pct * 100)}%` : "…"}`}
                      {cutting.stage === "done" && "Ready"}
                    </>
                  ) : (
                    <>
                      <Scissors className="h-4 w-4" />
                      Cut & Download MP4
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={downloadMp4}
                  className="inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-primary-foreground"
                  style={{
                    background: "var(--gradient-primary)",
                    boxShadow: "var(--shadow-glow)",
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download MP4 ({(cutBlob.size / 1024 / 1024).toFixed(1)} MB)
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground/70">
              MP4 cut runs in your browser (first cut downloads ~30MB encoder).
            </p>
          </Step>
        )}

        {/* dummy ref to silence unused warning for transcript */}
        <input type="hidden" value={transcript} readOnly />

        <footer className="pt-8 text-center text-xs text-muted-foreground/60">
          Beta · Whisper transcription · Lovable AI · ffmpeg.wasm
        </footer>
      </div>
    </main>
  );
}

// ────────────────────────────────────────
function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card/30 p-5 backdrop-blur md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            done ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"
          }`}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : number}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
