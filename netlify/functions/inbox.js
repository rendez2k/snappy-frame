// Snappy Frame — Inbox API (Netlify Blobs).
// One private "room" per pairing code. Senders POST images; the /inbox page
// lists, fetches, and deletes them. Opt-in: this is the only path that stores an
// image on the server. Retention: 14 days, 100 items, 200 MB per room.
//
// Ops (all under /.netlify/functions/inbox):
//   POST  ?op=put     body {code, image(dataURL|base64), source, w, h}  -> {id, createdAt}
//   GET   ?op=list&code=..&since=<ts>                                   -> {items:[…]}
//   GET   ?op=get&code=..&id=..                                         -> image bytes
//   POST  ?op=del     body {code, id}                                   -> {ok}
//   POST  ?op=clear   body {code}                                       -> {ok}
const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 100;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD = 6 * 1024 * 1024;               // decoded bytes per image
const CODE_RE = /^snap_[A-Za-z0-9]{16,64}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (body, status = 200) => ({ statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const store = () => getStore({ name: "inbox", consistency: "strong" });
const idxKey = (code) => `${code}/index`;
const imgKey = (code, id) => `${code}/img/${id}`;

async function readIndex(s, code) { try { return (await s.get(idxKey(code), { type: "json" })) || []; } catch (e) { return []; } }

// Drop expired items (and their blobs); return the pruned list.
async function prune(s, code, list) {
  const now = Date.now();
  const keep = [];
  for (const it of list) {
    if (now - it.createdAt > TTL_MS) { try { await s.delete(imgKey(code, it.id)); } catch (e) {} }
    else keep.push(it);
  }
  return keep;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  const q = event.queryStringParameters || {};
  const op = q.op || "";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch (e) { return json({ error: "bad json" }, 400); } }
  const code = (body.code || q.code || "").trim();
  if (!CODE_RE.test(code)) return json({ error: "bad or missing code" }, 400);
  const s = store();

  try {
    if (op === "put") {
      let img = body.image || "";
      const m = /^data:image\/\w+;base64,(.+)$/.exec(img);
      const b64 = m ? m[1] : img;
      let buf;
      try { buf = Buffer.from(b64, "base64"); } catch (e) { return json({ error: "bad image" }, 400); }
      if (!buf.length) return json({ error: "empty image" }, 400);
      if (buf.length > MAX_UPLOAD) return json({ error: "image too large (max 6MB)" }, 413);

      const id = crypto.randomUUID();
      const createdAt = Date.now();
      await s.set(imgKey(code, id), buf, { metadata: { contentType: "image/png" } });

      let list = await prune(s, code, await readIndex(s, code));
      list.unshift({ id, w: body.w | 0, h: body.h | 0, source: String(body.source || "").slice(0, 24), bytes: buf.length, createdAt });
      let total = list.reduce((t, i) => t + (i.bytes || 0), 0);
      while (list.length > MAX_ITEMS || total > MAX_BYTES) {
        const old = list.pop(); if (!old) break;
        total -= old.bytes || 0;
        try { await s.delete(imgKey(code, old.id)); } catch (e) {}
      }
      await s.setJSON(idxKey(code), list);
      return json({ id, createdAt });
    }

    if (op === "list") {
      const since = parseInt(q.since, 10) || 0;
      let list = await prune(s, code, await readIndex(s, code));
      await s.setJSON(idxKey(code), list);                 // persist any expiry cleanup
      const items = list.filter((i) => i.createdAt > since);
      return json({ items, count: list.length });
    }

    if (op === "get") {
      const id = (q.id || "").replace(/[^A-Za-z0-9-]/g, "");
      if (!id) return json({ error: "missing id" }, 400);
      const buf = await s.get(imgKey(code, id), { type: "arrayBuffer" });
      if (!buf) return json({ error: "not found" }, 404);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "image/png", "Cache-Control": "private, max-age=60" },
        body: Buffer.from(buf).toString("base64"),
        isBase64Encoded: true,
      };
    }

    if (op === "del") {
      const id = String(body.id || "").replace(/[^A-Za-z0-9-]/g, "");
      if (!id) return json({ error: "missing id" }, 400);
      try { await s.delete(imgKey(code, id)); } catch (e) {}
      const list = (await readIndex(s, code)).filter((i) => i.id !== id);
      await s.setJSON(idxKey(code), list);
      return json({ ok: true });
    }

    if (op === "clear") {
      const list = await readIndex(s, code);
      for (const it of list) { try { await s.delete(imgKey(code, it.id)); } catch (e) {} }
      await s.setJSON(idxKey(code), []);
      return json({ ok: true });
    }

    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: "server error", detail: String(e && e.message || e) }, 500);
  }
};
