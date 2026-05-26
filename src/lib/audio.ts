// Extract audio from a video/audio file as 16kHz mono WAV chunks.
// Whisper has a 25MB upload cap; at 16kHz/16-bit/mono that's ~13 minutes.
// We chunk at 10 minutes to stay safely under the limit and to let very long
// videos transcribe end-to-end instead of getting truncated.

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 600; // 10 min per chunk -> ~19 MB WAV

export type AudioChunk = {
  blob: Blob;
  startSec: number; // offset of this chunk inside the original file
  durationSec: number;
};

export async function extractMonoWavChunks(
  file: File,
  onProgress?: (p: { stage: "decoding" | "resampling" | "encoding"; progress?: number }) => void,
): Promise<AudioChunk[]> {
  onProgress?.({ stage: "decoding" });

  const arrayBuf = await file.arrayBuffer();

  const AC: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const tmpCtx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    await tmpCtx.close().catch(() => {});
  }

  onProgress?.({ stage: "resampling" });

  // Downmix to mono at original sample rate.
  const channels = decoded.numberOfChannels;
  const inLen = decoded.length;
  const mono = new Float32Array(inLen);
  if (channels === 1) {
    mono.set(decoded.getChannelData(0));
  } else {
    for (let c = 0; c < channels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < inLen; i++) mono[i] += data[i] / channels;
    }
  }

  // Resample whole thing to 16kHz mono.
  const targetLen = Math.ceil((inLen * TARGET_SAMPLE_RATE) / decoded.sampleRate);
  const offline = new OfflineAudioContext(1, targetLen, TARGET_SAMPLE_RATE);
  const monoBuf = offline.createBuffer(1, inLen, decoded.sampleRate);
  monoBuf.copyToChannel(mono, 0);
  const src = offline.createBufferSource();
  src.buffer = monoBuf;
  src.connect(offline.destination);
  src.start(0);
  const resampled = await offline.startRendering();
  const samples = resampled.getChannelData(0);

  onProgress?.({ stage: "encoding" });

  const chunkSamples = CHUNK_SECONDS * TARGET_SAMPLE_RATE;
  const chunks: AudioChunk[] = [];
  for (let i = 0; i < samples.length; i += chunkSamples) {
    const slice = samples.subarray(i, Math.min(i + chunkSamples, samples.length));
    chunks.push({
      blob: encodeWav(slice, TARGET_SAMPLE_RATE),
      startSec: i / TARGET_SAMPLE_RATE,
      durationSec: slice.length / TARGET_SAMPLE_RATE,
    });
  }
  return chunks;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
