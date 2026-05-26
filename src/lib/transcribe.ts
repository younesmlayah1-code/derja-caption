import type { Segment } from "./subtitles";
import { extractMonoWav } from "./audio";

export type LoadProgress = {
  status: string;
  file?: string;
  progress?: number;
};

export type TranscribeProgress = (info: {
  stage: "extracting" | "uploading" | "transcribing";
  progress?: number;
}) => void;

export async function transcribeFile(
  file: File,
  _onModelProgress?: (p: LoadProgress) => void,
  onProgress?: TranscribeProgress,
): Promise<{ text: string; segments: Segment[] }> {
  // 1) Extract clean 16kHz mono WAV in the browser. This avoids the silent
  // truncation we were seeing when sending raw video containers, and shrinks
  // the upload so long clips comfortably fit under Groq's 25MB cap.
  onProgress?.({ stage: "extracting" });
  const wav = await extractMonoWav(file, (p) => {
    onProgress?.({ stage: "extracting", progress: p.stage === "encoding" ? 0.9 : undefined });
  });

  onProgress?.({ stage: "uploading" });

  const fd = new FormData();
  fd.append("file", wav, "audio.wav");

  onProgress?.({ stage: "transcribing" });

  const res = await fetch("/api/transcribe", { method: "POST", body: fd });

  if (!res.ok) {
    let msg = `Transcription failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as { text: string; segments: Segment[] };
  return { text: data.text || "", segments: data.segments || [] };
}
