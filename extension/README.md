# Snappy Frame — Capture (Chrome extension)

A tiny companion extension: grab the current tab — visible area **or the whole
scrolling page** — and open it straight in
[Snappy Frame](https://snappy-frame.netlify.app/), image already loaded and
ready to beautify.

## What it can do

- **📷 Capture visible area** — snap what's on screen right now.
- **📄 Capture full page** — scroll-and-stitch the whole page into one tall
  image. It handles both a scrolling document AND an inner scroll panel (common
  in dashboards/SPAs whose page itself doesn't scroll): it finds the real scroll
  container, scrolls that, and crops each frame to the panel so sidebars/headers
  aren't duplicated. Blank top/bottom space is trimmed automatically (full width
  kept, so the grab only gets shorter, never tiny). No debugger/DevTools
  permission — so it works in browsers managed by an organisation, which
  usually block that API.
- **⌨️ Keyboard shortcut** — `Ctrl+Shift+Y` (`⌘⇧Y` on Mac) grabs the visible
  area instantly, without opening the menu.
- **🖱️ Right-click an image** → *Send image to Snappy Frame*.
- **🔗 Auto-fills the frame** — the captured tab's URL drops into a browser
  frame (or the page title becomes the caption) so it's share-ready on arrival.

## How it works

1. You pick a capture mode from the toolbar popup (or press the shortcut).
2. The background service worker captures the tab. For a full page it injects a
   scroll-and-stitch routine that asks the worker to snap each viewport tile
   (`chrome.tabs.captureVisibleTab`, throttled) and composites them onto a canvas.
3. It opens a new tab at `https://snappy-frame.netlify.app/`.
4. A content script on that page reads the stashed screenshot from
   `chrome.storage.local` and hands it to the app via
   `window.postMessage({ type: "snappy-frame-image", dataUrl, url, title })`,
   which Snappy Frame listens for and loads.

No servers, no tracking — the screenshot only ever moves between your browser and
the Snappy Frame page.

## Install (unpacked, for personal use)

1. Open `chrome://extensions` in Chrome or Edge.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **Snappy Frame — Capture** icon to your toolbar.
5. Visit any page, click the icon (or press `Ctrl+Shift+Y`).

## Notes & limits

- Permissions are intentionally minimal: `activeTab` (granted only when you act
  on a page — icon click, shortcut or context menu), `storage`, `scripting`
  (for the full-page stitch and image grab), and `contextMenus`; host access is
  limited to `snappy-frame.netlify.app`.
- **Full-page capture** works on most pages, but very long pages are capped at
  the browser's ~16384px canvas limit, and unusual sticky/lazy-loaded layouts
  may need a second try — it hides `position:fixed`/`sticky` bars after the
  first tile and pauses between scrolls to let content settle.
- Right-click image grab is best-effort: some cross-origin images can't be read
  by the browser and will be skipped.
- It can't capture browser-internal pages (`chrome://`, the extensions gallery);
  full-page falls back to a visible grab there.
- To point at a different deployment, change `APP_URL` in `background.js` and the
  `host_permissions` / `content_scripts.matches` in `manifest.json`.

## Report a bug

Open an issue: <https://github.com/rendez2k/snappy-frame/issues/new/choose>
(the app also has a "Tell us on GitHub" link in the Export panel).
