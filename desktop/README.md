# Snappy Snap

A Windows tray app for **fast screen capture**. Press a hotkey, grab what you
need, and it lands on your clipboard and in a folder — or opens in
[Snappy Frame](https://snappy-frame.netlify.app) to be dressed up.

There's no main window by design: an icon sits in the system tray and everything
runs from hotkeys, the tray menu, or the floating capture bar.

Built with Electron, so it reuses the Snappy Frame web stack.

## Run it (dev)

You need [Node.js](https://nodejs.org) (LTS is fine).

```bash
cd snappy-snap
npm install
npm start
```

## The capture bar

**`Ctrl+Shift+Space`** brings up a floating bar with every mode as a button, an
Options menu and a self-timer — for when you'd rather see the choices than
remember a hotkey. `1`–`7` pick a mode, `Enter` captures, `Esc` dismisses.

The **timer** is the way to capture a menu or a hover state: those close the
moment anything else takes focus, so start the timer, open the menu, let it fire.

## Hotkeys

| Key | Mode |
|---|---|
| `Ctrl+Shift+1` | **Region** — freeze the screen, drag a rectangle |
| `Ctrl+Shift+2` | **Active window** — grab the focused window, no dragging |
| `Ctrl+Shift+6` | **Whole screen** — the screen your cursor is on, no rectangle to drag |
| `Ctrl+Shift+3` | **Mark up** — grab a region, then draw on it: pencil, line, arrow, box, filled box, ellipse, highlighter, text, numbered steps, pixelate, blur; move/nudge/delete anything, undo/redo; finish to clipboard, Pin, a 7-day Link, or Beautify |
| `Ctrl+Shift+4` | **Terminal text** — the focused terminal's whole scrollback, as text |
| `Ctrl+Shift+5` | **Batch** — collect several grabs and hand them over together |
| `Ctrl+Shift+O` | **Copy text** — OCR a region straight to the clipboard |
| `Ctrl+Shift+P` | **Pin** — float a region on top as a reference |
| `Ctrl+Shift+S` | **Session shelf** — show/hide the strip of recent snaps |

`Esc` cancels a capture. All of them are editable in **Settings…**.

## Things worth knowing

**The session shelf** holds everything you've captured. Drag a thumbnail
straight into Claude Desktop, Slack or an editor — it's a real OS file drag, not
a bitmap, so anything that accepts a dropped file accepts it. Drag the shelf by
its header to move it (including to another monitor), **S/M/L** resizes the
thumbnails, and the padlock pins it in place. Its contents survive a restart.

**Terminals are captured as text, not pixels.** A screenshot of a terminal is
how API keys end up pasted into a chat, and pixels can't be masked — so a window
grab of PowerShell/cmd/Windows Terminal reads the actual buffer instead (full
scrollback, sharper, secrets redacted). Region-snip a terminal with a key on
screen and you get a warning offering to recapture as masked text. The same
redaction applies to OCR output.

**Pins** float above everything. Scroll to resize, `F` to dim so you can read
what's underneath, `Esc` to close. Close them all from the tray.

**Snappy's own windows stay out of your shots** — the shelf, batch HUD and any
pins are hidden while a frame is taken, then restored.

**Captures complete before anything appears on screen.** Any window sliding
under the cursor dismisses tooltips and hover menus, so nothing is shown until
the frame is safely captured. That costs ~100–300ms of latency and is the
deliberate trade for hover-safe grabs.

## After a capture

Two modes, switchable in the tray or the bar's Options:

- **⚡ Raw — no frame** (default): save a PNG + copy to clipboard, instantly.
- **✨ Beautify**: opens the crop in Snappy Frame for a background, frame, shadow
  and the rest.

Snaps land in **Pictures → Snappy Snaps**, in a folder per day
(`2026-07-29 › Snap 16.15.26.png`). Window grabs also file under the app's name.
An optional **online inbox** can upload each snap to the web app — off by
default, and the only time an image leaves your PC.

## Build an installer

```bash
npm run dist        # Windows installer in dist/ via electron-builder
```

Run this **on Windows** — electron-builder targets the OS it runs on. The NSIS
installer is one-click, per-user. CI does this on every manual run of
`desktop-release.yml` and publishes the exe to a GitHub Release.

## Limits

- Captures the display **under the cursor**; a selection can't span monitors.
- Coordinates are normalised, so it's correct on **high-DPI / scaled** displays.
- **OCR** uses the engine built into Windows, so it needs an OCR language pack
  for your display language (most installs have one).
- **Terminal text** covers conhost windows and Windows Terminal; other terminal
  emulators fall back to a normal picture.
