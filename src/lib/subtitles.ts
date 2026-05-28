export type Word = { start: number; end: number; text: string };
export type Segment = { id: number; start: number; end: number; text: string; words?: Word[] };

function pad(n: number, len = 2) {
  return n.toString().padStart(len, "0");
}

function fmtSrt(t: number) {
  const totalMs = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function fmtVtt(t: number) {
  return fmtSrt(t).replace(",", ".");
}

function flattenWords(segments: Segment[], words?: Word[]): Word[] {
  if (words && words.length > 0) {
    return words.filter((w) => w.text).sort((a, b) => a.start - b.start);
  }
  const out: { start: number; end: number; text: string }[] = [];
  for (const s of segments) {
    if (s.words && s.words.length > 0) {
      for (const w of s.words) {
        if (w.text) out.push({ start: w.start, end: w.end, text: w.text });
      }
    } else if (s.text) {
      out.push({ start: s.start, end: s.end, text: s.text });
    }
  }
  return out;
}

export function toSrt(segments: Segment[]) {
  return flattenWords(segments)
    .map((s, i) => `${i + 1}\n${fmtSrt(s.start)} --> ${fmtSrt(s.end)}\n${s.text}\n`)
    .join("\n");
}

export function toWordSrt(words: Word[]) {
  return flattenWords([], words)
    .map((w, i) => `${i + 1}\n${fmtSrt(w.start)} --> ${fmtSrt(w.end)}\n${w.text}\n`)
    .join("\n");
}

// Build word-level cues using the (polished) segment TEXT, not raw Whisper
// words. This guarantees the SRT wording matches the on-screen transcript.
// Timings come from segment.words when token counts line up; otherwise we
// distribute evenly across the segment duration.
function segmentToWordCues(seg: Segment): Word[] {
  const tokens = (seg.text || "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const srcWords = (seg.words || []).filter((w) => w.text);

  if (srcWords.length === tokens.length) {
    return tokens.map((t, i) => ({ start: srcWords[i].start, end: srcWords[i].end, text: t }));
  }

  const dur = Math.max(0.001, seg.end - seg.start);
  const step = dur / tokens.length;
  return tokens.map((t, i) => ({
    start: seg.start + step * i,
    end: seg.start + step * (i + 1),
    text: t,
  }));
}

export function toWordSrtFromSegments(segments: Segment[]) {
  const cues = segments.flatMap(segmentToWordCues);
  return cues
    .map((w, i) => `${i + 1}\n${fmtSrt(w.start)} --> ${fmtSrt(w.end)}\n${w.text}\n`)
    .join("\n");
}

export function toWordVttFromSegments(segments: Segment[]) {
  const cues = segments.flatMap(segmentToWordCues);
  return (
    "WEBVTT\n\n" +
    cues.map((w) => `${fmtVtt(w.start)} --> ${fmtVtt(w.end)}\n${w.text}\n`).join("\n")
  );
}

export function toVtt(segments: Segment[]) {
  return (
    "WEBVTT\n\n" +
    flattenWords(segments)
      .map((s) => `${fmtVtt(s.start)} --> ${fmtVtt(s.end)}\n${s.text}\n`)
      .join("\n")
  );
}

export function toWordVtt(words: Word[]) {
  return (
    "WEBVTT\n\n" +
    flattenWords([], words)
      .map((w) => `${fmtVtt(w.start)} --> ${fmtVtt(w.end)}\n${w.text}\n`)
      .join("\n")
  );
}

export function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${pad(m)}:${pad(s)}`;
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
