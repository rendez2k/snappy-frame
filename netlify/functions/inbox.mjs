// Snappy Frame — Inbox API (Netlify Blobs), v2 function.
// v2 (export default) is used deliberately: Netlify auto-configures the Blobs
// environment for v2 functions, whereas classic (exports.handler) functions
// hit MissingBlobsEnvironmentError.
// One private "room" per pairing code. Opt-in: this is the only path that
// stores an image on the server. Retention: 14 days / 100 items / 200 MB.
//
//   POST  ?op=put     body {code, image(dataURL|base64), source, w, h}  -> {id, createdAt}
//   GET   ?op=list&code=..&since=<ts>                                   -> {items:[…]}
//   GET   ?op=get&code=..&id=..                                         -> image bytes
//   POST  ?op=del     body {code, id}                                   -> {ok}
//   POST  ?op=clear   body {code}                                       -> {ok}
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 100;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD = 6 * 1024 * 1024;
const CODE_RE = /^snap_[A-Za-z0-9]{16,64}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const store = () => getStore({ name: "inbox", consistency: "strong" });
const idxKey = (c) => `${c}/index`;
const imgKey = (c, id) => `${c}/img/${id}`;

async function readIndex(s, c) { try { return (await s.get(idxKey(c), { type: "json" })) || []; } catch { return []; } }
async function prune(s, c, list) {
  const now = Date.now(); const keep = [];
  for (const it of list) {
    if (now - it.createdAt > TTL_MS) { try { await s.delete(imgKey(c, it.id)); } catch {} }
    else keep.push(it);
  }
  return keep;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams);
  const op = q.op || "";
  let body = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); } }
  const code = (body.code || q.code || "").trim();
  if (!CODE_RE.test(code)) return json({ error: "bad or missing code" }, 400);
  const s = store();

  try {
    if (op === "put") {
      const raw = body.image || "";
      const m = /^data:image\/\w+;base64,(.+)$/.exec(raw);
      const b64 = m ? m[1] : raw;
      let buf;
      try { buf = Buffer.from(b64, "base64"); } catch { return json({ error: "bad image" }, 400); }
      if (!buf.length) return json({ error: "empty image" }, 400);
      if (buf.length > MAX_UPLOAD) return json({ error: "image too large (max 6MB)" }, 413);

      const id = randomUUID();
      const createdAt = Date.now();
      await s.set(imgKey(code, id), buf, { metadata: { contentType: "image/png" } });

      let list = await prune(s, code, await readIndex(s, code));
      list.unshift({ id, w: body.w | 0, h: body.h | 0, source: String(body.source || "").slice(0, 24), bytes: buf.length, createdAt });
      let total = list.reduce((t, i) => t + (i.bytes || 0), 0);
      while (list.length > MAX_ITEMS || total > MAX_BYTES) {
        const old = list.pop(); if (!old) break;
        total -= old.bytes || 0;
        try { await s.delete(imgKey(code, old.id)); } catch {}
      }
      await s.setJSON(idxKey(code), list);
      return json({ id, createdAt });
    }

    if (op === "list") {
      const since = parseInt(q.since, 10) || 0;
      const list = await prune(s, code, await readIndex(s, code));
      await s.setJSON(idxKey(code), list);
      return json({ items: list.filter((i) => i.createdAt > since), count: list.length });
    }

    if (op === "get") {
      const id = (q.id || "").replace(/[^A-Za-z0-9-]/g, "");
      if (!id) return json({ error: "missing id" }, 400);
      const buf = await s.get(imgKey(code, id), { type: "arrayBuffer" });
      if (!buf) return json({ error: "not found" }, 404);
      return new Response(buf, { status: 200, headers: { ...CORS, "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
    }

    if (op === "del") {
      const id = String(body.id || "").replace(/[^A-Za-z0-9-]/g, "");
      if (!id) return json({ error: "missing id" }, 400);
      try { await s.delete(imgKey(code, id)); } catch {}
      const list = (await readIndex(s, code)).filter((i) => i.id !== id);
      await s.setJSON(idxKey(code), list);
      return json({ ok: true });
    }

    if (op === "clear") {
      const list = await readIndex(s, code);
      for (const it of list) { try { await s.delete(imgKey(code, it.id)); } catch {} }
      await s.setJSON(idxKey(code), []);
      return json({ ok: true });
    }

    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: "server error", detail: String(e?.message || e) }, 500);
  }
};
