import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
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
} from "lucide-react";
import {
  toSrt,
  toVtt,
  toWordSrtFromSegments,
  toWordVttFromSegments,
  segmentToWordCues,
  applyScript,
  fmtTime,
  downloadFile,
  type Segment,
} from "@/lib/subtitles";
import { transcribeFile, type RateInfo } from "@/lib/transcribe";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Derja Subtitle Extractor — Tunisian Arabic captions from video" },
      {
        name: "description",
        content:
          "Upload a video and instantly extract Tunisian Arabic (Derja) subtitles, fully in your browser. Export to TXT, SRT, or VTT.",
      },
    ],
  }),
  component: Home,
});

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
  const [exportMode, setExportMode] = useState<"word" | "line">("word");
  const [script, setScript] = useState<"arabic" | "french">("arabic");
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
      setSegments(result.segments);
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
    setStatus("idle");
    setError(null);
  };

  const base = file ? file.name.replace(/\.[^.]+$/, "") : "transcript";

  const scriptedSegments = (): Segment[] =>
    segments.map((s) => ({
      ...s,
      text: applyScript(s.text, script),
      words: s.words?.map((w) => ({ ...w, text: applyScript(w.text, script) })),
    }));

  const exportTxt = () =>
    downloadFile(`${base}.txt`, applyScript(transcript, script), "text/plain;charset=utf-8");
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

  const busy = status === "extracting" || status === "uploading" || status === "transcribing";

  return (
    <main className="min-h-screen w-full px-4 py-10 md:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Languages className="h-3.5 w-3.5 text-primary" />
            Tunisian Arabic · Derja
          </div>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            <span className="gradient-text">Derja Subtitle</span>
            <br />
            Extractor
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground md:text-base">
            Upload a video and get accurate Tunisian Arabic subtitles with timestamps in seconds.
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

        {!segments.length && (
          <div className="mx-auto mb-5 flex max-w-sm items-center justify-center gap-1 rounded-xl border border-border bg-card/40 p-1 backdrop-blur">
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
        {!segments.length && (
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
              <button
                onClick={() => setScript("arabic")}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  script === "arabic"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Derja · Arabic
              </button>
              <button
                onClick={() => setScript("french")}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  script === "french"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Derja · French
              </button>
            </div>
          </div>
        )}
            className={`relative rounded-3xl border-2 border-dashed bg-card/30 p-8 backdrop-blur transition-all md:p-12 ${
              dragOver ? "border-primary bg-primary/5 glow" : "border-border"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo"
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
                <p className="mt-1 text-sm text-muted-foreground">MP4, MOV or AVI — up to 500MB</p>
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
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Full transcript</h3>
              <p
                dir="rtl"
                className="whitespace-pre-wrap text-right text-base leading-relaxed"
                style={{ fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }}
              >
                {transcript}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur">
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                Timestamped captions
              </h3>
              <div className="max-h-96 space-y-2 overflow-y-auto pr-2">
                {segments.map((s) => {
                  const captionWords = exportMode === "word" ? segmentToWordCues(s) : [];
                  return (
                    <div
                      key={s.id}
                      className="flex gap-3 rounded-xl bg-secondary/40 p-3 transition-colors hover:bg-secondary/70"
                    >
                      <span className="shrink-0 rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
                        {fmtTime(s.start)}
                      </span>
                      <div
                        dir="rtl"
                        className="flex flex-1 flex-wrap justify-end gap-1.5 text-right text-sm leading-relaxed"
                        style={{ fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }}
                      >
                        {captionWords.length > 0 ? (
                          captionWords.map((w, i) => (
                            <span
                              key={i}
                              title={`${fmtTime(w.start)} – ${fmtTime(w.end)}`}
                              className="group inline-flex flex-col items-center rounded-md px-1.5 py-0.5 hover:bg-primary/15"
                            >
                              <span>{w.text}</span>
                              <span className="font-mono text-[10px] text-muted-foreground/70">
                                {fmtTime(w.start)}
                              </span>
                            </span>
                          ))
                        ) : (
                          <span>{s.text}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
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
          100% local · Whisper runs in your browser · Built for Tunisian Derja
        </footer>
      </div>
    </main>
  );
}
