# Snappy Snap — every shortcut

Version 0.27.0. Everything in the first table is editable in **Settings…**
(tray icon → Settings). The rest are fixed.

On a Mac build, `Ctrl` means `Cmd`.

---

## Global hotkeys

These work from anywhere, whatever app you are in.

| Shortcut | What it does |
|---|---|
| `Ctrl+Shift+1` | **Region** — freeze the screen and drag a rectangle |
| `Ctrl+Shift+2` | **Active window** — grab the focused window, no dragging |
| `Ctrl+Shift+3` | **Mark up** — drag a region, then draw on it before it is copied |
| `Ctrl+Shift+4` | **Terminal text** — the focused terminal's whole scrollback, as text, keys masked |
| `Ctrl+Shift+5` | **Batch** — collect several grabs, then hand them over together |
| `Ctrl+Shift+6` | **Whole screen** — the screen your cursor is on, no rectangle |
| `Ctrl+Shift+O` | **Copy text** — OCR a region straight to the clipboard |
| `Ctrl+Shift+P` | **Pin** — float a region on top as a reference |
| `Ctrl+Shift+S` | **Session shelf** — show or hide the strip of recent snaps |
| `Ctrl+Shift+Space` | **Capture bar** — show or hide the floating bar |
| *not set* | **All monitors** — every screen stitched into one image |
| *not set* | **Idea board** — a region pinned straight to your AI Launchpad board |
| *not set* | **Google Photos** — a region uploaded straight to your Photos library |

The last three have no default because they are not wanted by everyone. Give
them a shortcut in Settings if you want them.

For a wallpaper or a cheat sheet, [SHORTCUTS-LIST.txt](SHORTCUTS-LIST.txt) has
the same hotkeys as plain name-and-keys pairs, ready to paste.

---

## While you are dragging a region

| Shortcut | What it does |
|---|---|
| *drag* | Draw the rectangle |
| `Space` *(hold)* | Slide the whole rectangle without resizing it |
| `Z` | Hide or show the pixel magnifier for this grab |
| `Esc` | Cancel |

### If "Adjust the region before capturing" is on

The rectangle stays live when you let go, instead of capturing immediately.

| Shortcut | What it does |
|---|---|
| `Enter` | Capture what is shown |
| *double-click inside* | Capture what is shown |
| *drag inside the box* | Move it |
| *drag a handle* | Resize from that edge or corner |
| `Ctrl` + *drag a corner* | Resize, keeping the proportions |
| `←` `→` `↑` `↓` | Move by one pixel |
| `Alt` + arrows | Move by ten pixels |
| `Shift` + arrows | Resize by one pixel |
| `Ctrl+Shift` + arrows | Resize about the centre, two pixels |
| *click outside the box* | Start a fresh rectangle |
| `Esc` | Cancel |

---

## The capture bar

| Shortcut | What it does |
|---|---|
| `1` … `9`, then `0` | Pick a mode, left to right; `0` is the tenth |
| `Enter` | Capture in the current mode |
| *double-click a mode* | Pick it and capture at once |
| `Esc` | Close the bar, or close the Options menu if it is open |

The modes in order: region, window, whole screen, mark up, terminal, copy text,
pin, batch, then idea board and Google Photos.

The last two only appear once you have set them up, so the numbers for
everything else never move.

---

## The mark-up editor

### Tools

| Key | Tool |
|---|---|
| `P` | Pencil, freehand |
| `L` | Line — `Shift` snaps to 45° |
| `A` | Arrow — `Shift` snaps to 45° |
| `B` | Box — `Shift` for a square |
| `F` | Filled box |
| `O` | Ellipse — `Shift` for a circle |
| `H` | Highlighter |
| `T` | Text |
| `N` | Numbered step — click to drop 1, 2, 3… |
| `M` | Pixelate |
| `X` | Blur / redact |
| `V` | Move and select |
| `I` | Eyedropper — click a pixel to take its colour |

### Everything else

| Shortcut | What it does |
|---|---|
| *mouse wheel* | Step the line thickness up or down |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| `Delete` or `Backspace` | Remove the selected shape |
| `←` `→` `↑` `↓` | Nudge the selected shape by one pixel |
| `Shift` + arrows | Nudge by ten pixels |
| `Enter` | Copy and done |
| `Esc` | Cancel, or cancel the eyedropper if it is armed |

