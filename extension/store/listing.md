# Chrome Web Store listing — Snappy Frame

Copy-paste these into the Web Store Developer Dashboard when you submit
`snappy-frame-extension.zip` (Manifest V3, version 1.3.10).

## Basics

- **Name** (max 45 chars): `Snappy Frame — Screenshot Beautifier`
- **Category**: Productivity  *(alt: Photos)*
- **Language**: English

## Summary (short description, max 132 chars)

> Capture any browser tab — visible area or full page — and turn it into a
> share-ready screenshot with backgrounds, frames and 3D tilt.

## Detailed description

> ⚠️ **Rewritten after a "Keyword spam" rejection** (2026-07). The previous copy
> listed many social-platform brand names in a row, which reviewers read as
> keyword stuffing. This version describes features in plain prose with no
> stacked brand-name or comma-separated keyword lists. Paste it verbatim.

> **Snappy Frame turns plain screenshots into polished, share-ready images —
> right in your browser.**
>
> Open the toolbar menu to capture the current tab — either the visible area or
> the whole scrolling page — and it opens instantly in Snappy Frame with your
> screenshot loaded and ready to edit. You can also press a keyboard shortcut to
> grab the visible area, or right-click any image on a page to send it straight
> to the editor.
>
> **Capturing:**
> • Grab just what's on screen, or stitch the entire scrolling page into one tall
>   image — including dashboards and web apps whose inner panel scrolls.
> • The page address is dropped into a browser-style frame automatically, so it's
>   share-ready the moment it opens.
>
> **Beautifying:**
> • Place your screenshot on a beautiful background — a gradient, a mesh gradient,
>   a solid colour, your own wallpaper, or transparent.
> • Wrap it in a realistic window frame, or a laptop, phone or tablet mockup.
> • Give it depth with a soft shadow and a real 3D perspective tilt.
> • Add subtle background patterns, padding, rounded corners, a border, or film grain.
> • Choose a canvas size that fits wherever you plan to post it, or set your own.
> • Mark it up with arrows, numbered steps and captions, or blur out anything private.
> • Save a look you like and reuse it in one click.
> • Export a crisp PNG or JPEG in high resolution, or copy it straight to your clipboard.
>
> Everything runs in your browser. No account, no uploads, no watermark — your
> screenshot only ever moves between your browser and the Snappy Frame page.

## Support (Web Store "Support" tab)

- **Support URL**: `https://github.com/rendez2k/snappy-frame/issues/new/choose`
- **Support email**: your verified publisher contact email.

The repo is public, so anyone can file a bug report at that URL.

## Privacy

- **Single purpose**: Capture the current browser tab (or a chosen image) and
  open it in Snappy Frame for editing.
- **Data use**: The captured image is stored briefly in local extension storage
  and handed to the Snappy Frame page you open. Nothing is sent to any server;
  no analytics, no tracking.

### Permission justifications (paste into the matching fields)

- **activeTab** — capture the current tab's contents when you click the icon,
  press the shortcut, or use the right-click item. Grants access only to the tab
  you're acting on, only at that moment.
- **storage** — briefly hold the captured image (and the page's URL/title) so the
  Snappy Frame companion page can pick it up when it opens.
- **scripting** — inject the capture routine into the page: for a full-page grab
  it scrolls the page and stitches the frames together; for the right-click item
  it reads the chosen image into a PNG. No remotely-hosted code is used.
- **contextMenus** — add the "Send image to Snappy Frame" option to the
  right-click menu on images.
- **host permission (`snappy-frame.netlify.app`)** — so the companion editor page
  can receive the captured screenshot handed to it.

**No `debugger`, no broad host permissions, no remote code.**

## Assets in this folder

| File | Use in listing |
|------|----------------|
| `../icons/128.png` | Store icon (128×128) |
| `small-tile-440x280.png` | Small promo tile (440×280) |
| `marquee-1400x560.png` | Marquee promo tile (1400×560, optional/featured) |
| `shot-1-editor.png` | Screenshot 1 — the editor (1280×800) |
| `shot-2-flow-1280x800.png` | Screenshot 2 — capture → beautify flow |
| `shot-3-styles-1280x800.png` | Screenshot 3 — styles overview |

## Submit checklist

1. Zip is `snappy-frame-extension.zip` — Manifest V3, version **1.3.10**
   (manifest, background.js, popup.html/js, content.js, icons/). It must NOT
   contain the `store/` promo assets or the README.
2. Upload at <https://chrome.google.com/webstore/devconsole>.
3. Paste the name / summary / description above.
4. Upload the icon, at least one 1280×800 screenshot, and (optionally) the tiles.
5. Fill the Privacy tab: single purpose + the five permission justifications above.
6. Submit for review.

## Note on the update

This is an **update** to the existing published item (auto-fill of the tab URL,
full-page capture, keyboard shortcut, right-click image). Bump is handled by the
manifest `version` (1.3.10). Reviewers will re-check the new `scripting` and
`contextMenus` permissions — the justifications above cover them.
