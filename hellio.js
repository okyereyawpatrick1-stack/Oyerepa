/* hellio.js - sends bulk voice calls via the Hellio Messaging API.
 * Register free at helliomessaging.com, generate an API token, top up the
 * wallet, then paste the token in Settings. Text-to-speech or hosted audio.
 * POST https://api.helliomessaging.com/v1/voice/send  (Bearer token)
 * GET  https://api.helliomessaging.com/v1/balance
 */
(function (global) {
  "use strict";

  var BASE = "https://api.helliomessaging.com/v1";

  function err(message) {
    var e = new Error(message);
    e.causedByCors = /Failed to fetch|NetworkError|CORS|Access-Control/i.test(message || "") ? true : false;
    return e;
  }

  /* If a Proxy URL (Cloudflare Worker) is configured, POST the request there
   * and let the worker talk to Hellio. Otherwise call Hellio directly. */
  function doFetch(s, path, method, payload) {
    var url = BASE + path;
    var headers = {
      Authorization: "Bearer " + (s.hellioToken || ""),
      Accept: "application/json"
    };
    var body = payload !== undefined ? JSON.stringify(payload) : null;
    if (body) headers["Content-Type"] = "application/json";

    var proxy = s.proxyUrl;
    if (proxy) {
      return fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, method: method, headers: headers, body: body || "" })
      }).then(function (r) {
        return r.json().then(function (payload) {
          var inner = payload && payload.data !== undefined ? payload.data : payload;
          return { status: r.status, data: inner };
        });
      });
    }

    return fetch(url, {
      method: method,
      headers: headers,
      body: body
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        return { status: r.status, data: data };
      });
    });
  }

  function sendVoice(s, recipients, opts) {
    if (!s.hellioToken) {
      return Promise.reject(err("Missing Hellio API token. Paste it in Settings first."));
    }
    if (!recipients.length) return Promise.reject(err("No valid recipient numbers."));

    var text = ((opts && opts.text) || "").trim();
    var audioUrl = ((opts && opts.audioUrl) || "").trim();
    if (!text && !audioUrl) {
      return Promise.reject(err("Type a voice message or paste a hosted audio URL."));
    }

    var payload = { recipients: recipients };
    if (text) {
      payload.text = text;
      if (opts && opts.voice) payload.voice = opts.voice;
    } else {
      payload.audio_url = audioUrl;
    }

    return doFetch(s, "/voice/send", "POST", payload).then(function (res) {
      var d = res.data || {};
      if (res.status >= 400 || d.error) {
        var msg = d.message || d.error || JSON.stringify(d);
        if (/unauth|token/i.test(msg)) throw err("Hellio authentication failed. Check your API token.");
        throw err("Hellio: " + msg);
      }
      return {
        total: recipients.length,
        raw: d,
        message: d.status || "Queued"
      };
    }).catch(function (e) {
      if (e && e.causedByCors) {
        throw err("Your browser blocked the request to Hellio (CORS). Open Settings, paste your Proxy URL (from the Cloudflare Worker in worker.js) into the Proxy URL field, then Save and retry.");
      }
      throw e;
    });
  }

  function testConnection(s) {
    if (!s.hellioToken) return Promise.reject(err("Missing Hellio API token."));
    return doFetch(s, "/balance", "GET").then(function (res) {
      if (res.status === 200 && res.data && res.data.data) {
        var b = res.data.data;
        return { ok: true, balance: b.balance, currency: b.currency };
      }
      if (res.status === 401) throw err("Authentication failed (401). Check your Hellio token.");
      throw err((res.data && (res.data.message || res.data.error)) || "HTTP " + res.status);
    });
  }

  global.Hellio = {
    sendVoice: sendVoice,
    testConnection: testConnection
  };
})(window);
