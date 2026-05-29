import { createFileRoute } from "@tanstack/react-router";
import { geminiChat } from "@/lib/gemini.server";
import { Buffer } from "buffer";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "GROQ_API_KEY is not configured on the server." },
            { status: 500 },
          );
        }

        let incoming: FormData;
        try {
          incoming = await request.formData();
        } catch {
          return Response.json(
            { error: "Expected multipart/form-data with a 'file' field." },
            { status: 400 },
          );
        }

        const file = incoming.get("file");
        if (!(file instanceof File)) {
          return Response.json({ error: "Missing 'file' upload." }, { status: 400 });
        }

        const MAX = 25 * 1024 * 1024;
        if (file.size > MAX) {
          return Response.json(
            { error: `File chunk is ${(file.size / 1024 / 1024).toFixed(1)}MB. Limit is 25MB.` },
            { status: 413 },
          );
        }

        // Derja-biased prompt: keep Tunisian Arabic as Derja, but preserve
        // code-switched French/English words in Latin letters instead of
        // forcing everything into Arabic script.
        const derjaPrompt =
          "فرّغ الكلام باللهجة التونسية الدارجة كما هو، لا تحوّله للفصحى. " +
          "الكلام العربي/الدارجة اكتبه بالحروف العربية، لكن أي كلمة فرنسية أو إنجليزية منطوقة اكتبها بلغتها الأصلية وبحروف Latin، لا تكتبها بحروف عربية. " +
          "أمثلة فرنسي/إنجليزي لازم تبقى Latin: produit, montage, business, marketing, problème, service, réseau, rendez-vous, téléphone, ordinateur, boutique, email, wifi, download, link. " +
          "أمثلة كلمات دارجة تبقى عربية: برشا، ياسر، شنوة، علاش، كيفاش، وقتاش، باهي، موش، ماكش، توا، يعيشك، زادا، خاطر، نحب، نجم، نمشي، نشوف، نحكي، فما، أما، إيا.";

        const upstream = new FormData();
        upstream.append("file", file, file.name || "audio.wav");
        upstream.append("model", "whisper-large-v3");
        upstream.append("response_format", "verbose_json");
        upstream.append("timestamp_granularities[]", "segment");
        upstream.append("timestamp_granularities[]", "word");
        upstream.append("temperature", "0");
        upstream.append("prompt", derjaPrompt);

        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: upstream,
        });

        if (!res.ok) {
          const text = await res.text();
          return Response.json(
            { error: `Groq API error (${res.status}): ${text.slice(0, 500)}` },
            { status: 502 },
          );
        }

        const data = (await res.json()) as {
          text?: string;
          segments?: Array<{ id?: number; start: number; end: number; text: string }>;
          words?: Array<{ word?: string; text?: string; start: number; end: number }>;
        };

        // Second-pass ASR: use a stronger transcript-only model as the source
        // of truth, then align it back onto Groq's timestamps. This is far more
        // reliable for Tunisian Derja with French/English code-switching than
        // trying to repair badly-spelled words one-by-one after Whisper.
        const highAccuracyText = await transcribeHighAccuracyText(file, derjaPrompt).catch((e: unknown) => {
          console.error("high-accuracy transcription failed, using Groq transcript:", e);
          return "";
        });

        const allWords = (data.words ?? [])
          .map((w) => ({
            start: w.start,
            end: w.end,
            text: normalizeLoanwords(((w.word ?? w.text) || "").trim()),
          }))
          .filter((w) => w.text.length > 0);

        // Assign each word to the segment whose [start,end] contains its
        // midpoint. Guarantees every word lands in exactly one segment — no
        // drops on boundaries.
        const segs = (data.segments ?? []).map((s, i) => ({
          id: typeof s.id === "number" ? s.id : i,
          start: s.start,
          end: s.end,
          text: normalizeLoanwords(dedupeRepeats((s.text || "").trim())),
          words: [] as typeof allWords,
        }));
        for (const w of allWords) {
          const mid = (w.start + w.end) / 2;
          let idx = segs.findIndex((s) => mid >= s.start && mid <= s.end);
          if (idx === -1) {
            // Fallback: nearest segment by distance to midpoint.
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < segs.length; i++) {
              const d = Math.min(Math.abs(mid - segs[i].start), Math.abs(mid - segs[i].end));
              if (d < bestDist) {
                bestDist = d;
                best = i;
              }
            }
            idx = best;
          }
          if (idx >= 0 && segs[idx]) segs[idx].words.push(w);
        }
        const rawSegments = segs;

        // Drop segments that became empty after dedupe.
        const segments = rawSegments.filter((s) => s.text.length > 0);

        const referenceSegments: PolishSeg[] = highAccuracyText
          ? await alignSegmentsToReference(segments, highAccuracyText).catch((e: unknown) => {
              console.error("alignSegmentsToReference failed, using weighted split:", e);
              return splitReferenceBySegmentWeights(segments, highAccuracyText);
            })
          : segments;

        // Polish spelling, spacing, and punctuation with the configured AI while
        // preserving the original Derja words and meaning. Failures here are
        // non-fatal — we fall back to the raw Whisper output.
        const polishedSegments: PolishSeg[] = (
          highAccuracyText
            ? referenceSegments
            : await polishSegments(referenceSegments).catch((e: unknown) => {
                console.error("polishSegments failed:", e);
                return referenceSegments;
              })
        ).map(syncWordsToSegmentText);

        const fullText =
          polishedSegments
            .map((s: { text: string }) => s.text)
            .join(" ")
            .trim() || normalizeLoanwords(dedupeRepeats((data.text || "").trim()));

        // Forward Groq rate-limit headers so the UI can show "minutes left today".
        const h = res.headers;
        const rate = {
          limitAudioSeconds: numOrNull(h.get("x-ratelimit-limit-audio-seconds")),
          remainingAudioSeconds: numOrNull(h.get("x-ratelimit-remaining-audio-seconds")),
          resetAudioSeconds: h.get("x-ratelimit-reset-audio-seconds"),
          limitRequests: numOrNull(h.get("x-ratelimit-limit-requests")),
          remainingRequests: numOrNull(h.get("x-ratelimit-remaining-requests")),
        };

        const polishedWords = polishedSegments.flatMap((s: PolishSeg) => s.words ?? []);

        return Response.json({
          text: fullText,
          segments: polishedSegments,
          words: polishedWords,
          rate,
        });
      },
    },
  },
});

