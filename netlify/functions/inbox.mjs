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
//   POST  ?op=share   body {code, id | image}                           -> {token, url}
//   GET   ?op=view&token=..                                             -> image bytes (PUBLIC — no code)
//   POST  ?op=unshare body {code, token}                                -> {ok}
//
// Sharing: a share token is a SEPARATE, unguessable id that maps to one image.
// It must never be derived from — or reveal — the pairing code, because the
// code is the private room key (list / delete everything). Anyone holding a
// share link can view that one image only, until the image itself expires.
import { getStore } from "@netlify/blobs";
import { randomUUID, randomBytes } from "node:crypto";

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // a share link lives 7 days, then it and its image are deleted
const MAX_ITEMS = 100;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD = 6 * 1024 * 1024;
const CODE_RE = /^snap_[A-Za-z0-9]{16,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const store = () => getStore({ name: "inbox", consistency: "strong" });

// The share page is the only part of the product a stranger ever sees, so it
// does three jobs: show the picture, offer the file, and say where it came
// from. Self-contained — no external assets, nothing to break.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function sharePage(origin, token, state, status, rec) {
  const img = `${origin}/s/${token}.png`;
  const home = origin + "/";
  const ok = state === "ok";
  const title = ok ? "Shared screenshot" : state === "expired" ? "This link has expired" : "Link not found";
  const daysLeft = ok && rec ? Math.max(1, Math.ceil((rec.createdAt + SHARE_TTL_MS - Date.now()) / 864e5)) : 0;
  const body = ok
    ? `<a class="pic" href="${esc(img)}" title="Open the image"><img src="${esc(img)}" alt="Shared screenshot"></a>
       <div class="row"><a class="btn" href="${esc(img)}" download="snappy-${esc(token.slice(0, 8))}.png">Download PNG</a>
       <span class="mut">Link expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}</span></div>`
    : `<div class="gone"><div class="big">${state === "expired" ? "⏳" : "🔍"}</div>
       <p>${state === "expired"
         ? "Share links last 7 days, and this one has run out. The image has been deleted."
         : "There's nothing at this address. The link may have been mistyped, or it was removed."}</p></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Snappy Frame</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${esc(title)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(origin + "/s/" + token)}">
${ok ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">` : ""}
<meta property="og:site_name" content="Snappy Frame">
<meta name="theme-color" content="#0e0f14">
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#0e0f14;color:#e7e9ef;font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;flex-direction:column;align-items:center;padding:28px 16px 40px}
  a.hdr{text-decoration:none;color:inherit}header{display:flex;align-items:center;gap:10px;margin-bottom:22px}
  .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6d5efc,#c05bff)}
  header b{font-size:15px}header span{color:#9aa0b0;font-size:13px}
  .pic{display:block;max-width:min(100%,1200px)}
  .pic img{display:block;max-width:100%;height:auto;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6);border:1px solid #262b38}
  .row{display:flex;gap:14px;align-items:center;margin-top:18px;flex-wrap:wrap;justify-content:center}
  .btn{display:inline-block;background:#6d5efc;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px}
  .btn:hover{filter:brightness(1.08)}.mut{color:#9aa0b0;font-size:13px}
  .gone{text-align:center;max-width:440px;margin-top:40px}.big{font-size:44px}
  footer{margin-top:auto;padding-top:40px;text-align:center;color:#9aa0b0;font-size:13px;line-height:1.7}
  footer a{color:#c9c4ff;text-decoration:none;font-weight:600}footer a:hover{text-decoration:underline}
</style></head><body>
<a class="hdr" href="${esc(home)}" title="Snappy Frame"><header><span class="logo"></span><b>Snappy Frame</b><span>shared screenshot</span></header></a>
${body}
<footer>Shared with <a href="${esc(home)}">Snappy Frame</a> — free screenshot capture &amp; beautifier.<br>
<a href="${esc(home)}">Make your own →</a></footer>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": ok ? "public, max-age=300" : "no-store" } });
}
const idxKey = (c) => `${c}/index`;
const imgKey = (c, id) => `${c}/img/${id}`;
const shareKey = (t) => `share/${t}`;

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
  let op = q.op || "";
  // The /s/<token> rewrite hands the function the ORIGINAL request URL, not
  // the rewritten one — so the op=view&token= query never arrives and the
  // request fell through to the code gate ("bad or missing code"). Read the
  // token off the path too, so it works whichever URL Netlify passes.
  let pathToken = "", raw = q.raw === "1";
  const pm = url.pathname.match(/\/s\/([A-Za-z0-9_-]{16,64})(\.png)?\/?$/);
  if (pm) { op = "view"; pathToken = pm[1]; if (pm[2]) raw = true; }
  let body = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); } }
  // Public view: the only op that takes no pairing code. The token alone
  // identifies one image and nothing else.
  //   /s/<token>      -> an HTML page: the image, a download, and a way back to
  //                      Snappy Frame. Carries Open Graph tags pointing at the
  //                      raw bytes so Slack / Discord / iMessage unfurl the
  //                      picture rather than a blank card.
  //   /s/<token>.png  -> the raw bytes, for <img>, unfurlers and curl.
  if (op === "view") {
    const token = (q.token || pathToken || "").trim();
    if (!TOKEN_RE.test(token)) return raw ? json({ error: "bad token" }, 400) : sharePage(url.origin, token, "missing", 404);
    const sv = store();
    let rec = null;
    try { rec = await sv.get(shareKey(token), { type: "json" }); } catch {}
    if (!rec || !rec.code || !rec.id) return raw ? json({ error: "not found" }, 404) : sharePage(url.origin, token, "missing", 404);
    if (Date.now() - (rec.createdAt || 0) > SHARE_TTL_MS) {
      // Expired: the link goes, and if the image was uploaded purely to make
      // this link (rather than being an existing inbox item), it goes too.
      try { await sv.delete(shareKey(token)); } catch {}
      if (rec.own) {
        try { await sv.delete(imgKey(rec.code, rec.id)); } catch {}
        try { const l = (await readIndex(sv, rec.code)).filter((i) => i.id !== rec.id); await sv.setJSON(idxKey(rec.code), l); } catch {}
      }
      return raw ? json({ error: "expired" }, 410) : sharePage(url.origin, token, "expired", 410);
    }
    if (!raw) return sharePage(url.origin, token, "ok", 200, rec);
    const buf = await sv.get(imgKey(rec.code, rec.id), { type: "arrayBuffer" });
    if (!buf) { try { await sv.delete(shareKey(token)); } catch {} return json({ error: "expired" }, 404); }
    return new Response(buf, { status: 200, headers: {
      ...CORS, "Content-Type": "image/png",
      // Shared links get pasted into chats that fetch them repeatedly; cache
      // is fine because the bytes for a given token never change.
      "Cache-Control": "public, max-age=" + Math.max(60, Math.min(3600, Math.floor((rec.createdAt + SHARE_TTL_MS - Date.now()) / 1000))),
      "Content-Disposition": "inline; filename=\"snappy-" + token.slice(0, 8) + ".png\"",
    } });
  }

  const code = (body.code || q.code || "").trim();
  if (!CODE_RE.test(code)) return json({ error: "bad or missing code" }, 400);
  const s = store();

  try {
    // Upload one image into the room and return its id. Shared by put + share.
    const putImage = async () => {
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
      return { id, createdAt };
    };

    if (op === "put") {
      const r = await putImage();
      return r instanceof Response ? r : json(r);
    }

    if (op === "share") {
      let id = String(body.id || "").replace(/[^A-Za-z0-9-]/g, "");
      let own = false;                       // did this call upload the image just to share it?
      if (!id) {
        if (!body.image) return json({ error: "need id or image" }, 400);
        const r = await putImage();
        if (r instanceof Response) return r;
        id = r.id; own = true;
      }
      // Only share what this room actually owns.
      const exists = await s.get(imgKey(code, id), { type: "arrayBuffer" });
      if (!exists) return json({ error: "not found" }, 404);
      // 128 bits, URL-safe. Unguessable is the entire security model here.
      const token = randomBytes(16).toString("base64url");
      const createdAt = Date.now();
      await s.setJSON(shareKey(token), { code, id, createdAt, own });
      const origin = url.origin;
      return json({ token, id, url: `${origin}/s/${token}`, expiresAt: createdAt + SHARE_TTL_MS });
    }

    if (op === "unshare") {
      const token = String(body.token || "").trim();
      if (!TOKEN_RE.test(token)) return json({ error: "bad token" }, 400);
      const rec = await s.get(shareKey(token), { type: "json" }).catch(() => null);
      // Revocation needs the room's code: a stranger holding the link can
      // view it, but can't kill someone else's share.
      if (rec && rec.code !== code) return json({ error: "not yours" }, 403);
      try { await s.delete(shareKey(token)); } catch {}
      return json({ ok: true });
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
