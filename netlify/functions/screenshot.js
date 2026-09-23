// Snappy Frame — grab a screenshot of a public webpage by URL.
// Returns a same-origin data URL so the shot is both editable AND exportable
// (html-to-image can't inline a tainted cross-origin image).
//
// Backends, in order:
//   1. ScreenshotOne  — used when the SCREENSHOT_API_KEY env var is set, or the
//      user sends their own key in X-Shot-Key (crisper, faster, blocks cookie
//      banners/ads). Get a key at https://screenshotone.com and add it in
//      Netlify → Site settings → Environment variables. Never hard-code it.
//   2. WordPress mShots — free, keyless fallback (slower, lower quality). It is
//      DESKTOP ONLY: its width setting resizes the returned image, never the
//      viewport, so it cannot produce a mobile layout. Phone and tablet grabs
//      therefore refuse to fall back to it rather than return a desktop page
//      dressed up as a phone.

// The page is RENDERED at the device's width, density and viewport rules, so
// the site's own mobile layout switches on. Cropping a desktop render to a
// phone shape only gives a squeezed desktop page. Kept in step with the table
// in index.html.
const DEVICES = {
  desktop: { w: 1440, h: 900,  dsf: 2, fullDsf: 1,   mobile: false },
  tablet:  { w: 820,  h: 1180, dsf: 2, fullDsf: 1.5, mobile: true,
             ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
  phone:   { w: 390,  h: 844,  dsf: 3, fullDsf: 2,   mobile: true,
             ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
};
// Browsers refuse canvases much past 16k px a side, and the editor bakes the
// shot into one, so a full page is capped at this many OUTPUT pixels tall.
const MAX_OUT_H = 14000;
// Netlify caps a synchronous function's response at 6 MB, and base64 adds a
// third — so anything over this is re-rendered at a lower JPEG quality.
const SAFE_BYTES = 4.2 * 1024 * 1024;

function shotParams(key, url, dev, full, quality) {
  const dsf = full ? dev.fullDsf : dev.dsf;
  const p = new URLSearchParams({
    access_key: key, url,
    viewport_width: String(dev.w), viewport_height: String(dev.h),
    device_scale_factor: String(dsf),
    format: "jpg", image_quality: String(quality),
    full_page: full ? "true" : "false",
    block_ads: "true", block_cookie_banners: "true", block_trackers: "true", cache: "true",
  });
  if (full) p.set("full_page_max_height", String(Math.floor(MAX_OUT_H / dsf)));   // CSS px
  if (dev.mobile) {
    p.set("viewport_mobile", "true");        // honour <meta name=viewport>
    p.set("viewport_has_touch", "true");     // touch-only UI (hover menus) renders as on a phone
    if (dev.ua) p.set("user_agent", dev.ua); // sites that pick a layout by user agent
  }
  return "https://api.screenshotone.com/take?" + p.toString();
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "x-shot-key",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  const q = event.queryStringParameters || {};
  let url = (q.url || "").trim();
  if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing url" }) };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const full = q.full === "1" || q.full === "true";
  // `device` is the current contract. A bare `w` is what older cached copies of
  // the page still send, so it maps onto the desktop preset at that width.
  const devName = DEVICES[q.device] ? q.device : "desktop";
  let dev = DEVICES[devName];
  if (!q.device && q.w) dev = { ...dev, w: Math.min(2000, Math.max(600, parseInt(q.w, 10) || 1280)), dsf: 1 };
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
      let buf = null;
      for (const quality of [82, 60]) {
        const r = await fetch(shotParams(key, url, dev, full, quality));
        if (!r.ok) { buf = null; break; }
        buf = Buffer.from(await r.arrayBuffer());
        if (buf.length <= SAFE_BYTES) break;
      }
      if (buf && buf.length <= SAFE_BYTES) {
        return json({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), generating: false, device: devName });
      }
      if (buf) return json({ error: "That page is too long to send back in one piece — try the visible area instead of the full page.", tooBig: true }, 413);
      // Key failed (bad key / quota) — fall through to the free renderer below.
    }

    if (dev.mobile) {
      return json({ error: "Phone and tablet grabs need a ScreenshotOne key — the free renderer can only do desktop.", needKey: true }, 402);
    }

    // Free fallback: mShots serves a small placeholder while rendering.
    const src = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${Math.min(1280, dev.w)}`;
    let buf = null, generating = true, tries = 0;
    while (tries < 3) {
      tries++;
      const r = await fetch(src, { redirect: "follow" });
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 30000) { generating = false; break; }
      if (tries < 3) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!buf || !buf.length) return json({ error: "no image" }, 502);
    return json({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), generating, device: "desktop" });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
};

// Exposed for the tests; Netlify only reads `handler`.
exports._shotParams = shotParams;
exports._DEVICES = DEVICES;
