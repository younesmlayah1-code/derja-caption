import type { Segment } from "./subtitles";
import { extractMonoWavChunks } from "./audio";

export type LoadProgress = {
  status: string;
  file?: string;
  progress?: number;
};

export type TranscribeProgress = (info: {
  stage: "extracting" | "uploading" | "transcribing";
  progress?: number;
  chunkIndex?: number;
  chunkCount?: number;
}) => void;

export async function transcribeFile(
  file: File,
  _onModelProgress?: (p: LoadProgress) => void,
  onProgress?: TranscribeProgress,
): Promise<{ text: string; segments: Segment[] }> {
  onProgress?.({ stage: "extracting" });
  const chunks = await extractMonoWavChunks(file);

  const allSegments: Segment[] = [];
  const textParts: string[] = [];
  let segId = 0;
  let priorText = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    onProgress?.({ stage: "uploading", chunkIndex: i + 1, chunkCount: chunks.length });

    const fd = new FormData();
    fd.append("file", chunk.blob, `audio_${i}.wav`);
    // Pass the tail of the prior chunk's text as context so Whisper keeps
    // consistent Derja spelling and vocabulary across chunk boundaries.
    if (priorText) fd.append("context", priorText.slice(-400));

    onProgress?.({ stage: "transcribing", chunkIndex: i + 1, chunkCount: chunks.length });

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
    const text = (data.text || "").trim();
    if (text) textParts.push(text);
    priorText = text;

    for (const s of data.segments || []) {
      allSegments.push({
        id: segId++,
        start: s.start + chunk.startSec,
        end: s.end + chunk.startSec,
        text: s.text,
      });
    }
  }

  return { text: textParts.join(" "), segments: allSegments };
}
