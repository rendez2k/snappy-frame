// Snappy Frame — runs on snappy-frame.netlify.app.
// If the extension stashed a freshly captured screenshot, hand it to the page.
(async () => {
  try {
    const { snappyShot, snappyTs } = await chrome.storage.local.get(["snappyShot", "snappyTs"]);
    if (!snappyShot) return;
    // Only use recent captures (ignore anything older than 60s).
    if (snappyTs && Date.now() - snappyTs > 60000) {
      await chrome.storage.local.remove(["snappyShot", "snappyTs"]);
      return;
    }
    await chrome.storage.local.remove(["snappyShot", "snappyTs"]);
    const send = () => window.postMessage({ type: "snappy-frame-image", dataUrl: snappyShot }, "*");
    // Give the app a moment to register its message listener.
    if (document.readyState === "complete") setTimeout(send, 400);
    else window.addEventListener("load", () => setTimeout(send, 400));
  } catch (e) {
    console.error("Snappy Frame: hand-off failed", e);
  }
})();