type PolishWord = { start: number; end: number; text: string };
type PolishSeg = { id: number; start: number; end: number; text: string; words?: PolishWord[] };

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const WORD_EDGE = "[\\s،,.؟!?;:؛()\\[\\]{}\"'«»]";
const LOANWORD_FIXES: Array<[string, string]> = [
  ["برودوي|برودوا|برودو|produi(?:t)?", "produit"],
  ["بروجي|بروجاي|projet", "projet"],
  ["بروبليم|بروبلام|بروبلم|problem(?:e)?", "problème"],
  ["سارفيس|سيرفيس|service", "service"],
  ["مونطاج|مونتاج|montage", "montage"],
  ["بيزناس|بزنس|business", "business"],
  ["ماركيتينغ|ماركتينج|ماركتينغ|marketing", "marketing"],
  ["أورديناتور|اورديناتور|ورديناتور|ordinateur", "ordinateur"],
  ["تيليفون|تليفون|طيليفون|telephone|téléphone", "téléphone"],
  ["ريزو|reseau|réseau", "réseau"],
  ["روندي[ -]?فو|رونديفو|rendez[ -]?vous", "rendez-vous"],
  ["بوتيك|boutique", "boutique"],
  ["ريستو|ريسطو|resto", "resto"],
  ["ريستوران|restaurant", "restaurant"],
  ["كافي|كافيه|cafe|café", "café"],
  ["فاكتور|facture", "facture"],
  ["كاميون|camion", "camion"],
  ["طوموبيل|طوموبيلة|اوتوموبيل|automobile", "automobile"],
  ["ماشينة|ماكينة|machine", "machine"],
  ["بانك|بنك|banque", "banque"],
  ["فاميلا|فاميليا|famille", "famille"],
  ["إيكول|ايكول|ليكول|école|ecole", "école"],
  ["بيرو|bureau", "bureau"],
  ["ميرسي|merci", "merci"],
  ["سيلفوبلي|سيلفو بلي|s[’']?il vous plai(?:t|s)|s’il vous plaît", "s'il vous plaît"],
  ["نورمالمون|normalement", "normalement"],
  ["دييجا|ديجا|deja|déjà", "déjà"],
  ["توجور|toujours", "toujours"],
  ["شاريجور|شارجور|chargeur", "chargeur"],
  ["فيديو|video|vidéo", "vidéo"],
  ["إيميل|ايميل|email|e-mail", "email"],
  ["كومبيوتر|كومبيوطر|computer", "computer"],
  ["وايفاي|wifi|wi-fi", "wifi"],
  ["داونلود|download", "download"],
  ["لينك|link", "link"],
  ["client|كليان|كليون", "client"],
  ["commande|كوموند|كومند", "commande"],
  ["livraison|ليفريزون|ليفريزون", "livraison"],
  ["formation|فورماسيون", "formation"],
  ["stage|ستاج", "stage"],
  ["réunion|reunion|ريونيون", "réunion"],
  ["application|ابليكاسيون|أبليكاسيون", "application"],
  ["connexion|كونكسيون", "connexion"],
  ["internet|انترنت|إنترنت", "internet"],
  ["logiciel|لوجيسيال", "logiciel"],
  ["facturation|فاكتوراسيون", "facturation"],
  ["ليسي|ليسيه|lyci|lycee|lycée", "lycée"],
  ["كوليج|college|collège", "collège"],
  ["فاك|faculte|faculté", "faculté"],
  ["يونيفرسيتي|université|universite", "université"],
  ["بروف|بروفيسور|prof|professeur", "professeur"],
  ["إيتيديون|étudiant|etudiant", "étudiant"],
  ["باكالوريا|باك|bac|baccalauréat|baccalaureat", "baccalauréat"],
  ["ديبلوم|diplome|diplôme", "diplôme"],
  ["كور|cours", "cours"],
  ["إكزامون|إكزامن|examen", "examen"],
  ["نوت|notes?", "note"],
  ["كاهيي|كاهي|cahier", "cahier"],
  ["ليفر|livre", "livre"],
  ["ستيلو|stylo", "stylo"],
  ["ساك|sac", "sac"],
  ["كلاس|classe", "classe"],
  ["سوسيتي|société|societe", "société"],
  ["كومباني|compagnie", "compagnie"],
  ["أنتربريز|entreprise", "entreprise"],
  ["بروجكت|projet", "projet"],
  ["إيكيب|équipe|equipe", "équipe"],
  ["شيف|chef", "chef"],
  ["باترون|patron", "patron"],
  ["كولاج|collègue|collegue", "collègue"],
  ["سالار|salaire", "salaire"],
  ["كونترا|contrat", "contrat"],
  ["ميتيي|métier|metier", "métier"],
  ["ترافاي|travail", "travail"],
  ["بولو|boulot", "boulot"],
  ["فيف|vie", "vie"],
  ["مايزون|maison", "maison"],
  ["أبارتمون|appartement", "appartement"],
  ["شامبر|chambre", "chambre"],
  ["كويزين|cuisine", "cuisine"],
  ["سال|salle", "salle"],
  ["جاردان|jardin", "jardin"],
  ["فواتور|voiture", "voiture"],
  ["بيرمي|permis", "permis"],
  ["روت|route", "route"],
  ["أوتوروت|autoroute", "autoroute"],
  ["إسانس|essence", "essence"],
  ["غازوال|gasoil|gazole", "gasoil"],
  ["كنترول|contrôle|controle", "contrôle"],
  ["بوليس|police", "police"],
  ["دوكتور|docteur", "docteur"],
  ["ميديسان|médecin|medecin", "médecin"],
  ["فارماسي|pharmacie", "pharmacie"],
  ["أوبيتال|hôpital|hopital", "hôpital"],
  ["كليني|clinique", "clinique"],
  ["رونديز فو|rendez vous", "rendez-vous"],
  ["سوبيرماركي|supermarché|supermarche", "supermarché"],
  ["ماغازا|magasin", "magasin"],
  ["مارشي|marché|marche", "marché"],
  ["برومو|promotion|promo", "promo"],
  ["سولد|soldes?", "soldes"],
  ["بريكس|prix", "prix"],
  ["أرجون|argent", "argent"],
  ["مونيي|monnaie", "monnaie"],
  ["كارت|carte", "carte"],
  ["كومبت|compte", "compte"],
  ["شيك|chèque|cheque", "chèque"],
  ["كريدي|crédit|credit", "crédit"],
  ["ديبي|débit|debit", "débit"],
  ["بيلي|billet", "billet"],
  ["تيكي|ticket", "ticket"],
  ["ريسي|reçu|recu", "reçu"],
  ["كادو|cadeau", "cadeau"],
  ["فيت|fête|fete", "fête"],
  ["أنيفيرسير|anniversaire", "anniversaire"],
  ["ماريياج|mariage", "mariage"],
  ["فاكونس|vacances", "vacances"],
  ["فوياج|voyage", "voyage"],
  ["أفيون|avion", "avion"],
  ["إيروبور|aéroport|aeroport", "aéroport"],
  ["تران|train", "train"],
  ["غار|gare", "gare"],
  ["بيلاج|plage", "plage"],
  ["مير|mer", "mer"],
  ["موتاي|montagne", "montagne"],
  ["أوتيل|hôtel|hotel", "hôtel"],
  ["شامبر دوتيل|chambre d'hôtel", "chambre d'hôtel"],
  ["ريزرفاسيون|réservation|reservation", "réservation"],
  ["أسوروانس|assurance", "assurance"],
  ["سيكوريتي|sécurité|securite", "sécurité"],
  ["كاميرا|caméra|camera", "caméra"],
  ["فوتو|photo", "photo"],
  ["إيكران|écran|ecran", "écran"],
  ["كلافيي|clavier", "clavier"],
  ["سوري|souris", "souris"],
  ["إيمبريمونت|imprimante", "imprimante"],
  ["لوجيسيال|logiciel", "logiciel"],
  ["لوغو|logo", "logo"],
  ["ساي|site", "site"],
  ["باج|page", "page"],
  ["كومبت|compte", "compte"],
  ["موط دو باس|mot de passe", "mot de passe"],
  ["باسوورد|password", "password"],
  ["لوغين|login", "login"],
];


