# Snappy Frame — Google Play submission kit

Paste these into the Play Console when you set up the store listing.

## Assets (in this folder)
- `feature-graphic-1024x500.png` — **Feature graphic** (required, 1024×500).
- `play-1.png` … `play-3.png` — **Phone screenshots** (1080×1920). Play needs at least 2.
- App icon: use `../icon-512.png` (512×512) — Play's required icon size.

## Store listing
- **App name** (30 chars): `Snappy Frame`
- **Short description** (80 chars):
  `Turn plain screenshots into share-ready images — backgrounds, frames & more.`
- **Full description** (≤4000 chars):

> **Snappy Frame turns plain screenshots into polished, share-ready images — right on your phone.**
>
> Drop in a screenshot and wrap it in a beautiful background, a device mockup, a window frame, a soft shadow and a real 3D tilt — then save it straight to your gallery.
>
> What you can do:
> • Place your screenshot on a gradient, mesh, solid colour, your own wallpaper, or transparent.
> • Wrap it in a laptop, phone or tablet mockup, or a clean window frame.
> • Add depth with soft shadows and a 3D perspective tilt.
> • Mark it up with arrows, numbered steps and captions — or blur out anything private.
> • Add background patterns, padding, rounded corners, a border, or film grain.
> • Size it for wherever you're posting, or set a custom canvas.
> • Save your favourite looks and reuse them in one tap.
> • Export a crisp image and save it to your device.
>
> Everything runs on your device. No account, no uploads, no watermark — your screenshot never leaves your phone.

## Categorisation
- **App category**: Photography (alt: Art & Design)
- **Tags**: screenshot, mockup, photo editor, frame, background
- **Content rating**: complete the questionnaire → it will rate **Everyone** (no objectionable content).

## Contact details
- **Email**: your verified developer email.
- **Website** (optional): `https://snappy-frame.netlify.app`
- **Privacy Policy URL** (required): `https://snappy-frame.netlify.app/privacy.html`

## Data safety form (Play requires this)
Answer **"No data collected"** and **"No data shared"**:
- Does your app collect or share any of the required user data types? **No.**
- Is all user data encrypted in transit? (N/A — nothing is sent for core features; if
  asked, "Yes".)
- Do you provide a way for users to request deletion? (N/A — no data collected.)
> If you ship the optional "grab a webpage" feature, you may note that a URL the
> user types is sent to a third-party renderer; simplest is to leave that feature
> out of the mobile build (it's desktop-oriented).

## Release note (first version)
> First release: beautify screenshots with backgrounds, device mockups, frames,
> shadows, 3D tilt, markup and one-tap save.

## Build note
Publish an **Android App Bundle (.aab)** — Android Studio → **Build → Generate
Signed Bundle / APK → Android App Bundle**. Create a keystore the first time and
**keep it safe** — you cannot update the app without it.
