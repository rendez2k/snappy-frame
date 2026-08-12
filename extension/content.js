// Snappy Frame — runs on snappy-frame.netlify.app.
// If the extension stashed a freshly captured screenshot, hand it to the page.
(async () => {
  try {
    const { snappyShot, snappyUrl, snappyTitle, snappyDesign, snappyFrames, snappyFps, snappyTs } =
      await chrome.storage.local.get(["snappyShot", "snappyUrl", "snappyTitle", "snappyDesign", "snappyFrames", "snappyFps", "snappyTs"]);
    if (!snappyShot) return;
    // Only use recent captures (ignore anything older than 60s).
    if (snappyTs && Date.now() - snappyTs > 60000) {
      await chrome.storage.local.remove(["snappyShot", "snappyUrl", "snappyTitle", "snappyDesign", "snappyFrames", "snappyFps", "snappyTs"]);
      return;
    }
    await chrome.storage.local.remove(["snappyShot", "snappyUrl", "snappyTitle", "snappyDesign", "snappyFrames", "snappyFps", "snappyTs"]);
    const send = () => window.postMessage(
      { type: "snappy-frame-image", dataUrl: snappyShot, url: snappyUrl || "", title: snappyTitle || "", design: snappyDesign || null, frames: snappyFrames || null, fps: snappyFps || 8 },
      "*"
    );
    // Give the app a moment to register its message listener.
    if (document.readyState === "complete") setTimeout(send, 400);
    else window.addEventListener("load", () => setTimeout(send, 400));
  } catch (e) {
    console.error("Snappy Frame: hand-off failed", e);
  }
})();
