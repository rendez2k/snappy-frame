# Snappy Frame — mobile (Capacitor) wrapper

This folder wraps the web app in a native iOS/Android shell using
[Capacitor](https://capacitorjs.com). The web app is copied into `www/` and
**bundled into the app** (so it runs standalone, no dependency on the website).

Nothing here is wired into paid features yet — the app's Pro-gating scaffold in
`../index.html` is **dormant** (`MONETISATION.enabled = false`), so the app
behaves exactly like the free web version until you decide to turn it on.

## One-time setup (on your Mac, with Xcode installed)

```bash
cd mobile
npm install
npm run copy-web          # copies the web app into www/
npx cap add ios           # creates the native ios/ project (needs CocoaPods)
npm run sync              # copy web + sync native
npm run open:ios          # opens Xcode
```

In Xcode: **Signing & Capabilities** → check *Automatically manage signing* →
pick your Team → press **▶ Run**. Then **Product → Archive → Distribute → Upload**.

Whenever you change the web app, run `npm run sync` again and re-archive.

> `www/`, `ios/`, `android/`, and `node_modules/` are generated — they're
> git-ignored. Only the config, `package.json`, and this README are tracked.

## App identity
- **appId**: `uk.netlify.snappyframe` (change to your own reverse-domain if you like — must match App Store Connect).
- **appName**: `Snappy Frame`
- App Store icon + screenshots + listing text live in `../appstore/`.

---

## Turning on paid features later (RevenueCat) — NOT enabled yet

The full integration is **already written** in `iap/revenuecat.js` (vanilla JS,
Capacitor). It's dormant until you deliberately switch it on. **Do not do any of
this until you actually want to ship paid features.**

### 1. Install the plugins + bundler
```bash
cd mobile
npm install @revenuecat/purchases-capacitor @revenuecat/purchases-capacitor-ui esbuild
```
`iap/revenuecat.js` gets bundled into `www/revenuecat.bundle.js` by:
```bash
npm run build:iap        # or: npm run sync:iap  (copy web + build IAP + cap sync)
```

### 2. Configure the product, entitlement, offering & paywall
- **App Store Connect** → your app → **In-App Purchases** → create a
  **Non-Consumable** = your lifetime **"Pro Unlock"** (product id e.g. `pro_unlock`).
- **RevenueCat dashboard** →
  - **Entitlements** → create `Snappy Pro` → attach the Pro Unlock product.
  - **Offerings** → make sure your product is in the **current** offering.
  - **Paywalls** → design a paywall and attach it to that offering (this is what
    `presentPaywall()` shows — no paywall UI to build yourself).
  - **API Keys** → copy the **Apple public key** (`appl_…`). *(The `test_…` key
    from onboarding is a test/web key, not the iOS key.)*

### 3. Add your key
In `iap/revenuecat.js`, replace the placeholders:
```js
const API_KEYS = { ios: 'appl_YOUR_KEY', android: 'goog_YOUR_KEY' };
```
The entitlement is already set to `Snappy Pro`.

### 4. Flip the switch + tag Pro features
In `../index.html`:
```js
const MONETISATION = { enabled:false, entitlement:'Snappy Pro' };  // ← set enabled:true
```
Then add a `data-pro` attribute to any element you want gated (a whole
`<section>` or a single button). When enabled and the user isn't Pro, those get
the dimmed `.pro-locked` style automatically. Good candidates: 4× export,
exclusive looks, batch export, watermark-off.

Add a "Get Snappy Pro" button and (Apple **requires**) a visible "Restore
Purchases" button — the helpers are already global in the app:
```js
showPaywall();        // presents the RevenueCat paywall
restorePurchases();   // Apple requires this to be reachable
manageSubscription(); // opens RevenueCat Customer Center (best with subscriptions)
```

### How it works
`iap/revenuecat.js` calls `window.setPro(true/false)` on launch and whenever the
entitlement changes (purchase, restore, refund). `setPro` flips the gating in
`index.html`. On the **web** (`enabled:false`, no Capacitor) none of this loads,
so the web app stays 100% free. See `iap/revenuecat.js` for init, paywall,
`presentPaywallIfNeeded`, direct purchase, restore, Customer Center and error
handling (user-cancel is handled quietly).
