import type { Segment } from "./subtitles";

export type LoadProgress = {
  status: string;
  file?: string;
  progress?: number;
};

export type TranscribeProgress = (info: { stage: "uploading" | "transcribing"; progress?: number }) => void;

export async function transcribeFile(
  file: File,
  _onModelProgress?: (p: LoadProgress) => void,
  onProgress?: TranscribeProgress,
): Promise<{ text: string; segments: Segment[] }> {
  onProgress?.({ stage: "uploading" });

  const fd = new FormData();
  fd.append("file", file, file.name);

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
