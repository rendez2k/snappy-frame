# Snappy Frame — Capture (Chrome extension)

A tiny companion extension: click the toolbar icon to **capture the current tab**
and open it straight in [Snappy Frame](https://snappy-frame.netlify.app/), image
already loaded and ready to beautify.

## How it works

1. You click the extension's toolbar icon.
2. The background service worker captures the **visible area** of the active tab
   (`chrome.tabs.captureVisibleTab`) and stashes the PNG in `chrome.storage.local`.
3. It opens a new tab at `https://snappy-frame.netlify.app/`.
4. A content script on that page reads the stashed screenshot and hands it to the
   app via `window.postMessage({ type: "snappy-frame-image", dataUrl })`, which
   Snappy Frame listens for and loads.

No servers, no tracking — the screenshot only ever moves between your browser and
the Snappy Frame page you already have open.

## Install (unpacked, for personal use)

1. Open `chrome://extensions` in Chrome or Edge.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **Snappy Frame — Capture** icon to your toolbar.
5. Visit any page, click the icon — Snappy Frame opens with the screenshot loaded.

## Notes & limits

- Captures the **visible viewport** only (what's on screen). Full-page stitched
  capture is a possible future addition.
- Permissions are intentionally minimal: `activeTab` (granted only when you click
  the icon) and `storage`, plus host access limited to `snappy-frame.netlify.app`.
- To point at a different deployment, change `APP_URL` in `background.js` and the
  `host_permissions` / `content_scripts.matches` in `manifest.json`.

## Report a bug

Open an issue: <https://github.com/rendez2k/snappy-frame/issues/new/choose>
(the app also has a "Tell us on GitHub" link in the Export panel).

