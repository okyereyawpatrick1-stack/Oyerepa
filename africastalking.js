/* africastalking.js - calls the Africa's Talking REST API from the browser.
 * - SMS  : POST /version1/messaging
 * - Voice: POST /version1/voice/call
 * Sandbox uses the sandbox host. API keys are read from settings (browser/shared store).
 */
(function (global) {
  "use strict";

  var HOST = "https://api.africastalking.com";
  var SANDBOX_HOST = "https://api.sandbox.africastalking.com";

  function hostFor(s) {
    return s.mode === "sandbox" ? SANDBOX_HOST : HOST;
  }

  function err(message, extra) {
    var e = new Error(message);
    e.causedByCors = /Failed to fetch|NetworkError|CORS|Access-Control/i.test(message || "") ? true : false;
    e.extra = extra;
    return e;
  }

  /* If the user configured a CORS proxy (e.g. a Cloudflare Worker), POST to it.
   * The worker forwards the request and returns JSON {status, data}. */
  function doFetch(s, url, form) {
    var proxy = s.proxyUrl;
    var headers = {
      apikey: s.apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    };
    var body = new URLSearchParams(form).toString();

    if (proxy) {
      return fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url,
          method: "POST",
          headers: headers,
          body: body
        })
      }).then(function (r) {
        return r.json().then(function (payload) {
          /* The worker returns {status, data} - unwrap so res.data is the
           * actual Africa's Talking response body (same as the direct path). */
          var inner = payload && payload.data !== undefined ? payload.data : payload;
          return { status: r.status, data: inner };
        });
      });
    }

    return fetch(url, {
      method: "POST",
      headers: headers,
      body: body
    }).then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data };
      });
    });
  }

  function parseNumbers(text) {
    var list = String(text || "")
      .split(/[\n,;]+/)
      .map(function (s) { return Store.normalizePhone(s.trim()); })
      .filter(function (s) { return s.length >= 9 && s.length <= 14 && /^\d+$/.test(s); });
    var seen = {};
    return list.filter(function (n) {
      if (seen[n]) return false;
      seen[n] = true;
      return true;
    });
  }

  function sendSms(s, recipients, message, from) {
    if (!s.username || !s.apiKey) {
      return Promise.reject(err("Missing username or API key. Set it in Settings first."));
    }
    var to = parseNumbers(recipients);
    if (!to.length) return Promise.reject(err("No valid recipient numbers."));
    if (!message) return Promise.reject(err("Message is empty."));
    var fromName = (from || "").trim() || s.smsFrom || "OYEREPA LADIES";

    function attempt(withFrom) {
      var form = {
        username: s.username,
        to: to.join(","),
        message: message
      };
      if (withFrom && fromName) form.from = fromName;

      return doFetch(s, hostFor(s) + "/version1/messaging", form).then(function (res) {
        var body = res.data;
        if (typeof body === "string") throw err(body);
        body = body || {};
        var sd = body.SMSMessageData || {};
        var m = sd.Message || sd.errorMessage || JSON.stringify(body);
        var noRecipients = !sd.Recipients || !sd.Recipients.length;
        var invalidSender = /invalid.?sender|sender.?id|not.?registered|not.?allowed/i.test(m) && noRecipients;

        if (invalidSender && withFrom) {
          /* Retry once using the account's default sender. */
          return attempt(false);
        }

        if (sd.errorMessage || /error/i.test(m) || (noRecipients && !/sent/i.test(m))) {
          throw err(m);
        }

        var recipientsOk = (sd.Recipients || []).filter(function (r) { return r.status === "Success"; }).length;
        return {
          sent: recipientsOk,
          total: to.length,
          raw: body,
          message: m,
          retriedWithoutSender: withFrom ? false : true
        };
      });
    }

    return attempt(true).catch(function (e) {
      if (e && e.causedByCors) {
        throw err("Your browser blocked the request to Africa's Talking (CORS). Open Settings, paste your Proxy URL (from the Cloudflare Worker in worker.js) into the Proxy URL field, then Save and retry. Details: " + e.message);
      }
      throw e;
    });
  }

  function makeCall(s, callTo, callFrom) {
    if (!s.username || !s.apiKey) {
      return Promise.reject(err("Missing username or API key. Set it in Settings first."));
    }
    var to = parseNumbers(callTo);
    if (!to.length) return Promise.reject(err("No valid recipient numbers."));
    var from = callFrom || s.callFrom;
    if (!from) return Promise.reject(err("Caller ID is missing. Enter the number Africa's Talking gave you."));

    var form = {
      username: s.username,
      from: Store.normalizePhone(from),
      to: to.join(",")
    };

    return doFetch(s, hostFor(s) + "/version1/voice/call", form).then(function (res) {
      var body = res.data;
      if (typeof body === "string") throw err(body);
      body = body || {};
      if (res.status !== 201 && body.status !== "Request Accepted") {
        throw err(body.errorMessage || body.status || JSON.stringify(body));
      }
      return { total: to.length, raw: body, message: body.status || "Request Accepted" };
    }).catch(function (e) {
      if (e && e.causedByCors) {
        throw err("Your browser blocked the request to Africa's Talking (CORS). Open Settings, paste your Proxy URL (from the Cloudflare Worker in worker.js) into the Proxy URL field, then Save and retry. Details: " + e.message);
      }
      throw e;
    });
  }

  /* Simple ping: hit the account balance endpoint as a connection test.
   * Note: sandbox has no balance endpoint (404), which still proves the
   * API + auth chain works, so we treat 404 as a good connection. */
  function testConnection(s) {
    if (!s.username || !s.apiKey) {
      return Promise.reject(err("Missing username or API key."));
    }
    var url = hostFor(s) + "/version1/balance?username=" + encodeURIComponent(s.username);
    var proxy = s.proxyUrl;
    if (proxy) {
      return fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url,
          method: "GET",
          headers: { apikey: s.apiKey, Accept: "application/json" },
          body: ""
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.status === 200 && d.data && d.data.UserData) return { ok: true, balance: d.data.UserData.balance };
        if (d.status === 404) return { ok: true, balance: null };
        if (d.status === 401) throw err("Authentication failed (401). Check Mode and Username, then Save.");
        throw err((d.data && (d.data.errorMessage || d.data.Message)) || "HTTP " + (d.status || "error"));
      });
    }
    return fetch(url, {
      method: "GET",
      headers: { apikey: s.apiKey, Accept: "application/json" }
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (r.status === 200 && d && d.UserData) return { ok: true, balance: d.UserData.balance };
        if (r.status === 404) return { ok: true, balance: null };
        if (r.status === 401) throw err("Authentication failed (401). Check Mode and Username, then Save.");
        throw err((d && (d.errorMessage || d.Message)) || "HTTP " + r.status);
      });
    }).catch(function (e) {
      if (e instanceof Error && /Failed to fetch|NetworkError|Access-Control/i.test(e.message)) {
        throw err("Your browser blocked the request to Africa's Talking (CORS). Open Settings, paste your Proxy URL (from the Cloudflare Worker in worker.js) into the Proxy URL field, then Save and retry.");
      }
      throw e;
    });
  }

  global.AT = {
    parseNumbers: parseNumbers,
    sendSms: sendSms,
    makeCall: makeCall,
    testConnection: testConnection
  };
})(window);
