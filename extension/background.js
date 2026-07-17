// Snappy Frame — Capture (service worker)
// Grabs the current tab (visible area, full page, or a right-clicked image)
// and opens Snappy Frame with the shot handed over via extension storage.
const APP_URL = "https://snappy-frame.netlify.app/";
const MAXDIM = 16384; // canvas ceiling for the app + downstream export

// ---- hand-off ------------------------------------------------------------
async function handoff(dataUrl, url, title) {
  await chrome.storage.local.set({
    snappyShot: dataUrl,
    snappyUrl: url && /^https?:/i.test(url) ? url : "",
    snappyTitle: title || "",
    snappyTs: Date.now(),
  });
  await chrome.tabs.create({ url: APP_URL });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// ---- visible-area capture (throttled) ------------------------------------
// captureVisibleTab is rate-limited (~a couple/sec). Space calls out so the
// full-page tile loop never trips MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
let lastCap = 0;
async function throttledCapture(windowId) {
  const gap = 600 - (Date.now() - lastCap);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCap = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function captureVisible(tab) {
  tab = tab || (await activeTab());
  if (!tab) return;
  const dataUrl = await throttledCapture(tab.windowId);
  // Crop a scrollbar out of the view too (no blank-band trim — a visible grab
  // should stay "what you see" apart from the scrollbar).
  await handoff(await cropRightBar(dataUrl), tab.url, tab.title);
}

// ---- trim the blank vertical tail (worker-side, full-page only) ----------
function blobToDataURL(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  });
}
async function trimBlankVertical(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y) => (y * W + x) * 4;
    const bg = [data[0], data[1], data[2]];
    const TOL = 12, STRIDE = Math.max(1, Math.floor(W / 400));
    const off = (i) => Math.abs(data[i] - bg[0]) > TOL ||
                       Math.abs(data[i + 1] - bg[1]) > TOL ||
                       Math.abs(data[i + 2] - bg[2]) > TOL;
    // Mark each row blank (entirely background) or not.
    const blank = new Uint8Array(H);
    for (let y = 0; y < H; y++) {
      let has = false;
      for (let x = 0; x < W; x += STRIDE) { if (off(at(x, y))) { has = true; break; } }
      blank[y] = has ? 0 : 1;
    }
    // Walk row-runs. Keep content as-is; shorten blank runs: edges → a hair,
    // big interior gaps → a small consistent gap, small gaps → left alone.
    const EDGE = 8, GAP = 44, BAND = 150; // device px
    const keep = [];
    for (let y = 0; y < H;) {
      const b = blank[y]; let e = y; while (e < H && blank[e] === b) e++;
      const len = e - y;
      if (!b) keep.push({ y, h: len });
      else {
        const isEdge = (y === 0 || e === H);
        const t = Math.min(len, isEdge ? EDGE : (len > BAND ? GAP : len));
        if (t > 0) keep.push({ y, h: t });
      }
      y = e;
    }
    const outH = keep.reduce((s, k) => s + k.h, 0);
    if (outH >= H - 2 || outH < 16) return dataUrl; // nothing worth collapsing
    const out = new OffscreenCanvas(W, outH);
    const octx = out.getContext("2d");
    let dy = 0;
    for (const k of keep) { octx.drawImage(c, 0, k.y, W, k.h, 0, dy, W, k.h); dy += k.h; }
    const b2 = await out.convertToBlob({ type: "image/png" });
    return (await blobToDataURL(b2)) || dataUrl;
  } catch (e) { return dataUrl; }
}

