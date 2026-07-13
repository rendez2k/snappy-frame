// Snappy Frame — Capture (service worker)
// On toolbar-icon click: snapshot the visible tab, stash it, open Snappy Frame.
const APP_URL = "https://snappy-frame.netlify.app/";

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // activeTab (granted by the click) lets us capture the current window's view.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    // Hand off via storage — the content script on the app page reads and clears it.
    // Also pass the captured tab's URL so the app can show it in a browser frame.
    await chrome.storage.local.set({
      snappyShot: dataUrl,
      snappyUrl: tab && tab.url && /^https?:/i.test(tab.url) ? tab.url : "",
      snappyTs: Date.now(),
    });
    await chrome.tabs.create({ url: APP_URL });
  } catch (e) {
    console.error("Snappy Frame: capture failed", e);
  }
});
