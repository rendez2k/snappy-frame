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
| *(set your own)* | **All monitors** — every screen stitched into one image, laid out as they sit on your desk |
| *(set your own)* | **Idea board** — a region pinned straight to your AI Launchpad board |
| *(set your own)* | **Google Photos** — a region uploaded straight to your Photos library |
| `Ctrl+Shift+3` | **Mark up** — grab a region, then draw on it: pencil, line, arrow, box, filled box, ellipse, highlighter, text, numbered steps, pixelate, blur; move/nudge/delete anything, undo/redo; finish to clipboard, Pin, a 7-day Link, or Beautify |
| `Ctrl+Shift+4` | **Terminal text** — the focused terminal's whole scrollback, as text |
| `Ctrl+Shift+5` | **Batch** — collect several grabs and hand them over together |
| `Ctrl+Shift+O` | **Copy text** — OCR a region straight to the clipboard |
| `Ctrl+Shift+P` | **Pin** — float a region on top as a reference |
| `Ctrl+Shift+S` | **Session shelf** — show/hide the strip of recent snaps |

`Esc` cancels a capture. All of them are editable in **Settings…**. Every other
shortcut — the region overlay, the capture bar, the mark-up editor, pins, the
shelf, the command line and the filename tokens — is in
[SHORTCUTS.md](SHORTCUTS.md).

## Things worth knowing

**While you drag a region**, a magnifier follows the cursor showing individual
pixels and the exact coordinate, so you can land an edge instead of guessing
through the dimming veil. Hold **Space** to slide the whole rectangle without
resizing it — the rescue for a drag started a few pixels off. **Z** hides the
magnifier for that grab; Settings has the permanent switch.

**Turn on "Adjust the region before capturing"** in Settings and the rectangle
stays live when you let go: drag its handles or the box itself, nudge with the
arrow keys (**Shift** resizes, **Ctrl+Shift** resizes about the centre, **Alt**
moves ten pixels at a time), **Ctrl**-drag a corner to keep the proportions, then
**Enter** or double-click to capture. Off by default, because capturing the
moment you release is faster when your aim was good.

**Name your files** with a template in Settings: `{date}` `{time}` `{datetime}`
`{year}` `{month}` `{day}` `{hour}` `{minute}` `{second}` `{app}` `{width}`
`{height}`. Anything else in the box is kept as typed, and Settings previews the
result as you type. Leave it empty for the built-in naming.

**Upload straight to Google Photos.** Google closed both folder-backup routes —
Drive for desktop stopped syncing to Photos on 10 August 2026, and the Photos
website's own folder backup only runs while that tab is open — so this talks to
the Photos API. Put your own Google client in Settings (the panel walks through
making one) and a hotkey, a bar button, **🖼 Photos** in the mark-up editor or a
shelf tile's right-click menu puts a capture in your library, in an album of
your choosing. The only scope requested is *append*: the app can add photos and
can see nothing else in your library. The sign-in is sealed with the Windows
keystore where that is available, and is never handed to any window of the app.

One trap worth knowing: while your Google consent screen says **Testing**,
Google expires the sign-in every seven days. Publish it and it lasts.

**Pin captures to your AI Launchpad.** Put your Launchpad's address and owner
passphrase in Settings and captures can go straight to its private idea board:
a whole capture mode, a button on the capture bar, **🧷 Board** in the mark-up
editor, and *Send to idea board* on a shelf tile. It signs in once and keeps the
week-long bearer token it gets back, exactly as the Launchpad's own browser
extension does, so nothing changes on that side. Oversized captures are stepped
down (and finally re-encoded as JPEG) to fit the board's 4 MB limit. Sending is
an upload, with the same caution as the inbox.

**Combine several images into one.** Tray → *Combine images…* lists everything
the shelf remembers, plus anything you add from disk. Tick them in the order you
want, choose a column, row or grid, and save. Native size never rescales
anything; Match lines them all up. The sources are untouched — the result is a
new PNG that lands on the shelf beside them, so every action that works on a
snap works on it too.

**Share links can be revoked.** Tray → *Share links…* lists every link this
computer has minted, when it was made and how long it has left. Revoking deletes
the image server-side, so the link dies for everyone holding it.

**The session shelf** has a **+** button: take a snap straight onto it without
reaching for a hotkey. Left-click takes a region; right-click offers every other
mode, and a way into the combine window. It holds everything you've captured. Drag a thumbnail
straight into Claude Desktop, Slack or an editor — it's a real OS file drag, not
a bitmap, so anything that accepts a dropped file accepts it. Right-click a tile
for a share link, a pin, **Open with…** (the Windows app chooser) or the folder.
Drag the shelf by its header to move it (including to another monitor),
**S/M/L** resizes the thumbnails, and the padlock pins it in place. Its contents
survive a restart.

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

## Command line

The app lives in the tray, so launching it again is a remote control rather than
a second copy: the running instance performs the capture and the new process
exits. That makes every mode scriptable, and bindable to whatever shortcut
manager you already use.

```
"Snappy Snap.exe" --region                      # the marquee (also the default)
"Snappy Snap.exe" --window                      # the active window
"Snappy Snap.exe" --screen                      # the screen under the cursor
"Snappy Snap.exe" --all                         # every monitor, stitched
"Snappy Snap.exe" --markup                      # region, then the editor
"Snappy Snap.exe" --ocr | --pin | --batch       # the other capture modes
"Snappy Snap.exe" --board                       # a region, pinned to the idea board
"Snappy Snap.exe" --photos                      # a region, uploaded to Google Photos
"Snappy Snap.exe" --bar | --shelf               # show/hide the bar or the shelf

"Snappy Snap.exe" --screen --delay 3000         # wait 3s first (max 60s)
"Snappy Snap.exe" --region --path "D:\Shots"    # save this one somewhere else
"Snappy Snap.exe" --region --clipboard --no-save
```

Options with no mode still mean *capture a region*. `--path` implies saving.
Unknown flags are ignored, and a launch with no flags at all just starts the app.

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