// Detect and crop a vertical scrollbar baked into the RIGHT edge of the final
// image — works no matter how the page drew it (native, overlay, or a library
// div), by reading pixels. A scrollbar is a NARROW vertical strip near the right
// that stands out from the page background (light bar on a dark page, or vice
// versa). We find that strip and crop from its left edge to the image edge.
// Requires a genuinely narrow strip (≤ ~34px) separated from content, so
// scrollbar-less grabs and real content are left untouched.
async function cropRightBar(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    if (W < 80 || H < 80) return dataUrl;
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const lum = (x, y) => { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    const rs = Math.max(1, Math.floor(H / 400));
    const region = Math.min(Math.round(W * 0.20), 300); // only inspect the right strip

    // Background luminance = median of the right region (dominates over the bar).
    const samples = [];
    for (let x = W - region; x < W; x += 2) for (let y = 0; y < H; y += rs * 3) samples.push(lum(x, y));
    samples.sort((a, b) => a - b);
    const bg = samples[Math.floor(samples.length / 2)];

    // Fraction of a column's height that stands out from the background.
    const frac = (x) => { let n = 0, tot = 0; for (let y = 0; y < H; y += rs) { tot++; if (Math.abs(lum(x, y) - bg) > 45) n++; } return n / tot; };

    // Rightmost contiguous band of "bar-like" columns (a tall bright/dark strip).
    let right = -1, left = -1, gap = 0;
    for (let x = W - 1; x >= W - region; x--) {
      if (frac(x) >= 0.15) { if (right < 0) right = x; left = x; gap = 0; }
      else if (right >= 0) { if (++gap > 4) break; }
    }
    if (right < 0) return dataUrl;                // no bar
    const barW = right - left + 1;
    if (barW < 3 || barW > 34) return dataUrl;     // not a scrollbar-shaped strip
    if (left <= 0 || left >= W) return dataUrl;

    const c2 = new OffscreenCanvas(left, H);       // keep everything left of the bar
    c2.getContext("2d").drawImage(c, 0, 0, left, H, 0, 0, left, H);
    const b2 = await c2.convertToBlob({ type: "image/png" });
    return (await blobToDataURL(b2)) || dataUrl;
  } catch (e) { return dataUrl; }
}

// Post-process a finished full-page grab: trim the scrollbar, then blank bands.
async function finishImage(dataUrl) {
  return await trimBlankVertical(await cropRightBar(dataUrl));
}