A shape is selected the moment you place it, so you can nudge it straight away
without switching to the move tool. Numbered steps renumber themselves when you
delete one.

Finish buttons: **Photos** uploads it to Google Photos, **Board** pins it to
your idea board, **Pin** floats it on top,
**Link** uploads it and copies a seven-day URL, **Beautify** opens it in Snappy
Frame, **Copy & Done** copies and saves.

---

## A pinned image

| Shortcut | What it does |
|---|---|
| *mouse wheel* | Resize it |
| `+` or `=` | Bigger |
| `-` | Smaller |
| `0` | Back to full size |
| `F` | Dim it so you can read through it |
| `Ctrl+C` | Copy it |
| `Esc` | Close it |
| *drag anywhere* | Move it |

---

## The session shelf

Mouse only.

| Action | What it does |
|---|---|
| *drag a thumbnail out* | Drop the real file into any app that takes one |
| *drag the header* | Move the shelf, including onto another monitor |
| *double-click a thumbnail* | Show that file in Explorer |
| *right-click a thumbnail* | Share link, copy, pin on top, send to idea board, upload to Google Photos, open with, show in folder, remove |
| *middle-click a thumbnail* | Remove it from the shelf |
| **S** button | Cycle the thumbnail size: small, medium, large |
| 🔓 button | Lock the shelf so it cannot be dragged |
| 🗑 button | Clear the shelf |
| ▸ button | Hide it |

---

## The combine window

Tray → **Combine images…**. Mouse only.

| Action | What it does |
|---|---|
| *click a tile* | Tick it; the badge shows its place in the order |
| *click it again* | Untick it, and the rest renumber |
| **Layout** | Column, row or grid |
| **Columns** | Grid only; empty means it picks for you |
| **Sizes** | Native never rescales; Match lines them all up |
| **Gap** / **Border** | Space between the images, and around them |
| **Background** | White, dark, or none for transparency |
| **Add files…** | Bring in an image the shelf does not have |
| **Copy** | The combined image to the clipboard |
| **Save & add to shelf** | A new PNG in your save folder; the sources are untouched |

---

## Command line

Launching the app again does not start a second copy. It hands the command to
the one in your tray, which performs the capture.

```
"Snappy Snap.exe" --region                      # the marquee (also the default)
"Snappy Snap.exe" --window                      # the active window
"Snappy Snap.exe" --screen                      # the screen under the cursor
"Snappy Snap.exe" --all                         # every monitor, stitched
"Snappy Snap.exe" --markup                      # region, then the editor
"Snappy Snap.exe" --ocr                         # region, as text
"Snappy Snap.exe" --pin                         # region, floated on top
"Snappy Snap.exe" --batch                       # region, added to the batch
"Snappy Snap.exe" --board                       # region, pinned to the idea board
"Snappy Snap.exe" --photos                      # region, uploaded to Google Photos
"Snappy Snap.exe" --bar                         # show or hide the capture bar
"Snappy Snap.exe" --shelf                       # show or hide the shelf
```

Add any of these to a capture:

```
--delay 3000              wait three seconds first (up to 60000)
--path "D:\Shots"         save this one somewhere else (implies saving)
--clipboard               copy it, whatever the setting says
--no-clipboard            do not copy it
--save / --no-save        force saving on or off for this capture
```

Options with no mode still mean *capture a region*. Unknown flags are ignored,
and launching with no flags at all just starts the app.

---

## Filename tokens

For the **File name** box in Settings. Anything else you type is kept as it is.

| Token | Example |
|---|---|
| `{date}` | 2026-09-15 |
| `{time}` | 16.05.09 |
| `{datetime}` | 2026-09-15 16.05.09 |
| `{year}` `{month}` `{day}` | 2026 · 09 · 15 |
| `{hour}` `{minute}` `{second}` | 16 · 05 · 09 |
| `{app}` | Chrome — window grabs only |
| `{width}` `{height}` | 1920 · 1080 |

Leave the box empty for the built-in naming.
