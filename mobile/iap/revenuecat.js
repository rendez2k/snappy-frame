// Snappy Frame — RevenueCat integration (Capacitor, vanilla JS).
//
// This file is bundled by esbuild into `www/revenuecat.bundle.js` and loaded
// ONLY inside the native app (never on the web). It exposes a small API on
// `window.SnappyIAP` and drives the app's existing `window.setPro(bool)` hook,
// which flips the dormant Pro-gating layer in index.html.
//
// Nothing here runs until you: (1) put real RevenueCat public keys below,
// (2) set `MONETISATION.enabled = true` in index.html. See mobile/README.md.

import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { RevenueCatUI, PAYWALL_RESULT } from '@revenuecat/purchases-capacitor-ui';

// ---- Configuration ----------------------------------------------------------
const ENTITLEMENT = 'Snappy Pro';   // must match the entitlement id in RevenueCat
// Public SDK keys from RevenueCat → Project settings → API Keys.
// (These are PUBLIC keys — safe to ship in the app. NOT the test_ web key.)
const API_KEYS = {
  ios: 'appl_REPLACE_WITH_YOUR_APPLE_PUBLIC_KEY',
  android: 'goog_REPLACE_WITH_YOUR_GOOGLE_PUBLIC_KEY',
};

let configured = false;

// ---- Helpers ----------------------------------------------------------------
function hasPro(customerInfo) {
  return !!customerInfo?.entitlements?.active?.[ENTITLEMENT];
}
// Push the current entitlement state into the app (unlocks/locks Pro features).
function apply(customerInfo) {
  const pro = hasPro(customerInfo);
  if (typeof window.setPro === 'function') window.setPro(pro);
  return pro;
}

// ---- Lifecycle --------------------------------------------------------------
async function init() {
  const platform = Capacitor.getPlatform();          // 'ios' | 'android' | 'web'
  const apiKey = API_KEYS[platform];
  if (!apiKey || apiKey.includes('REPLACE')) {
    console.warn('[IAP] no RevenueCat key configured for', platform, '- staying free');
    return false;
  }
  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.INFO });
    await Purchases.configure({ apiKey });
    configured = true;
    // Fires on any change — purchase, restore, expiry, refund, Family Sharing.
    Purchases.addCustomerInfoUpdateListener((info) => apply(info));
    const { customerInfo } = await Purchases.getCustomerInfo();
    return apply(customerInfo);
  } catch (e) {
    console.error('[IAP] init failed', e);
    return false;
  }
}

async function refresh() {
  if (!configured) return false;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return apply(customerInfo);
  } catch (e) { console.error('[IAP] refresh failed', e); return false; }
}

// ---- Paywall (RevenueCat-hosted UI) -----------------------------------------
// Present the paywall unconditionally. Returns true if the user is Pro after.
async function presentPaywall() {
  if (!configured) return false;
  try {
    const { result } = await RevenueCatUI.presentPaywall();
    // PURCHASED / RESTORED → refresh to reflect the new entitlement.
    if (result === PAYWALL_RESULT.ERROR) console.warn('[IAP] paywall reported an error');
    return refresh();
  } catch (e) { console.error('[IAP] paywall error', e); return false; }
}
// Only show the paywall if the user doesn't already have Pro.
async function paywallIfNeeded() {
  if (!configured) return false;
  try {
    await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: ENTITLEMENT });
    return refresh();
  } catch (e) { console.error('[IAP] paywallIfNeeded error', e); return false; }
}

// ---- Direct purchase (fallback if you don't use the paywall UI) -------------
// Buys the first package in the current offering (your lifetime "Pro Unlock").
async function buyPro() {
  if (!configured) return false;
  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages?.[0];
    if (!pkg) { console.warn('[IAP] current offering has no packages'); return false; }
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return apply(customerInfo);
  } catch (e) {
    // A user cancelling isn't an error — just don't unlock.
    if (e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || e?.userCancelled) return false;
    console.error('[IAP] purchase failed', e);
    return false;
  }
}

// ---- Restore (Apple REQUIRES a visible "Restore Purchases" button) ----------
async function restore() {
  if (!configured) return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return apply(customerInfo);
  } catch (e) { console.error('[IAP] restore failed', e); return false; }
}

// ---- Customer Center (self-service manage/refund/restore) --------------------
// Most useful once you offer SUBSCRIPTIONS. For a one-time lifetime unlock,
// "Restore Purchases" is usually enough — but it's here if you want it.
async function openCustomerCenter() {
  if (!configured) return;
  try { await RevenueCatUI.presentCustomerCenter(); await refresh(); }
  catch (e) { console.error('[IAP] customer center error', e); }
}

window.SnappyIAP = {
  init, refresh, presentPaywall, paywallIfNeeded, buyPro, restore, openCustomerCenter,
  isPro: () => refresh(),
};