// ---- full-page capture (scroll-and-stitch, injected into the page) -------
// Handles a scrolling document AND an inner scroll panel (dashboards/SPAs).
// It posts the finished image back with chrome.runtime.sendMessage rather than
// returning it, so it doesn't depend on executeScript awaiting a promise (some
// managed/older Chrome builds don't) — the worker completes the hand-off.
// Shows a small on-page badge so you can see it working.
async function scrollStitchCapture() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const done = (dataUrl, mode) => { try { chrome.runtime.sendMessage({ type: "full-result", dataUrl: dataUrl || null, mode: mode || "" }); } catch (e) {} };

  // little progress badge
  const badge = document.createElement("div");
  badge.textContent = "Snappy Frame — capturing…";
  badge.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;background:#111;color:#fff;" +
    "font:600 12px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;padding:8px 12px;border-radius:9px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none;opacity:.96";
  // Hide every scrollbar for the duration of the capture so none is baked into
  // the tiles. Content reflows to use the freed width — cleaner than cropping.
  const sbStyle = document.createElement("style");
  sbStyle.textContent = "*{scrollbar-width:none !important}*::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important}";
  try { document.documentElement.appendChild(badge); document.documentElement.appendChild(sbStyle); } catch (e) {}
  const setPct = (p) => { try { badge.textContent = "Snappy Frame — capturing " + Math.min(99, Math.round(p)) + "%"; } catch (e) {} };
  const cleanup = () => { try { badge.remove(); } catch (e) {} try { sbStyle.remove(); } catch (e) {} };

  try {
    await sleep(60); // let the no-scrollbar reflow settle before measuring
    const de = document.documentElement, body = document.body;
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    const MAX = 16384;

    // Hide library/overlay scrollbars that are drawn as their OWN element
    // (a narrow, tall, positioned div) — overflow:hidden can't touch those.
    const hideBars = (root) => {
      const out = [];
      if (!root) return out;
      for (const el of root.querySelectorAll("*")) {
        const w = el.offsetWidth, h = el.offsetHeight;
        if (w > 0 && w <= 18 && h >= vh * 0.25) {
          const cs = getComputedStyle(el);
          if ((cs.position === "absolute" || cs.position === "fixed" || cs.position === "sticky") && cs.visibility !== "hidden") {
            out.push([el, el.style.visibility]); el.style.visibility = "hidden";
          }
        }
      }
      return out;
    };

    const tile = async () => {
      // Hide our own badge for the shot so it isn't stamped into the image.
      badge.style.visibility = "hidden";
      await sleep(32); // let the hidden state paint before capturing
      let resp = null;
      try { resp = await chrome.runtime.sendMessage({ type: "capture-tile" }); } catch (e) {}
      badge.style.visibility = "visible";
      if (!resp || !resp.dataUrl) return null;
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.onerror = res; img.src = resp.dataUrl; });
      return img;
    };

    // Find an inner scroll panel if the document itself doesn't scroll.
    let scroller = null;
    if (!(de.scrollHeight > de.clientHeight + 4) && body) {
      let best = null, bestOver = 0; const vpArea = vw * vh;
      for (const el of body.querySelectorAll("*")) {
        const over = el.scrollHeight - el.clientHeight;
        if (over <= 40) continue;
        const cs = getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.4 || r.width * r.height < vpArea * 0.2) continue;
        if (over > bestOver) { best = el; bestOver = over; }
      }
      scroller = best;
    }

    if (scroller) {
      // Force the panel's overflow hidden for the capture: no scrollbar of any
      // kind is painted (beats overlay/library scrollbars that ignore CSS),
      // yet scrollTop still moves the content. Restored when we're done.
      const savedOv = scroller.style.overflow, savedOvY = scroller.style.overflowY;
      scroller.style.overflow = "hidden";
      await sleep(40); // let the reclaimed scrollbar gutter reflow
      const barsHidden = hideBars(scroller.parentElement || scroller);
      const cs2 = getComputedStyle(scroller);
      const bl = parseFloat(cs2.borderLeftWidth) || 0, bt = parseFloat(cs2.borderTopWidth) || 0;
      const r = scroller.getBoundingClientRect();
      // clientWidth/clientHeight exclude the scrollbars AND borders — so using
      // them as the crop box drops the scrollbar out of every tile.
      const sx = Math.max(0, Math.floor(r.left + bl));
      const sy = Math.max(0, Math.floor(r.top + bt));
      const sw = Math.max(1, Math.min(scroller.clientWidth, vw - sx));
      const sh = Math.max(1, Math.min(scroller.clientHeight, vh - sy));
      const total = Math.min(scroller.scrollHeight, Math.floor(MAX / dpr));
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(Math.round(sw * dpr), MAX);
      canvas.height = Math.min(Math.round(total * dpr), MAX);
      const ctx = canvas.getContext("2d");
      const startTop = scroller.scrollTop;
      const hidden = [];
      let first = true, y = 0, guard = Math.ceil(total / sh) + 4;
      while (guard-- > 0) {
        scroller.scrollTop = y;
        await sleep(first ? 280 : 170);
        const realY = scroller.scrollTop; // clamped at the bottom
        if (first) {
          for (const el of scroller.querySelectorAll("*")) {
            const cs = getComputedStyle(el);
            if ((cs.position === "sticky" || cs.position === "fixed") && cs.visibility !== "hidden" && el.offsetHeight > 0) {
              hidden.push([el, el.style.visibility]); el.style.visibility = "hidden";
            }
          }
        }
        const img = await tile();
        if (img) ctx.drawImage(img, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, Math.round(realY * dpr), sw * dpr, sh * dpr);
        setPct((realY + sh) / total * 100);
        first = false;
        if (realY + sh >= total) break;
        let next = y + sh; if (next <= realY) next = realY + sh;
        if (next === y) break;
        y = next;
      }
      for (const [el, v] of hidden) el.style.visibility = v;
      for (const [el, v] of barsHidden) el.style.visibility = v;
      scroller.style.overflow = savedOv; scroller.style.overflowY = savedOvY;
      scroller.scrollTop = startTop;
      cleanup();
      return done(canvas.toDataURL("image/png"), "inner");
    }

    // Document scroller: whole-viewport tiles stacked by scroll position.
    const totalH = Math.max(de.scrollHeight, body ? body.scrollHeight : 0, vh);
    // de.clientWidth excludes the window's vertical scrollbar → crops it out.
    const cw = Math.min(de.clientWidth || vw, Math.max(de.scrollWidth, body ? body.scrollWidth : 0, vw));
    const capH = Math.min(totalH, Math.floor(MAX / dpr));
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(Math.round(cw * dpr), MAX);
    canvas.height = Math.min(Math.round(capH * dpr), MAX);
    const ctx = canvas.getContext("2d");
    const startX = window.scrollX, startY = window.scrollY;
    const barsHidden = hideBars(document.body);
    const hidden = []; let first = true;
    for (let y = 0; y < capH; y += vh) {
      window.scrollTo(0, y);
      await sleep(first ? 250 : 180);
      if (first && body) {
        for (const el of body.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          if ((cs.position === "fixed" || cs.position === "sticky") && cs.visibility !== "hidden" && el.offsetHeight > 0) {
            hidden.push([el, el.style.visibility]); el.style.visibility = "hidden";
          }
        }
      }
      const img = await tile();
      if (img) ctx.drawImage(img, 0, 0, Math.round(cw * dpr), Math.round(vh * dpr), 0, Math.round(window.scrollY * dpr), Math.round(cw * dpr), Math.round(vh * dpr));
      setPct((y + vh) / capH * 100);
      first = false;
      if (y + vh >= capH) break;
    }
    for (const [el, v] of hidden) el.style.visibility = v;
    for (const [el, v] of barsHidden) el.style.visibility = v;
    window.scrollTo(startX, startY);
    cleanup();
    return done(canvas.toDataURL("image/png"), "document");
  } catch (e) {
    cleanup();
    return done(null, "error");
  }
}

