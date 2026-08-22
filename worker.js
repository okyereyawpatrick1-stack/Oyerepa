/* worker.js - FREE Cloudflare Worker proxy for the OYEREPA LADIES site.
 * This tiny server is the only piece that talks directly to Africa's Talking,
 * because their API blocks browsers. It forwards requests and adds CORS headers.
 *
 * HOW TO DEPLOY (free, ~3 minutes, do it ONCE):
 * 1. Open https://workers.cloudflare.com and sign in (or create a free account).
 * 2. Click "Create Worker" (free plan is enough). Give it any name, e.g. oyp-proxy.
 * 3. Delete the example code and paste the whole content of THIS file in.
 * 4. Click "Save and Deploy".
 * 5. Copy the Worker URL it shows, e.g. https://oyp-proxy.xxxx.workers.dev
 * 6. On the OYEREPA LADIES site: Settings -> Proxy URL -> paste that URL -> Save Settings.
 *    Now Bulk SMS and Bulk Calls will work on every phone.
 */
addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request));
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

async function handle(request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const url = body.url;
    const method = body.method || "POST";
    const headers = body.headers || {};
    let postBody;
    if (body.multipart) {
      /* Multipart uploads: the worker builds the FormData itself so the
       * Content-Type boundary is always correct. Files arrive base64-encoded
       * inside a JSON payload. */
      const fd = new FormData();
      if (body.multipart.fields) {
        for (const k of Object.keys(body.multipart.fields)) {
          const v = body.multipart.fields[k];
          if (Array.isArray(v)) {
            v.forEach(item => fd.append(k, item));
          } else {
            fd.append(k, v);
          }
        }
      }
      for (const f of (body.multipart.files || [])) {
        const bytes = Uint8Array.from(atob(f.dataBase64), c => c.charCodeAt(0));
        fd.append(f.name, new Blob([bytes], { type: f.contentType || "application/octet-stream" }), f.filename || "file");
      }
      postBody = fd;
    } else if (body.bodyBase64) {
      postBody = Uint8Array.from(atob(body.bodyBase64), c => c.charCodeAt(0));
      if (body.bodyContentType) headers["Content-Type"] = body.bodyContentType;
    } else if (body.body !== undefined && body.body !== null) {
      postBody = body.body;
    }

    if (!url) {
      return json(400, { errorMessage: "Missing url" }, corsHeaders);
    }

    const resp = await fetch(url, {
      method: method,
      headers: headers,
      body: postBody
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    return json(resp.status, { status: resp.status, data: data }, corsHeaders);
  } catch (e) {
    return json(500, { status: 500, data: { errorMessage: e.message } }, corsHeaders);
  }
}

function json(status, payload, headers) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, headers)
  });
}
