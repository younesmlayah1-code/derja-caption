export type Word = { start: number; end: number; text: string };
export type Segment = { id: number; start: number; end: number; text: string; words?: Word[] };

// ---------- Derja Arabic → Latin (French-style) transliteration ----------
// Approximate "arabizi" used by Tunisians in chat: 5=خ, 3=ع, 7=ح, 9=ق.
// Not perfect (Arabic script omits short vowels) but produces readable Derja
// like "nekhdem", "maryoul", "ya3tik essa77a".
const AR_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const LETTER_MAP: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ى": "a",
  "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "7", "خ": "5",
  "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "ch",
  "ص": "s", "ض": "dh", "ط": "t", "ظ": "dh",
  "ع": "3", "غ": "gh", "ف": "f", "ق": "9", "ك": "k",
  "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a",
  "و": "w", "ي": "y", "ؤ": "'", "ئ": "'", "ء": "'",
  "گ": "g", "ڨ": "g", "ڭ": "g", "پ": "p", "ڤ": "v", "چ": "tch",
};
const VOWELS = new Set(["a", "e", "i", "o", "u", "ou"]);

function transliterateWord(w: string): string {
  // Keep already-Latin words (English/French) untouched.
  if (!/[\u0600-\u06FF]/.test(w)) return w;
  const cleaned = w.replace(AR_DIACRITICS, "");
  const chars = [...cleaned];
  const mapped: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    let m = LETTER_MAP[c];
    if (m == null) {
      // Keep punctuation / unknown chars as-is.
      mapped.push(c);
      continue;
    }
    // Context tweaks for semivowels: و/ي act as long vowels when not initial.
    if (c === "و" && i > 0) m = "ou";
    else if (c === "ي" && i > 0 && i < chars.length - 1) m = "i";
    mapped.push(m);
  }
  // Insert epenthetic "e" between adjacent consonants for readability.
  const out: string[] = [];
  for (let i = 0; i < mapped.length; i++) {
    const cur = mapped[i];
    out.push(cur);
    const next = mapped[i + 1];
    if (!next) continue;
    const curIsVowel = VOWELS.has(cur);
    const nextIsVowel = VOWELS.has(next);
    const prevWasE = out[out.length - 2] === "e";
    if (!curIsVowel && !nextIsVowel && !prevWasE) out.push("e");
  }
  return out.join("");
}

export function transliterateDerja(text: string): string {
  return text
    .split(/(\s+)/)
    .map((seg) => (/^\s+$/.test(seg) ? seg : transliterateWord(seg)))
    .join("");
}

export function applyScript(text: string, script: "arabic" | "french"): string {
  return script === "french" ? transliterateDerja(text) : text;
}

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
  return segments
    .filter((s) => (s.text || "").trim().length > 0)
    .map(
      (s, i) =>
        `${i + 1}\n${fmtSrt(s.start)} --> ${fmtSrt(s.end)}\n${s.text.trim()}\n`,
    )
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
export function segmentToWordCues(seg: Segment): Word[] {
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
    segments
      .filter((s) => (s.text || "").trim().length > 0)
      .map((s) => `${fmtVtt(s.start)} --> ${fmtVtt(s.end)}\n${s.text.trim()}\n`)
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
