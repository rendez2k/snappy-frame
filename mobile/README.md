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

When you're ready to charge for a "Pro" tier, this is the whole flow. **Do not
do any of this until you actually want to ship paid features.**

### 1. Install the RevenueCat plugin
```bash
cd mobile
npm install @revenuecat/purchases-capacitor
npm run sync
```

### 2. Create the product + entitlement
- **App Store Connect** → your app → **In-App Purchases** → create either a
  **Non-Consumable** (one-time "Pro" unlock — simplest) or an **Auto-Renewable
  Subscription**.
- **RevenueCat dashboard** → add the App Store app (with your shared secret) →
  create an **Entitlement** called `pro` → attach the product to it → put the
  product in an **Offering**.

### 3. Wire it in the web app
The gating layer is already in `../index.html`:
```js
const MONETISATION = { enabled:false, entitlement:'pro' };  // ← flip to true
function setPro(v){ ... }        // call this with the entitlement state
```
In the Capacitor build, initialise RevenueCat once and push the result into
`setPro()` (import the plugin only in the native build):
```js
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
await Purchases.configure({ apiKey: 'appl_YOUR_REVENUECAT_KEY' });
const { customerInfo } = await Purchases.getCustomerInfo();
setPro(!!customerInfo.entitlements.active['pro']);
```
To purchase (from a "Get Pro" button) and to restore:
```js
const offerings = await Purchases.getOfferings();
await Purchases.purchasePackage({ aPackage: offerings.current.availablePackages[0] });
// Restore (Apple requires a visible Restore Purchases button):
const info = await Purchases.restorePurchases();
setPro(!!info.customerInfo.entitlements.active['pro']);
```

### 4. Mark which features are Pro
Add a `data-pro` attribute to any element you want gated (a whole `<section>`,
a button, etc.). When `MONETISATION.enabled` is `true` and the user isn't Pro,
those elements get the dimmed `.pro-locked` style automatically. Suggested
candidates: 4× export, exclusive looks/backgrounds, batch export, watermark-off.

That's it — set `enabled:true`, tag your Pro elements, and RevenueCat drives the
rest. The **web** version keeps `enabled:false`, so it stays fully free.
