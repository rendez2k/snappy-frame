# Snappy Frame

A free, browser-based **screenshot beautifier** — drop in a plain screenshot and
wrap it in a gorgeous background, pattern, padding, rounded corners, a soft
shadow, a 3D tilt and a window frame, then export a high-resolution PNG/JPEG.
Inspired by tools like [pika.style](https://pika.style). Everything runs
client-side; no upload, no account, no server. Live at
<https://snappy-frame.netlify.app/>.

## Features

- **Import** — upload, drag &amp; drop, paste from clipboard (⌘/Ctrl+V), capture
  your screen live (`getDisplayMedia`), or one-click from the companion Chrome
  extension (see `extension/`).
- **Presets** — 30+ curated one-click looks, plus save/load your own to
  `localStorage`.
- **Backgrounds** — 30 gradients, 14 mesh gradients, solid colour, your own
  wallpaper image (with blur), or transparent (exports PNG with alpha).
- **Patterns** — dots, grid, waves, rings, cross, diagonal, checks, diamonds,
  chimes, harmony, confetti, sight — with light/dark ink, intensity, scale and
  rotation.
- **Frames** — None, Arc, Eclipse, Emotion, Ruler, Shortboard, macOS
  (dark/light/subtle/adaptive), Browser (dark/light), Windows (dark/light),
  Stack (light/dark), Silver/Shadow Back — most with an editable title/URL.
- **Layout** — auto-fit, fixed ratios, **social-media sizes** (Instagram,
  X/Twitter, Facebook, LinkedIn, YouTube, Pinterest, App Store…), or a custom
  W×H canvas; plus a 3×3 position picker, Fit/Fill crop with focal point, image
  size, padding and corner radius.
- **Shadow** — presets (soft/medium/large/glow) plus manual blur, distance and
  opacity.
- **3D tilt** — rotate X/Y/Z with real perspective; the canvas auto-resizes so a
  tilted card is never clipped.
- **Border** and **film-grain / noise** overlay.
- **Export** — PNG or JPEG at 1×–4× resolution, download or copy straight to the
  clipboard.
- **Mobile-friendly** — responsive layout with a bottom-sheet control panel.

## Chrome extension

`extension/` contains a Manifest V3 companion that captures the current tab and
opens it in Snappy Frame with the image preloaded. See `extension/README.md` to
install it unpacked.

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
