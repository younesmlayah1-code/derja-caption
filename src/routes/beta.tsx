import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileVideo,
  Loader2,
  Download,
  X,
  Languages,
  Clock,
  AlignLeft,
  AlignJustify,
  Plus,
  Trash2,
  Youtube,
  Scissors,
  Sparkles,
} from "lucide-react";
import {
  toSrt,
  toVtt,
  toWordSrtFromSegments,
  toWordVttFromSegments,
  segmentToWordCues,
  fmtTime,
  downloadFile,
  type Segment,
} from "@/lib/subtitles";
import { transcribeFile, type RateInfo } from "@/lib/transcribe";

type Script = "arabic" | "french" | "english";

function splitLongSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  let nextId = 1;
  for (const s of segs) {
    const tokens = (s.text || "").split(/\s+/).filter(Boolean);
    if (tokens.length < 4) {
      out.push({ ...s, id: nextId++ });
      continue;
    }
    const mid = Math.ceil(tokens.length / 2);
    const firstText = tokens.slice(0, mid).join(" ");
    const secondText = tokens.slice(mid).join(" ");
    const words = (s.words || []).filter((w) => w.text);
    let boundary = s.start + (s.end - s.start) / 2;
    let firstWords = undefined;
    let secondWords = undefined;
    if (words.length === tokens.length) {
      boundary = words[mid].start;
      firstWords = words.slice(0, mid);
      secondWords = words.slice(mid);
    }
    out.push({ id: nextId++, start: s.start, end: boundary, text: firstText, words: firstWords });
    out.push({ id: nextId++, start: boundary, end: s.end, text: secondText, words: secondWords });
  }
  return out;
}

