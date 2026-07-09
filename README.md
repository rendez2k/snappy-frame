# Snappy

A free, browser-based **screenshot beautifier** — drop in a plain screenshot and
wrap it in a gorgeous background, padding, rounded corners, a soft shadow, a 3D
tilt and a window frame, then export a high-resolution PNG/JPEG. Inspired by
tools like [pika.style](https://pika.style). Everything runs client-side; no
upload, no account, no server.

## Features

- **Import** — upload, drag &amp; drop, paste from clipboard (⌘/Ctrl+V), or
  capture your screen live (`getDisplayMedia`).
- **Backgrounds** — curated gradients, mesh gradients, solid colour, your own
  wallpaper image (with blur), or transparent (exports PNG with alpha).
- **Frames** — macOS window (light/dark) with a title, or a browser chrome with
  a URL bar and traffic-light buttons.
- **Layout** — auto-fit or fixed aspect ratios (1:1, 4:3, 16:9, 9:16, 2:1,
  OG image, …), image size, padding and corner radius.
- **Shadow** — presets (soft/medium/large/glow) plus manual blur, distance and
  opacity.
- **3D tilt** — rotate X/Y/Z with real perspective; the canvas auto-resizes so a
  tilted card is never clipped.
- **Border** and **film-grain / noise** overlay.
- **Export** — PNG or JPEG at 1×–4× resolution, download or copy straight to the
  clipboard.

## Running it

It's a single static page — just open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

There is **no build step** and no runtime CDN dependency: the one library used
for rasterising the DOM ([`html-to-image`](https://github.com/bubkoo/html-to-image))
is vendored under `vendor/` so the app works fully offline.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | The whole app — markup, CSS and JS in one file |
| `vendor/html-to-image.js` | Pinned copy of the DOM-to-PNG rasteriser |
| `smoke.mjs` | Playwright smoke test (boot, load image, export) |

## Tests

```bash
npm i --no-save playwright html-to-image
node smoke.mjs
```

(Uses the system Chromium via `executablePath` — adjust for your environment.)
