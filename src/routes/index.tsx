import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Upload, FileVideo, Loader2, Download, X, Languages } from "lucide-react";
import { toSrt, toVtt, fmtTime, downloadFile, type Segment } from "@/lib/subtitles";
import { transcribeFile, type LoadProgress } from "@/lib/transcribe";

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

const ACCEPTED = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "audio/mpeg", "audio/wav", "audio/mp4"];
const ACCEPTED_EXT = [".mp4", ".mov", ".avi", ".webm", ".mp3", ".wav", ".m4a"];
const MAX_BYTES = 500 * 1024 * 1024;

type Status = "idle" | "loading-model" | "decoding" | "transcribing" | "done" | "error";

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [dragOver, setDragOver] = useState(false);
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

  const run = useCallback(async () => {
    if (!file) return;
    setError(null);
    setModelProgress(0);
    setStatus("loading-model");
    setModelStatus("Loading Whisper model…");

    try {
      const onModel = (p: LoadProgress) => {
        if (p.status === "progress" && typeof p.progress === "number") {
          setModelProgress(Math.round(p.progress));
          setModelStatus(`Downloading model${p.file ? ` · ${p.file.split("/").pop()}` : ""}`);
        } else if (p.status === "ready" || p.status === "done") {
          setModelProgress(100);
        } else if (p.status === "initiate" || p.status === "download") {
          setModelStatus("Fetching model files…");
        }
      };

      const result = await transcribeFile(file, onModel, ({ stage }) => {
        if (stage === "decoding") setStatus("decoding");
        else setStatus("transcribing");
      });

      setTranscript(result.text);
      setSegments(result.segments);
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
    setModelProgress(0);
    setError(null);
  };

  const base = file ? file.name.replace(/\.[^.]+$/, "") : "transcript";

  const exportTxt = () => downloadFile(`${base}.txt`, transcript, "text/plain;charset=utf-8");
  const exportSrt = () =>
    downloadFile(`${base}.srt`, toSrt(segments), "application/x-subrip;charset=utf-8");
  const exportVtt = () =>
    downloadFile(`${base}.vtt`, toVtt(segments), "text/vtt;charset=utf-8");

  const busy = status === "loading-model" || status === "decoding" || status === "transcribing";

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

        {!segments.length && (
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
                <p className="mt-1 text-sm text-muted-foreground">
                  MP4, MOV or AVI — up to 500MB
                </p>
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

                {status === "loading-model" && (
                  <div className="mt-5">
                    <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                      <span>{modelStatus || "Loading model…"}</span>
                      <span>{modelProgress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${modelProgress}%`, background: "var(--gradient-primary)" }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      First run downloads ~250MB. Cached afterwards.
                    </p>
                  </div>
                )}

                {status === "decoding" && (
                  <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Extracting audio…
                  </div>
                )}

                {status === "transcribing" && (
                  <div className="mt-5 flex items-center justify-center gap-3 rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transcribing Derja audio locally…
                  </div>
                )}

                {status === "idle" && (
                  <button
                    onClick={run}
                    className="mt-5 w-full rounded-xl py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
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
                {segments.map((s) => (
                  <div
                    key={s.id}
                    className="flex gap-3 rounded-xl bg-secondary/40 p-3 transition-colors hover:bg-secondary/70"
                  >
                    <span className="shrink-0 rounded-md bg-primary/15 px-2 py-1 font-mono text-xs text-primary">
                      {fmtTime(s.start)}
                    </span>
                    <p
                      dir="rtl"
                      className="flex-1 text-right text-sm leading-relaxed"
                      style={{ fontFamily: "'Noto Naskh Arabic', system-ui, sans-serif" }}
                    >
                      {s.text}
                    </p>
                  </div>
                ))}
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
