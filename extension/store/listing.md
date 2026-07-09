# Chrome Web Store listing — Snappy Frame

Copy-paste these into the Web Store Developer Dashboard when you submit
`snappy-frame-extension.zip`.

## Basics

- **Name** (max 45 chars): `Snappy Frame — Screenshot Beautifier`
- **Category**: Productivity  *(alt: Photos)*
- **Language**: English

## Summary (short description, max 132 chars)

> Capture any browser tab and turn it into a share-ready screenshot with
> beautiful backgrounds, frames, patterns and 3D tilt.

## Detailed description

> **Snappy Frame turns plain screenshots into share-ready images — right in your
> browser.**
>
> Click the toolbar icon to capture the current tab, and it opens instantly in
> Snappy Frame with your screenshot loaded and ready to beautify.
>
> **What you can do:**
> • Drop your screenshot on a gorgeous background — 30 gradients, 14 mesh
>   gradients, solid colours, your own wallpaper, or transparent.
> • Add a window frame — macOS, browser, Windows, Arc, Stack and more (18 styles).
> • Layer on a pattern — dots, grid, waves, diamonds, confetti and others.
> • Give it depth with soft shadows and real 3D perspective tilt.
> • Size it perfectly for social — Instagram, X/Twitter, Facebook, LinkedIn,
>   YouTube, Pinterest and App Store presets, or any custom canvas.
> • Fine-tune padding, rounded corners, borders and film grain.
> • Save your favourite looks as one-click presets.
> • Export a crisp PNG or JPEG at up to 4× resolution, or copy straight to your
>   clipboard.
>
> Everything runs client-side. No account, no uploads, no watermark — your
> screenshot only ever moves between your browser and the Snappy Frame page.
>
> **Permissions:** the extension only asks for `activeTab` (used the moment you
> click the icon) and `storage`, plus access limited to snappy-frame.netlify.app.

## Support (Web Store "Support" tab)

- **Support URL**: `https://github.com/rendez2k/snappy-frame/issues/new/choose`
- **Support email**: your verified publisher contact email.

The repo is public, so anyone can file a bug report at that URL.

## Privacy

- **Single purpose**: Capture the current browser tab and open it in Snappy Frame
  for editing.
- **Data use**: The captured image is stored briefly in local extension storage
  and handed to the Snappy Frame page you open. Nothing is sent to any server;
  no analytics, no tracking.
- **Host permission justification** (`snappy-frame.netlify.app`): needed so the
  companion page can receive the captured screenshot.
- **activeTab justification**: needed to capture the visible tab when you click
  the icon.

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

1. Zip is `snappy-frame-extension.zip` (Manifest V3, icons, background, content).
2. Upload at <https://chrome.google.com/webstore/devconsole> (one-time $5 fee).
3. Paste the name / summary / description above.
4. Upload the icon, at least one 1280×800 screenshot, and (optionally) the tiles.
5. Fill the Privacy tab using the section above; submit for review.
