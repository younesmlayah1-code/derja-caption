import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Shotstack render via Lovable server functions.
// Reads SHOTSTACK_API_KEY (required) and SHOTSTACK_ENV ("stage" | "v1", default "stage").

function env() {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error("SHOTSTACK_API_KEY is not configured");
  // Only accept the two valid Shotstack environments. Anything else (full URL,
  // empty, typo) falls back to "stage".
  const raw = (process.env.SHOTSTACK_ENV || "").trim().toLowerCase();
  const stage = raw === "v1" || raw === "stage" ? raw : "stage";
  return { key, stage };
}

async function ssFetch(
  path: string,
  init: RequestInit & { service?: "edit" | "ingest" } = {},
) {
  const { key, stage } = env();
  const service = init.service ?? "edit";
  const url = `https://api.shotstack.io/${service}/${stage}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    throw new Error(`Shotstack ${service} ${path} ${res.status}: ${body.slice(0, 500)}`);
  }
  return json as Record<string, unknown>;
}

/** Request a signed upload URL from Shotstack Ingest. */
export const createShotstackUpload = createServerFn({ method: "POST" }).handler(async () => {
  const json = (await ssFetch("/upload", { method: "POST", service: "ingest" })) as {
    data?: { attributes?: { url?: string; id?: string } };
  };
  const url = json?.data?.attributes?.url;
  const id = json?.data?.attributes?.id;
  if (!url || !id) throw new Error("Shotstack did not return an upload URL");
  return { uploadUrl: url, sourceId: id };
});

/** Get ingest source status; when ready, attributes.source holds the playable URL. */
export const getShotstackSource = createServerFn({ method: "POST" })
  .inputValidator(z.object({ sourceId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const json = (await ssFetch(`/sources/${data.sourceId}`, {
      method: "GET",
      service: "ingest",
    })) as {
      data?: { attributes?: { status?: string; source?: string; error?: string } };
    };
    const a = json?.data?.attributes;
    return {
      status: a?.status || "queued",
      sourceUrl: a?.source || null,
      error: a?.error || null,
    };
  });

const ClipSchema = z.object({
  start: z.number().min(0),
  length: z.number().min(0.05),
  text: z.string().min(1).max(500),
});

const StyleSchema = z.object({
  id: z.string(),
  fontSize: z.number(),
  color: z.string(),
  outline: z.string(),
  background: z.string(),
  bold: z.boolean(),
  rtl: z.boolean(),
});

const RenderInput = z.object({
  sourceUrl: z.string().url(),
  width: z.number().int().min(64).max(3840),
  height: z.number().int().min(64).max(3840),
  clips: z.array(ClipSchema).min(1).max(2000),
  style: StyleSchema,
});

function captionCss(style: z.infer<typeof StyleSchema>): string {
  const isBox = style.background !== "transparent";
  const shadow = isBox
    ? "none"
    : `-2px -2px 0 ${style.outline}, 2px -2px 0 ${style.outline}, -2px 2px 0 ${style.outline}, 2px 2px 0 ${style.outline}, 0 0 6px ${style.outline}`;
  return `
p {
  font-family: ${style.rtl ? "'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif" : "'Inter', 'Helvetica Neue', Arial, sans-serif"};
  font-size: ${style.fontSize}px;
  color: ${style.color};
  font-weight: ${style.bold ? 800 : 500};
  text-align: center;
  line-height: 1.2;
  margin: 0;
  padding: ${isBox ? "8px 18px" : "0"};
  background: ${isBox ? style.background : "transparent"};
  border-radius: ${isBox ? "8px" : "0"};
  text-shadow: ${shadow};
  display: inline-block;
  direction: ${style.rtl ? "rtl" : "ltr"};
}
`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Submit a render with caption HTML clips overlaid on the source video. */
export const submitShotstackRender = createServerFn({ method: "POST" })
  .inputValidator(RenderInput)
  .handler(async ({ data }) => {
    const css = captionCss(data.style);
    const capWidth = Math.min(data.width - 80, Math.round(data.width * 0.92));
    const capHeight = Math.max(140, Math.round(data.style.fontSize * 3.2));

    const captionClips = data.clips.map((c) => ({
      asset: {
        type: "html",
        html: `<p>${escapeHtml(c.text)}</p>`,
        css,
        width: capWidth,
        height: capHeight,
      },
      start: c.start,
      length: Math.max(0.1, c.length),
      position: "bottom",
      offset: { y: 0.08 },
      fit: "none",
    }));

    const body = {
      timeline: {
        background: "#000000",
        tracks: [
          { clips: captionClips },
          {
            clips: [
              {
                asset: { type: "video", src: data.sourceUrl },
                start: 0,
                length: "auto",
              },
            ],
          },
        ],
      },
      output: {
        format: "mp4",
        fps: 30,
        size: { width: data.width, height: data.height },
      },
    };

    const json = (await ssFetch("/render", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { response?: { id?: string } };

    const id = json?.response?.id;
    if (!id) throw new Error("Shotstack did not return a render id");
    return { renderId: id };
  });

/** Poll render status; when status === "done", url holds the MP4 download. */
export const getShotstackRender = createServerFn({ method: "POST" })
  .inputValidator(z.object({ renderId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const json = (await ssFetch(`/render/${data.renderId}`, { method: "GET" })) as {
      response?: { status?: string; url?: string; error?: string };
    };
    const r = json?.response;
    return {
      status: r?.status || "queued",
      url: r?.url || null,
      error: r?.error || null,
    };
  });
