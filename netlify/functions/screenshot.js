// Snappy Frame — grab a screenshot of a public webpage by URL.
// Uses WordPress's free mShots renderer and returns a same-origin data URL so
// the image can be edited AND exported (html-to-image can't inline a tainted
// cross-origin image, hence the proxy).
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  const q = event.queryStringParameters || {};
  let url = (q.url || "").trim();
  if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing url" }) };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const w = Math.min(2000, Math.max(600, parseInt(q.w, 10) || 1280));
  const src = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${w}`;

  try {
    // mShots serves a small placeholder while it renders; poll a few times.
    let buf = null, generating = true, tries = 0;
    while (tries < 3) {
      tries++;
      const r = await fetch(src, { redirect: "follow" });
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 30000) { generating = false; break; }
      if (tries < 3) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!buf || !buf.length) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "no image" }) };
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64"), generating }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
