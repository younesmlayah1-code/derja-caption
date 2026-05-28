export type Word = { start: number; end: number; text: string };
export type Segment = { id: number; start: number; end: number; text: string; words?: Word[] };

function pad(n: number, len = 2) {
  return n.toString().padStart(len, "0");
}

function fmtSrt(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function fmtVtt(t: number) {
  return fmtSrt(t).replace(",", ".");
}

function flattenWords(segments: Segment[]): { start: number; end: number; text: string }[] {
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

export function toVtt(segments: Segment[]) {
  return (
    "WEBVTT\n\n" +
    flattenWords(segments)
      .map((s) => `${fmtVtt(s.start)} --> ${fmtVtt(s.end)}\n${s.text}\n`)
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
