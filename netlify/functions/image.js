// Fetch an image by URL and hand it back as a same-origin data URL. Used when
// someone pastes an image copied from a web page or chat app: the clipboard
// then carries only <img src="https://…">, and most hosts refuse a browser
// cross-origin read, so the page can't turn it into editable pixels itself.
const MAX = 4 * 1024 * 1024;   // Netlify's 6 MB response cap, less base64's third

// Only public web hosts: this must not become a way to probe a private network.
function blockedHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "::1" || /^f[cd]/.test(h) || /^fe80/.test(h);
}

exports.handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" };
  const json = (b, s = 200) => ({ statusCode: s, headers: cors, body: JSON.stringify(b) });
  let u;
  try { u = new URL((event.queryStringParameters || {}).url || ""); } catch (e) { return json({ error: "bad url" }, 400); }
  if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return json({ error: "not allowed" }, 400);
  try {
    const r = await fetch(u.toString(), { redirect: "follow", headers: { "User-Agent": "SnappyFrame/1.0", Accept: "image/*" } });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !type.startsWith("image/")) return json({ error: "not an image" }, 415);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) return json({ error: "too big" }, 413);
    return json({ dataUrl: `data:${type};base64,` + buf.toString("base64") });
  } catch (e) { return json({ error: "fetch failed" }, 502); }
};
exports._blockedHost = blockedHost;