export const Route = createFileRoute("/beta")({
  head: () => ({
    meta: [
      { title: "Beta — Derja + YouTube + AI Clip" },
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

  if (authed) return <Home />;

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
        <div>
          <h1 className="text-xl font-semibold">Beta access</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter the password to continue.</p>
        </div>
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

const ACCEPTED = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
];
const ACCEPTED_EXT = [".mp4", ".mov", ".avi", ".webm", ".mp3", ".wav", ".m4a"];
const MAX_BYTES = 500 * 1024 * 1024;

type Status = "idle" | "extracting" | "uploading" | "transcribing" | "done" | "error";

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [exportMode, setExportMode] = useState<"word" | "line">("line");
  const [script, setScript] = useState<Script>("arabic");
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (f: File): string | null => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED.includes(f.type) && !ACCEPTED_EXT.includes(ext)) {
      return "Unsupported file type. Use MP4, MOV, WEBM, MP3, WAV or M4A.";
    }
    if (f.size > MAX_BYTES) return "File exceeds 500MB limit.";
    return null;
  };

  const handleFile = (f: File) => {
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    setTranscript("");
    setSegments([]);
    setFrenchMap(new Map());
    setFrenchOverrides(new Map());
    setEnglishMap(new Map());
    setEnglishWordMap(new Map());
    setEnglishOverrides(new Map());
    setClip(null);
    setStatus("idle");
  };

  const [progressLabel, setProgressLabel] = useState<string>("");
  const [rate, setRate] = useState<RateInfo | null>(null);

  const run = useCallback(async () => {
    if (!file) return;
    setError(null);
    setStatus("extracting");
    setProgressLabel("");

    try {
      const result = await transcribeFile(file, undefined, ({ stage, chunkIndex, chunkCount }) => {
        setStatus(stage);
        if (chunkCount && chunkCount > 1 && chunkIndex) {
          setProgressLabel(` (part ${chunkIndex}/${chunkCount})`);
        } else {
          setProgressLabel("");
        }
      });

      setTranscript(result.text);
      setSegments(splitLongSegments(result.segments));
      setFrenchMap(new Map());
      setFrenchOverrides(new Map());
      setEnglishMap(new Map());
      setEnglishWordMap(new Map());
      setEnglishOverrides(new Map());
      setClip(null);
      if (result.rate) setRate(result.rate);
      setStatus("done");
    } catch (e) {
      console.error(e);
      setError((e as Error).message || "Transcription failed.");
      setStatus("error");
    }
  }, [file]);

  const reset = () => {
    setFile(null);
    setTranscript("");
    setSegments([]);
    setFrenchMap(new Map());
    setFrenchOverrides(new Map());
    setEnglishMap(new Map());
    setEnglishWordMap(new Map());
    setEnglishOverrides(new Map());
    setClip(null);
    setStatus("idle");
    setError(null);
  };

  // ---------- French (Latin/arabizi) ----------
  const [frenchMap, setFrenchMap] = useState<Map<string, string>>(new Map());
  const [frenchOverrides, setFrenchOverrides] = useState<Map<number, string>>(new Map());
  const [translitLoading, setTranslitLoading] = useState(false);

  useEffect(() => {
    if (script !== "french" || segments.length === 0) return;
    const texts = new Set<string>();
    if (transcript) texts.add(transcript);
    for (const s of segments) {
      if (s.text) texts.add(s.text);
      for (const w of s.words ?? []) if (w.text) texts.add(w.text);
    }
    const missing = [...texts].filter((t) => !frenchMap.has(t));
    if (missing.length === 0) return;

    let cancelled = false;
    setTranslitLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/transliterate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: missing.map((t, i) => ({ id: i, text: t })) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { items?: Array<{ id: number; text: string }> };
        if (cancelled) return;
        setFrenchMap((prev) => {
          const next = new Map(prev);
          for (const it of j.items ?? []) {
            const orig = missing[it.id];
            if (orig != null && typeof it.text === "string") next.set(orig, it.text);
          }
          return next;
        });
      } catch (e) {
        console.error("transliteration failed:", e);
      } finally {
        if (!cancelled) setTranslitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [script, segments, transcript, frenchMap]);

  // ---------- English translation ----------
  // Line-level texts use full segment translation; word-level uses per-word
  // English (separate map because semantics differ).
  const [englishMap, setEnglishMap] = useState<Map<string, string>>(new Map());
  const [englishWordMap, setEnglishWordMap] = useState<Map<string, string>>(new Map());
  const [englishOverrides, setEnglishOverrides] = useState<Map<number, string>>(new Map());
  const [englishLoading, setEnglishLoading] = useState(false);

  useEffect(() => {
    if (script !== "english" || segments.length === 0) return;

    // Line items: full segment texts + full transcript.
    const lineTexts = new Set<string>();
    if (transcript) lineTexts.add(transcript);
    for (const s of segments) if (s.text) lineTexts.add(s.text);
    const missingLines = [...lineTexts].filter((t) => !englishMap.has(t));

    // Word items: only when word mode is active (avoid extra cost).
    const wordTexts = new Set<string>();
    if (exportMode === "word") {
      for (const s of segments) for (const w of s.words ?? []) if (w.text) wordTexts.add(w.text);
    }
    const missingWords = [...wordTexts].filter((t) => !englishWordMap.has(t));

    if (missingLines.length === 0 && missingWords.length === 0) return;

    let cancelled = false;
    setEnglishLoading(true);
    (async () => {
      try {
        const tasks: Promise<void>[] = [];

        if (missingLines.length > 0) {
          tasks.push(
            fetch("/api/translate-en", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "line",
                items: missingLines.map((t, i) => ({ id: i, text: t })),
              }),
            })
              .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
              .then((j: { items?: Array<{ id: number; text: string }> }) => {
                if (cancelled) return;
                setEnglishMap((prev) => {
                  const next = new Map(prev);
                  for (const it of j.items ?? []) {
                    const orig = missingLines[it.id];
                    if (orig != null && typeof it.text === "string") next.set(orig, it.text);
                  }
                  return next;
                });
              }),
          );
        }

        if (missingWords.length > 0) {
          tasks.push(
            fetch("/api/translate-en", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "word",
                items: missingWords.map((t, i) => ({ id: i, text: t })),
              }),
            })
              .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
              .then((j: { items?: Array<{ id: number; text: string }> }) => {
                if (cancelled) return;
                setEnglishWordMap((prev) => {
                  const next = new Map(prev);
                  for (const it of j.items ?? []) {
                    const orig = missingWords[it.id];
                    if (orig != null && typeof it.text === "string") next.set(orig, it.text);
                  }
                  return next;
                });
              }),
          );
        }

        await Promise.all(tasks);
      } catch (e) {
        console.error("english translation failed:", e);
      } finally {
        if (!cancelled) setEnglishLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [script, segments, transcript, exportMode, englishMap, englishWordMap]);

  const frenchOf = (t: string) => (script === "french" ? (frenchMap.get(t) ?? t) : t);
  const englishOf = (t: string) => (script === "english" ? (englishMap.get(t) ?? t) : t);
  const englishWordOf = (t: string) =>
    script === "english" ? (englishWordMap.get(t) ?? englishMap.get(t) ?? t) : t;

  const displayFor = (s: Segment) => {
    if (script === "french") return frenchOverrides.get(s.id) ?? frenchOf(s.text);
    if (script === "english") return englishOverrides.get(s.id) ?? englishOf(s.text);
    return s.text;
  };

  const updateSegmentDisplay = (id: number, value: string) => {
    if (script === "french") {
      setFrenchOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, value);
        return next;
      });
    } else if (script === "english") {
      setEnglishOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, value);
        return next;
      });
    } else {
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, text: value, words: undefined } : s)),
      );
      setFrenchOverrides((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setEnglishOverrides((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const deleteSegment = (id: number) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  const addSegmentAfter = (id: number) => {
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const cur = prev[idx];
      const nextSeg = prev[idx + 1];
      const newStart = cur.end;
      const newEnd = nextSeg ? Math.min(nextSeg.start, cur.end + 2) : cur.end + 2;
      const newId = (prev.length ? Math.max(...prev.map((p) => p.id)) : 0) + 1;
      const newSeg: Segment = { id: newId, start: newStart, end: newEnd, text: "", words: [] };
      return [...prev.slice(0, idx + 1), newSeg, ...prev.slice(idx + 1)];
    });
  };

  // Live transcript derived from current segments — reflects all edits.
  const liveTranscript =
    segments
      .map((s) => displayFor(s))
      .join(" ")
      .trim() ||
    (script === "french" ? frenchOf(transcript) : script === "english" ? englishOf(transcript) : transcript);

  const base = file ? file.name.replace(/\.[^.]+$/, "") : "transcript";

  const wordOf = (t: string) =>
    script === "french" ? frenchOf(t) : script === "english" ? englishWordOf(t) : t;

  const scriptedSegments = (): Segment[] =>
    segments.map((s) => ({
      ...s,
      text: displayFor(s),
      words: s.words?.map((w) => ({ ...w, text: wordOf(w.text) })),
    }));

  const exportTxt = () =>
    downloadFile(`${base}.txt`, liveTranscript, "text/plain;charset=utf-8");
  const exportSrt = () => {
    const segs = scriptedSegments();
    downloadFile(
      `${base}.srt`,
      segs.length && exportMode === "word" ? toWordSrtFromSegments(segs) : toSrt(segs),
      "application/x-subrip;charset=utf-8",
    );
  };
  const exportVtt = () => {
    const segs = scriptedSegments();
    downloadFile(
      `${base}.vtt`,
      segs.length && exportMode === "word" ? toWordVttFromSegments(segs) : toVtt(segs),
      "text/vtt;charset=utf-8",
    );
  };

  // ---------- YouTube fetch ----------
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  const fetchYouTube = async () => {
    if (!ytUrl.trim()) return;
    setYtError(null);
    setYtLoading(true);
    try {
      const res = await fetch("/api/youtube-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim() }),
      });
      const j = (await res.json()) as {
        mp4Url?: string;
        filename?: string;
        sizeBytes?: number;
        error?: string;
      };
      if (!res.ok || !j.mp4Url) throw new Error(j.error || `HTTP ${res.status}`);

      // Stream the MP4 through our proxy to avoid CORS, then build a File.
      const proxyUrl = `/api/youtube-fetch?stream=${encodeURIComponent(j.mp4Url)}&name=${encodeURIComponent(j.filename || "youtube.mp4")}`;
      const blobRes = await fetch(proxyUrl);
      if (!blobRes.ok) throw new Error(`Download failed (${blobRes.status}).`);
      const blob = await blobRes.blob();
      const f = new File([blob], j.filename || "youtube.mp4", {
        type: blob.type || "video/mp4",
      });
      handleFile(f);
      setYtUrl("");
    } catch (e) {
      setYtError((e as Error).message || "Failed to fetch YouTube video.");
    } finally {
      setYtLoading(false);
    }
  };

  // ---------- AI clip suggestion ----------
  const [clip, setClip] = useState<{
    start: number;
    end: number;
    title: string;
    reason: string;
  } | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  const suggestClip = async () => {
    if (segments.length === 0) return;
    setClipError(null);
    setClipLoading(true);
    try {
      const res = await fetch("/api/suggest-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: segments.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text })),
        }),
      });
      const j = (await res.json()) as {
        start?: number;
        end?: number;
        title?: string;
        reason?: string;
        error?: string;
      };
      if (!res.ok || j.start == null || j.end == null) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setClip({
        start: j.start,
        end: j.end,
        title: j.title || "Best clip",
        reason: j.reason || "",
      });
    } catch (e) {
      setClipError((e as Error).message || "Failed to get clip suggestion.");
    } finally {
      setClipLoading(false);
    }
  };

  const exportClipSrt = () => {
    if (!clip) return;
    const inRange = scriptedSegments()
      .filter((s) => s.end > clip.start && s.start < clip.end)
      .map((s, i) => ({
        ...s,
        id: i + 1,
        start: Math.max(0, s.start - clip.start),
        end: Math.max(0.1, s.end - clip.start),
        words: s.words?.map((w) => ({
          ...w,
          start: Math.max(0, w.start - clip.start),
          end: Math.max(0.05, w.end - clip.start),
        })),
      }));
    const srt = exportMode === "word" ? toWordSrtFromSegments(inRange) : toSrt(inRange);
    downloadFile(`${base}-clip.srt`, srt, "application/x-subrip;charset=utf-8");
  };

  const busy = status === "extracting" || status === "uploading" || status === "transcribing";

  return (
    <main className="min-h-screen w-full px-4 py-10 md:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Languages className="h-3.5 w-3.5 text-primary" />
            Tunisian Arabic · Derja · English
          </div>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            <span className="gradient-text">Derja Subtitle</span>
            <br />
            Extractor
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground md:text-base">
            Upload a video or paste a YouTube link. Get Derja or English captions, line- or
            word-level, and let AI pick the best 2–4 min short.
          </p>
        </header>

        {rate && rate.remainingAudioSeconds != null && (
          <div className="mx-auto mb-6 flex max-w-sm items-center justify-center gap-2 rounded-full border border-border bg-card/40 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span>
              <span className="font-medium text-foreground">
                {Math.max(0, Math.floor(rate.remainingAudioSeconds / 60))} min
              </span>
              {rate.limitAudioSeconds != null && (
                <> / {Math.floor(rate.limitAudioSeconds / 60)} min</>
              )}{" "}
              left today
              {rate.resetAudioSeconds ? ` · resets in ${rate.resetAudioSeconds}` : ""}
            </span>
          </div>
        )}

        <div className="mx-auto mb-5 max-w-sm space-y-2">
          <div className="flex items-center justify-center gap-1 rounded-xl border border-border bg-card/40 p-1 backdrop-blur">
            <button
              onClick={() => setExportMode("line")}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                exportMode === "line"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlignLeft className="h-4 w-4" />
              Line per line
            </button>
            <button
              onClick={() => setExportMode("word")}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                exportMode === "word"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlignJustify className="h-4 w-4" />
              Word by word
            </button>
          </div>
          <div className="flex items-center justify-center gap-1 rounded-xl border border-border bg-card/40 p-1 backdrop-blur">
            {(
              [
                { id: "arabic", label: "Derja · AR" },
                { id: "french", label: translitLoading && script === "french" ? "…" : "Derja · FR" },
                { id: "english", label: englishLoading && script === "english" ? "…" : "English" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setScript(opt.id)}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors md:text-sm ${
                  script === opt.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {!segments.length && (
          <>
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
                if (f) handleFile(f);
              }}
              className={`relative rounded-3xl border-2 border-dashed bg-card/30 p-8 backdrop-blur transition-all md:p-12 ${
                dragOver ? "border-primary bg-primary/5 glow" : "border-border"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".mp4,.mov,.avi,.webm,.mp3,.wav,.m4a,video/mp4,video/quicktime,video/x-msvideo,video/webm,audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              {!file ? (
                <div className="flex flex-col items-center text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <Upload className="h-7 w-7" />
                  </div>
                  <h2 className="text-lg font-semibold">Drop your video here</h2>
                  <p className="mt-1 text-sm text-muted-foreground">MP4, MOV, WEBM or audio — up to 500MB</p>
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="mt-6 rounded-xl px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
                  >
                    Upload Video
                  </button>
                  <p className="mt-4 text-xs text-muted-foreground/70">
                    Note: transcription API processes up to 25MB per file.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <FileVideo className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    {!busy && (
                      <button
                        onClick={reset}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-background/50 hover:text-foreground"
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {status === "extracting" && (
                    <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Extracting audio from video…
                    </div>
                  )}

                  {status === "uploading" && (
                    <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading audio{progressLabel}…
                    </div>
                  )}

                  {status === "transcribing" && (
                    <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Transcribing Derja audio{progressLabel}…
                    </div>
                  )}

                  {status === "idle" && (
                    <button
                      onClick={run}
                      className="mt-5 w-full rounded-xl py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
                      style={{
                        background: "var(--gradient-primary)",
                        boxShadow: "var(--shadow-glow)",
                      }}
                    >
                      Extract Subtitles
                    </button>
                  )}
                </div>
              )}
            </section>

            {!file && (
              <section className="mt-5 rounded-3xl border border-border bg-card/30 p-5 backdrop-blur md:p-6">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
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
                {ytError && (
                  <p className="mt-2 text-xs text-destructive-foreground">{ytError}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground/70">
                  Resolves the smallest MP4 with audio for transcription. Long videos may take a while.
                </p>
              </section>
            )}
          </>
        )}

        {error && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {segments.length > 0 && (
          <section className="mt-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-4 backdrop-blur">
              <div>
                <p className="text-sm font-medium">Transcript ready</p>
                <p className="text-xs text-muted-foreground">{segments.length} segments</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={reset}
                  className="rounded-xl bg-secondary px-4 py-2 text-sm hover:bg-secondary/80"
                >
                  New Video
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Full transcript</h3>
                <span className="text-xs text-muted-foreground/70">
                  Edit below in the timestamped captions
                </span>
              </div>
              {(script === "french" && translitLoading) ||
              (script === "english" && englishLoading) ? (
                <div className="flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-6 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {script === "english"
                    ? "Translating to English…"
                    : "Converting Derja to French script…"}
                </div>
              ) : (
                <p
                  dir={script === "arabic" ? "rtl" : "ltr"}
                  className={`whitespace-pre-wrap text-base leading-relaxed ${script === "arabic" ? "text-right" : "text-left"}`}
                  style={
                    script === "arabic"
                      ? { fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }
                      : undefined
                  }
                >
                  {liveTranscript}
                </p>
              )}
            </div>

            {/* AI clip suggestion */}
            <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI-picked short clip (2–4 min)
                </h3>
                <button
                  onClick={suggestClip}
                  disabled={clipLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {clipLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Scissors className="h-3.5 w-3.5" />
                  )}
                  {clip ? "Re-pick" : "Suggest best clip"}
                </button>
              </div>
              {clipError && (
                <p className="mb-2 text-xs text-destructive-foreground">{clipError}</p>
              )}
              {clip ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
                      {fmtTime(clip.start)} → {fmtTime(clip.end)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(clip.end - clip.start)}s · {clip.title}
                    </span>
                  </div>
                  {clip.reason && (
                    <p className="text-sm text-muted-foreground">{clip.reason}</p>
                  )}
                  <button
                    onClick={exportClipSrt}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs hover:border-primary/50 hover:bg-primary/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download clip SRT
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/70">
                  Lovable AI scans your transcript and picks the most engaging 2–4 minute segment.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Timestamped captions
                </h3>
                <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  Tap any line below to edit · changes save automatically
                </span>
              </div>
              {(script === "french" && translitLoading) ||
              (script === "english" && englishLoading) ? (
                <div className="flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-6 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {script === "english"
                    ? "Translating to English…"
                    : "Converting Derja to French script…"}
                </div>
              ) : (
                <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-2">
                  {segments.map((s) => {
                    const displayText = displayFor(s);
                    const isArabic = script === "arabic";
                    // For word mode in English, replace each token with its
                    // English equivalent while keeping original timing.
                    const captionWords =
                      exportMode === "word"
                        ? script === "english" && s.words && s.words.length > 0
                          ? s.words.map((w) => ({
                              start: w.start,
                              end: w.end,
                              text: englishWordOf(w.text),
                            }))
                          : segmentToWordCues({ ...s, text: displayText })
                        : [];
                    return (
                      <div key={s.id} className="group/row">
                        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3 transition-colors focus-within:border-primary/60 focus-within:bg-background/60 hover:bg-secondary/60">
                          <span className="mt-1 shrink-0 rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
                            {fmtTime(s.start)}
                          </span>
                          <div className="flex flex-1 flex-col gap-2">
                            {exportMode === "line" ? (
                              <textarea
                                value={displayText}
                                onChange={(e) => updateSegmentDisplay(s.id, e.target.value)}
                                dir={isArabic ? "rtl" : "ltr"}
                                rows={Math.min(3, Math.max(1, Math.ceil(displayText.length / 60)))}
                                className={`w-full max-w-xl resize-y rounded-lg border border-border/70 bg-background/80 px-3 py-1.5 text-sm leading-snug shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                                  isArabic ? "text-right" : "text-left"
                                }`}
                                style={
                                  isArabic
                                    ? { fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }
                                    : undefined
                                }
                              />
                            ) : (
                              <div
                                dir={isArabic ? "rtl" : "ltr"}
                                className={`flex flex-wrap gap-1.5 ${
                                  isArabic ? "justify-end" : "justify-start"
                                }`}
                                style={
                                  isArabic
                                    ? { fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }
                                    : undefined
                                }
                              >
                                {captionWords.map((w, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30"
                                  >
                                    <input
                                      type="text"
                                      value={w.text}
                                      onChange={(e) => {
                                        const tokens = displayText.split(/\s+/).filter(Boolean);
                                        tokens[i] = e.target.value;
                                        updateSegmentDisplay(s.id, tokens.join(" "));
                                      }}
                                      dir={isArabic ? "rtl" : "ltr"}
                                      size={Math.max(2, w.text.length)}
                                      className={`bg-transparent outline-none ${
                                        isArabic ? "text-right" : "text-left"
                                      }`}
                                      style={
                                        isArabic
                                          ? { fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }
                                          : undefined
                                      }
                                    />
                                    <span className="font-mono text-[10px] text-muted-foreground/70">
                                      {fmtTime(w.start)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                            <button
                              onClick={() => addSegmentAfter(s.id)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/15 hover:text-primary"
                              aria-label="Add segment below"
                              title="Add segment below"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => deleteSegment(s.id)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                              aria-label="Delete segment"
                              title="Delete segment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "TXT", fn: exportTxt },
                { label: "SRT", fn: exportSrt },
                { label: "VTT", fn: exportVtt },
              ].map((b) => (
                <button
                  key={b.label}
                  onClick={b.fn}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm font-medium backdrop-blur hover:border-primary/50 hover:bg-primary/10"
                >
                  <Download className="h-4 w-4" />
                  {b.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-xs text-muted-foreground/60">
          Built for Tunisian Derja · Whisper transcription · Lovable AI translation & clip picking
        </footer>
      </div>
    </main>
  );
}
