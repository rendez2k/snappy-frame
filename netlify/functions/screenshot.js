// Snappy Frame — grab a screenshot of a public webpage by URL.
// Returns a same-origin data URL so the shot is both editable AND exportable
// (html-to-image can't inline a tainted cross-origin image).
//
// Backends, in order:
//   1. ScreenshotOne  — used when the SCREENSHOT_API_KEY env var is set
//      (crisper, faster, blocks cookie banners/ads). Get a key at
//      https://screenshotone.com and add it in Netlify → Site settings →
//      Environment variables. Never hard-code it.
//   2. WordPress mShots — free, keyless fallback (slower, lower quality).
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  const q = event.queryStringParameters || {};
  let url = (q.url || "").trim();
  if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing url" }) };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const w = Math.min(2000, Math.max(600, parseInt(q.w, 10) || 1280));
  const full = q.full === "1" || q.full === "true";
  const json = (body, status = 200) => ({
    statusCode: status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });

  try {
    // A user's own key (sent from their browser) wins over the site's env key.
    const hdr = event.headers || {};
    const key = hdr["x-shot-key"] || hdr["X-Shot-Key"] || process.env.SCREENSHOT_API_KEY;
    if (key) {
      const api =
        "https://api.screenshotone.com/take?access_key=" + encodeURIComponent(key) +
        "&url=" + encodeURIComponent(url) +
        "&viewport_width=" + w +
        "&format=jpg&image_quality=82&full_page=" + (full ? "true" : "false") +
        "&block_ads=true&block_cookie_banners=true&block_trackers=true&cache=true";
      const r = await fetch(api);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        return json({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), generating: false });
      }
      // Key failed (bad key / quota) — fall through to the free renderer below.
    }

    // Free fallback: mShots serves a small placeholder while rendering.
    const src = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${w}`;
    let buf = null, generating = true, tries = 0;
    while (tries < 3) {
      tries++;
      const r = await fetch(src, { redirect: "follow" });
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 30000) { generating = false; break; }
      if (tries < 3) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!buf || !buf.length) return json({ error: "no image" }, 502);
    return json({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), generating });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
};
