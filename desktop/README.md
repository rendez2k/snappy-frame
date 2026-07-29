# Snappy Snap

A tiny Windows tray app for **rapid marquee screen capture**. Press a hotkey,
drag a rectangle, and the crop is instantly **saved to a folder and copied to
your clipboard** — no frame, no faff. Or flip to **Beautify** mode to open the
snap straight in [Snappy Frame](https://snappy-frame.netlify.app).

Built with Electron, so it reuses the Snappy Frame web stack.

## Run it (dev)

You need [Node.js](https://nodejs.org) (LTS is fine).

```bash
cd snappy-snap
npm install
npm start
```

An icon appears in the **system tray** (bottom-right, near the clock). That's it —
there's no main window by design.

- **Press `Ctrl+Shift+1`** (default) anywhere → the screen under your cursor
  freezes → **drag a rectangle** → release. Done.
- **`Esc`** cancels.
- **Left-click the tray icon** to capture without the hotkey.
- **Right-click the tray icon** for the menu: switch mode, toggle
  clipboard/folder, open the save folder, Settings, Quit.

Snaps land in **Pictures → Snappy Snaps** by default, named `snap-<timestamp>.png`.

## Two modes

- **⚡ Raw — no frame** (default): save a PNG + copy to clipboard, instantly. This
  is the "rapid export" flow.
- **✨ Beautify**: opens the crop in Snappy Frame (loaded via the same hand-off
  the browser extension uses) so you can add a background, frame, shadow, etc.

Switch in the tray menu or in **Settings…** (hotkey, save folder, what happens on
capture, notifications).

## Build a real installer

```bash
npm run dist        # produces a Windows installer in dist/ via electron-builder
```

Run this **on Windows** (electron-builder targets the OS it runs on). The NSIS
installer is one-click, per-user.

## Notes & limits (MVP)

- Captures the display **under the cursor**. Multi-monitor spanning selections
  aren't supported yet — snap within one screen.
- Coordinates are normalised, so it's correct on **high-DPI / scaled** displays.
- **Everything stays on your PC.** Nothing is uploaded. (The "online inbox"
  option — send snaps to a web inbox — is a planned phase 2; this build is
  folder + clipboard only.)
- Beautify opens the hosted Snappy Frame; point it at a local build by changing
  `beautifyUrl` in Settings' JSON (`%APPDATA%/snappy-snap/settings.json`) if you
  ever want it fully offline.

## What's next (phase 2 ideas)

- **Online inbox** — a "Send to inbox" action + a web `/inbox` that shows snaps
  as they arrive (Supabase or Netlify + R2, with a pairing code).
- Delayed / window / full-screen capture modes.
- A small preview toast with quick actions (copy, open, discard, beautify).
- Auto-start on login.
