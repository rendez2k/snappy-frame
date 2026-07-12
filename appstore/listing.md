# Snappy Frame — App Store submission kit

Everything you need to paste into **App Store Connect** for the iOS build. The
app is a wrapper around the PWA; the animated (video) export auto-hides inside
Apple's WKWebView, so every visible feature works for the reviewer.

## Assets (in this folder / repo root)
- `../appstore-icon-1024.png` — 1024×1024 App Store icon (opaque, no alpha, square).
- `../appstore-1.png`, `../appstore-2.png`, `../appstore-3.png` — iPhone 6.7" screenshots (1290×2796).
  (Upload at least one 6.7" screenshot; Apple scales it for smaller devices.)

## App information
- **Name** (30 chars): `Snappy Frame`
- **Subtitle** (30 chars): `Beautify your screenshots`
- **Category**: Primary **Photo & Video**, Secondary **Productivity**
- **Age rating**: 4+ (no objectionable content)
- **Price**: Free (recommended — see the monetisation note below)

## Promotional text (170 chars, editable anytime)
> Turn plain screenshots into share-ready images — gorgeous backgrounds, device
> mockups, window frames, 3D tilt, markup and one-tap Save to Photos. All on-device.

## Description
> **Snappy Frame turns plain screenshots into polished, share-ready images —
> right on your iPhone.**
>
> Drop in a screenshot and wrap it in a beautiful background, a device mockup, a
> window frame, a soft shadow and a real 3D tilt — then save it straight to your
> Photos.
>
> **What you can do**
> • Place your screenshot on a gradient, mesh, solid colour, your own wallpaper, or transparent.
> • Wrap it in a laptop, phone or tablet mockup, or a clean window frame.
> • Add depth with soft shadows and a 3D perspective tilt.
> • Mark it up with arrows, numbered steps and captions — or blur out anything private.
> • Add background patterns, padding, rounded corners, a border, or film grain.
> • Size it for wherever you're posting, or set a custom canvas.
> • Save your favourite looks and reuse them in one tap.
> • Export a crisp image and save it straight to Photos.
>
> Everything runs on your device. No account, no uploads, no watermark — your
> screenshot never leaves your phone.

## Keywords (100 chars, comma-separated, no spaces)
`screenshot,mockup,frame,background,beautify,editor,markup,blur,device,gradient,photo,social,image`

## URLs
- **Support URL**: `https://github.com/rendez2k/snappy-frame/issues/new/choose`
- **Marketing URL** (optional): `https://snappy-frame.netlify.app`
- **Privacy Policy URL**: host a short one (a page on your site or a GitHub markdown). Sample text below.

## App Privacy ("nutrition label") — answers
Choose **"Data Not Collected"** for everything. The app has no accounts, no
analytics, and no network calls for the core features; images are processed
entirely on-device.
- Data used to track you: **No**
- Data linked to you: **None**
- Data not linked to you: **None**
> Note: the optional "grab a webpage by URL" feature sends only the URL you type
> to a screenshot service. If you keep that feature in the iOS build and it makes
> any network call, disclose "Browsing History → not linked" to be safe, or
> simply hide that feature in the wrapper (recommended for iOS).

## Sample privacy policy (host this and link it)
> **Snappy Frame Privacy Policy.** Snappy Frame does not collect, store, or share
> any personal data. Images you edit are processed entirely on your device and are
> never uploaded. The app has no accounts, no analytics, and no third-party
> tracking. Any API key you enter is stored only on your device. Contact:
> <your email>.

## App Review notes (paste into "Notes for Reviewer")
> Snappy Frame is a fully on-device screenshot beautifier. No login is required —
> tap "Choose image" (or paste) to load a screenshot, style it, and use Export →
> Save Image to save it to Photos. Everything works offline.

## Monetisation note
A paid-upfront App Store version competes with the free web app and usually
underperforms. Recommended: ship **free**, and if it gains traction add a **Pro**
tier (IAP) for extras (4K export, exclusive looks, no watermark) — charge for
features, not for the app.