async function captureFull(tab) {
  tab = tab || (await activeTab());
  if (!tab || !tab.id) return;
  // Can't script chrome:// / the extensions gallery — fall back to visible.
  if (!/^https?:/i.test(tab.url || "")) return captureVisible(tab);
  try {
    // The injected function reports its result via a 'full-result' message,
    // which the onMessage handler turns into the hand-off. If injection itself
    // fails (blocked page), fall straight back to a visible grab.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollStitchCapture });
  } catch (e) {
    console.error("Snappy Frame: full-page injection failed", e);
    await captureVisible(tab);
  }
}

// ---- right-click an image ------------------------------------------------
async function grabImage(src) {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    try {
      const onpage = [...document.images].find((i) => i.currentSrc === src || i.src === src);
      const img = onpage || Object.assign(new Image(), { crossOrigin: "anonymous", src });
      if (img.decode) { try { await img.decode(); } catch (e2) {} }
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    } catch (e3) { return null; }
  }
}

// ---- wiring --------------------------------------------------------------
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "capture-visible") captureVisible().catch((e) => console.error(e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "capture-tile") {
    const winId = sender.tab ? sender.tab.windowId : undefined;
    throttledCapture(winId).then((dataUrl) => sendResponse({ dataUrl })).catch(() => sendResponse({ dataUrl: null }));
    return true;
  }
  if (msg.type === "full-result") {
    // Completion of an injected full-page capture. Stateless on purpose so it
    // survives a service-worker restart mid-capture.
    const tab = sender.tab;
    (async () => {
      if (msg.dataUrl) await handoff(await finishImage(msg.dataUrl), tab && tab.url, tab && tab.title);
      else if (tab) await captureVisible(tab); // capture produced nothing — at least grab the view
    })();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "capture-visible") { captureVisible().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }
  if (msg.type === "capture-full") { captureFull().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "snappy-image", title: "Send image to Snappy Frame", contexts: ["image"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "snappy-image" || !info.srcUrl || !tab || !tab.id) return;
  try {
    const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabImage, args: [info.srcUrl] });
    const dataUrl = inj && inj.result;
    if (dataUrl && dataUrl.startsWith("data:image/")) await handoff(dataUrl, tab.url, tab.title);
    else console.warn("Snappy Frame: couldn't read that image (cross-origin?)");
  } catch (e) {
    console.error("Snappy Frame: image grab failed", e);
  }
});
