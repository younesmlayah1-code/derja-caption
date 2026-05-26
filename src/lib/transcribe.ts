import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { Segment } from "./subtitles";

// Use the Hugging Face CDN for model files (no local model hosting needed).
env.allowLocalModels = false;

const MODEL_ID = "Xenova/whisper-tiny";

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

export type LoadProgress = {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

export function getModel(onProgress?: (p: LoadProgress) => void) {
  if (!asrPromise) {
    asrPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      // whisper-tiny is small enough that fp32 is fast and avoids ORT quantization bugs.
      dtype: "fp32",
      device: "wasm",
      progress_callback: onProgress as never,
    } as never) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return asrPromise;
}

// Decode any browser-supported media file to a 16 kHz mono Float32Array.
export async function fileToMono16k(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ACtx: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const tmpCtx = new ACtx();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(buf.slice(0));
  } finally {
    tmpCtx.close();
  }

  const targetRate = 16000;
  const duration = decoded.duration;
  const offline = new OfflineAudioContext(1, Math.ceil(duration * targetRate), targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export type TranscribeProgress = (info: { stage: "decoding" | "transcribing"; progress?: number }) => void;

export async function transcribeFile(
  file: File,
  onModelProgress?: (p: LoadProgress) => void,
  onProgress?: TranscribeProgress,
): Promise<{ text: string; segments: Segment[] }> {
  const asr = await getModel(onModelProgress);

  onProgress?.({ stage: "decoding" });
  const audio = await fileToMono16k(file);

  onProgress?.({ stage: "transcribing" });
  const output = (await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    language: "arabic",
    task: "transcribe",
  } as never)) as { text: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> };

  const chunks = output.chunks ?? [];
  const segments: Segment[] = chunks.map((c, i) => {
    const start = c.timestamp[0] ?? 0;
    const end = c.timestamp[1] ?? start + 2;
    return { id: i, start, end, text: c.text.trim() };
  });

  return { text: (output.text || "").trim(), segments };
}
