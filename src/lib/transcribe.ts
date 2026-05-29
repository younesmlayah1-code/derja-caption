import type { Segment, Word } from "./subtitles";
import { extractMonoWavChunks, type AudioChunk } from "./audio";

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

export type RateInfo = {
  limitAudioSeconds: number | null;
  remainingAudioSeconds: number | null;
  resetAudioSeconds: string | null;
  limitRequests: number | null;
  remainingRequests: number | null;
};

type ChunkResult = {
  text: string;
  segments: Segment[];
  words: Word[];
  rate: RateInfo | null;
};

const CONCURRENCY = 3;

async function transcribeChunk(chunk: AudioChunk, idx: number, language?: string): Promise<ChunkResult> {
  const fd = new FormData();
  fd.append("file", chunk.blob, `audio_${idx}.wav`);
  if (language) fd.append("language", language);

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

  const data = (await res.json()) as {
    text: string;
    segments: Segment[];
    words?: Word[];
    rate?: RateInfo;
  };

  const offset = chunk.startSec;
  const words: Word[] = (data.words || []).map((w) => ({
    start: w.start + offset,
    end: w.end + offset,
    text: w.text,
  }));
  const segments: Segment[] = (data.segments || []).map((s) => ({
    id: s.id,
    start: s.start + offset,
    end: s.end + offset,
    text: s.text,
    words: s.words?.map((w) => ({
      start: w.start + offset,
      end: w.end + offset,
      text: w.text,
    })),
  }));

  return { text: (data.text || "").trim(), segments, words, rate: data.rate ?? null };
}

export async function transcribeFile(
  file: File,
  _onModelProgress?: (p: LoadProgress) => void,
  onProgress?: TranscribeProgress,
  language?: string,
): Promise<{ text: string; segments: Segment[]; words: Word[]; rate: RateInfo | null }> {
  onProgress?.({ stage: "extracting" });
  const chunks = await extractMonoWavChunks(file);
  const total = chunks.length;

  onProgress?.({ stage: "uploading", chunkIndex: 1, chunkCount: total });

  // Run chunks in parallel with bounded concurrency. Order-preserving via index.
  const results: ChunkResult[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      onProgress?.({ stage: "transcribing", chunkIndex: i + 1, chunkCount: total });
      results[i] = await transcribeChunk(chunks[i], i, language);
      completed++;
      onProgress?.({ stage: "transcribing", chunkIndex: completed, chunkCount: total });
    }
  }

  const workerCount = Math.min(CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Stitch in chunk order, re-assigning monotonic segment ids.
  const allSegments: Segment[] = [];
  const allWords: Word[] = [];
  const textParts: string[] = [];
  let segId = 0;
  let lastRate: RateInfo | null = null;

  for (const r of results) {
    if (r.text) textParts.push(r.text);
    if (r.rate) lastRate = r.rate;
    for (const w of r.words) allWords.push(w);
    for (const s of r.segments) allSegments.push({ ...s, id: segId++ });
  }

  return { text: textParts.join(" "), segments: allSegments, words: allWords, rate: lastRate };
}