function normalizeLoanwords(input: string): string {
  let out = input;
  for (const [pattern, replacement] of LOANWORD_FIXES) {
    out = out.replace(
      new RegExp(`(^|${WORD_EDGE})(?:${pattern})(?=$|${WORD_EDGE})`, "giu"),
      `$1${replacement}`,
    );
  }
  return out
    .replace(/\s+([،.؟!,?.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function syncWordsToSegmentText(seg: PolishSeg): PolishSeg {
  const srcWords = (seg.words ?? []).filter((w) => w.text);
  const tokens = normalizeLoanwords(seg.text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ...seg, text: "", words: [] };
  if (srcWords.length === tokens.length) {
    return {
      ...seg,
      text: tokens.join(" "),
      words: tokens.map((text, i) => ({ ...srcWords[i], text })),
    };
  }

  const duration = Math.max(0.001, seg.end - seg.start);
  const step = duration / tokens.length;
  return {
    ...seg,
    text: tokens.join(" "),
    words: tokens.map((text, i) => ({
      start: seg.start + step * i,
      end: seg.start + step * (i + 1),
      text,
    })),
  };
}

// Use the configured AI to fix spelling, spacing and punctuation in Derja segments
// while preserving the original wording and meaning. Returns same shape with
// cleaned text. Throws on hard failure; caller falls back to raw segments.
async function polishSegments(segments: PolishSeg[]): Promise<PolishSeg[]> {
  if (segments.length === 0) return segments;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return segments;

  const fullContext = segments.map((s) => s.text).join("\n");
  const payload = segments.map((s) => ({ id: s.id, text: s.text }));

  const system =
    "أنت محرر لغوي للهجة التونسية الدارجة (Derja) خبير في code-switching مع الفرنسية والإنجليزية. " +
    "مهمتك تنظيف نص تفريغ صوتي تونسي: صحح الإملاء، أضف علامات الترقيم (،.؟!)، أصلح المسافات، " +
    "وأزل التكرار الخاطئ. حافظ على نفس الكلمات والمعنى واللهجة. لا تترجم للفصحى. " +
    "\n\n" +
    "**القاعدة الأهم — الكلمات الفرنسية والإنجليزية:** " +
    "التوانسة يخلطون برشا كلمات فرنسية في كلامهم. Whisper غالباً يكتبها غلط بحروف عربية مشوهة أو حتى بحروف لاتينية خاطئة. " +
    "مهمتك الأساسية: اكتشف أي كلمة أصلها فرنسي أو إنجليزي وأعد كتابتها بالحروف اللاتينية وبالإملاء الفرنسي/الإنجليزي الصحيح 100%. " +
    "استعمل سياق النص الكامل لتعرف الكلمة: صحح داخل كل segment لكن لا تغيّر ترتيب segments ولا ids. " +
    "إذا الكلمة تنطق فرنسي/إنجليزي، ممنوع تتركها بحروف عربية حتى لو Whisper كتبها هكا. " +
    "\n" +
    "أمثلة تصحيحات شائعة (الخطأ ← الصحيح):\n" +
    "- برودوي/برودوا/produi → produit\n" +
    "- مونطاج/مونتاج → montage\n" +
    "- بيزناس/بزنس → business\n" +
    "- ماركيتينغ/ماركتينج → marketing\n" +
    "- بروبليم/بروبلام → problème\n" +
    "- سارفيس/سيرفيس → service\n" +
    "- أورديناتور/أورديناتور → ordinateur\n" +
    "- تيليفون/طيليفون → téléphone\n" +
    "- ريزو → réseau\n" +
    "- بوتيك → boutique\n" +
    "- ريستو/ريسطو → resto\n" +
    "- كافي/كافيه → café\n" +
    "- فاكتور → facture\n" +
    "- كاميون → camion\n" +
    "- طوموبيل/طوموبيلة → automobile\n" +
    "- ماشينة → machine\n" +
    "- بانك → banque\n" +
    "- فاميلا/فاميليا → famille\n" +
    "- إيكول → école\n" +
    "- بيرو → bureau\n" +
    "- روندي فو → rendez-vous\n" +
    "- ميرسي → merci\n" +
    "- سيلفوبلي → s'il vous plaît\n" +
    "- نورمالمون → normalement\n" +
    "- دييجا → déjà\n" +
    "- توجور → toujours\n" +
    "- شاريجور → chargeur\n" +
    "- فيديو → vidéo\n" +
    "- إيميل → email\n" +
    "- كومبيوتر/كومبيوطر → computer\n" +
    "- وايفاي → wifi\n" +
    "- داونلود → download\n" +
    "- لينك → link\n" +
    "\n" +
    "لما تشك في كلمة، استنتج من السياق: إذا كانت تقنية، تجارية، أو حياتية حديثة → غالباً فرنسية. اكتبها صح بحروف لاتينية وaccents صحيحة (é, è, ê, à, ç...). " +
    "الكلمات العربية/الدارجة الأصلية (برشا، ياسر، شنوة، باهي، موش...) خليها بالحروف العربية. " +
    "\n\n" +
    "أرجع JSON فقط بنفس البنية: " +
    '[{"id":number,"text":string}, ...]';

  const userMsg = JSON.stringify({ fullContext, segments: payload });

  // Try flash first (high free-tier quota), fall back to pro if it fails,
  // then 2.5-flash-lite as a last resort. This avoids the 429 quota errors
  // that were silently dropping the polish step entirely.
  const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
  let content = "";
  let lastErr: unknown = null;
  for (const model of models) {
    try {
      content = await geminiChat({ system, user: userMsg, jsonMode: true, model });
      if (content) break;
    } catch (e) {
      lastErr = e;
      console.error(`polishSegments: ${model} failed, trying fallback:`, e);
    }
  }
  if (!content) {
    if (lastErr) console.error("polishSegments: all models failed:", lastErr);
    return segments;
  }


  // Model may return either a bare array or an object wrapping it.
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return segments;
    parsed = JSON.parse(m[0]);
  }

  const arr: Array<{ id?: number; text?: string }> = Array.isArray(parsed)
    ? (parsed as Array<{ id?: number; text?: string }>)
    : Array.isArray((parsed as { segments?: unknown }).segments)
      ? (parsed as { segments: Array<{ id?: number; text?: string }> }).segments
      : [];

  if (arr.length === 0) return segments;

  const byId = new Map<number, string>();
  for (const item of arr) {
    if (typeof item?.id === "number" && typeof item?.text === "string") {
      byId.set(item.id, item.text.trim());
    }
  }

  return segments.map((s) => {
    const cleaned = byId.get(s.id);
    return cleaned && cleaned.length > 0 ? { ...s, text: cleaned } : s;
  });
}

// Collapse only obvious Whisper hallucination loops. We DO NOT touch a single
// repeat (e.g. "لا لا", "شوية شوية") because those are valid speech. We only
// act when something repeats 3+ times in a row — that's the real artifact.
function dedupeRepeats(input: string): string {
  if (!input) return input;
  // Collapse runs of the same character (6+) down to 2: "اااااااا" -> "اا".
  const s = input.replace(/(.)\1{5,}/g, "$1$1");

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 3) return s.trim();

  // Collapse a word repeated 3+ times in a row down to a single instance.
  const out: string[] = [];
  let run = 1;
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i] === words[i - 1]) {
      run++;
      if (run >= 3) continue; // skip 3rd+ repetition
      out.push(words[i]);
    } else {
      run = 1;
      out.push(words[i]);
    }
  }

  // Collapse n-gram phrases repeated 3+ times (n=2..5).
  for (let n = 2; n <= 5; n++) {
    let i = 0;
    while (i + 3 * n <= out.length) {
      const a = out.slice(i, i + n).join(" ");
      const b = out.slice(i + n, i + 2 * n).join(" ");
      const c = out.slice(i + 2 * n, i + 3 * n).join(" ");
      if (a === b && b === c) {
        // Drop the 3rd copy, keep checking from same position for more.
        out.splice(i + 2 * n, n);
      } else {
        i++;
      }
    }
  }

  return out
    .join(" ")
    .replace(/\s+([،.؟!,?.])/g, "$1")
    .trim();
}
