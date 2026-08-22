/* bmsafrica.js - BMS Africa (mNotify) bulk voice calls.
 * Register at app.bms.africa, get your API key from Settings > Developer,
 * top up voice credits, then paste the key in Settings.
 * API docs: https://developer.bms.africa
 *
 * Voice endpoint:  POST https://api.mnotify.com/api/voice/quick?key=API_KEY
 *   multipart: campaign, recipient[] (each number like 0241234567),
 *              file (mp3/wav), voice_id ("" for new file),
 *              is_schedule ("false"), schedule_date ("")
 *
 * Balance endpoint: GET https://api.mnotify.com/api/balance/voice?key=API_KEY
 *   response: { status: "success", balance: 45, h_m_s: "00:00:45" }
 *   (balance = seconds of voice, 1 credit = 1 second)
 *
 * Top-up: No API available. User is redirected to the dashboard:
 *   https://app.bms.africa/dashboard/voice/overview
 */
(function (global) {
  "use strict";

  var VOICE_URL = "https://api.mnotify.com/api/voice/quick";
  var BALANCE_URL = "https://api.mnotify.com/api/balance/voice";
  var CALLS_URL = "https://api.mnotify.com/api/calls";
  function err(message) {
    var e = new Error(message);
    e.causedByCors = /Failed to fetch|NetworkError|CORS|Access-Control/i.test(message || "") ? true : false;
    return e;
  }

  /* Convert 233... numbers to BMS format (024...). */
  function toBmsNumber(n) {
    var s = (n || "").replace(/^\+/, "");
    if (/^233\d{9}$/.test(s)) return "0" + s.slice(3);
    return s;
  }

  function proxyFetch(s, url, opts) {
    var proxy = s.proxyUrl;
    var isGet = !opts.method || opts.method === "GET";
    if (proxy) {
      var payload = {
        url: url,
        method: opts.method || "GET",
        headers: opts.headers || {}
      };
      if (!isGet && opts.body) payload.body = opts.body;
      return fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().then(function (p) {
          var inner = p && p.data !== undefined ? p.data : p;
          return { status: r.status, data: inner };
        });
      });
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        return { status: r.status, data: data };
      });
    });
  }

  /* --- Audio conversion (reused from arkesel.js) --- */
  function encodeWav(audioBuffer) {
    var numChannels = 1;
    var sampleRate = 16000;
    var numFrames = audioBuffer.length;
    var blockAlign = numChannels * 2;
    var dataSize = numFrames * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function writeStr(o, s) { for (var i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }
    writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE"); writeStr(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    writeStr(36, "data"); view.setUint32(40, dataSize, true);
    var mono = new Float32Array(numFrames);
    var chs = audioBuffer.numberOfChannels;
    for (var ch = 0; ch < chs; ch++) {
      var d = audioBuffer.getChannelData(ch);
      for (var i = 0; i < numFrames; i++) mono[i] += d[i] / chs;
    }
    var step = audioBuffer.sampleRate / sampleRate;
    var off = 44;
    for (var i = 0; i < numFrames; i++) {
      var idx = Math.min(numFrames - 1, Math.floor(i * step));
      var s = Math.max(-1, Math.min(1, mono[idx]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
    return ab;
  }

  function blobToWav(blob) {
    return new Promise(function (resolve, reject) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { reject(err("Audio conversion not supported.")); return; }
      var ctx = new Ctx();
      blob.arrayBuffer()
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (ab) { ctx.close(); resolve(new Blob([encodeWav(ab)], { type: "audio/wav" })); })
        .catch(function (e) { try { ctx.close(); } catch(x){} reject(err("Could not convert audio: " + e.message)); });
    });
  }

  function prepareAudioFile(file) {
    var ext = (file.name || "").split(".").pop().toLowerCase();
    var type = (file.type || "").toLowerCase();
    var isWebm = /webm/.test(type) || ext === "webm";
    var isAllowed = /mp3|wav|flac|aac|wma|m4a|ogg/.test(type) || /(^|\.)(mp3|wav|flac|aac|wma|m4a|ogg)$/.test(ext);
    if (!isWebm && isAllowed) return Promise.resolve({ blob: file, name: file.name || "voice.mp3" });
    return blobToWav(file).then(function (wavBlob) {
      var base = (file.name || "voice").replace(/\.[a-z0-9]+$/i, "");
      return { blob: wavBlob, name: (base || "voice") + ".wav" };
    });
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var r = reader.result;
        var idx = r.indexOf(",");
        resolve(idx >= 0 ? r.slice(idx + 1) : r);
      };
      reader.onerror = function () { reject(err("Could not read audio file.")); };
      reader.readAsDataURL(file);
    });
  }

  /* --- Voice --- */
  function sendVoice(s, recipients, opts) {
    if (!s.bmsafricaKey) return Promise.reject(err("Missing BMS Africa API key. Paste it in Settings first."));
    if (!recipients.length) return Promise.reject(err("No valid recipient numbers."));

    var file = opts && opts.file;
    if (!file) return Promise.reject(err("BMS Africa needs a recorded audio file. Record one, tap Download, then pick it in the Audio file box."));

    var bmsNumbers = recipients.map(toBmsNumber);
    var campaign = (opts && opts.campaign) || "OYEREPA LADIES";

    return prepareAudioFile(file).then(function (prepared) {
      var proxy = s.proxyUrl;
      if (proxy) {
        return readFileAsBase64(prepared.blob).then(function (b64) {
          var multipart = {
            fields: {
              campaign: campaign,
              "recipient[]": bmsNumbers,
              voice_id: "",
              is_schedule: "false",
              schedule_date: ""
            },
            files: [{
              name: "file",
              filename: prepared.name,
              contentType: prepared.blob.type || "audio/wav",
              dataBase64: b64
            }]
          };
          return fetch(proxy, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: VOICE_URL + "?key=" + encodeURIComponent(s.bmsafricaKey),
              method: "POST",
              headers: {},
              multipart: multipart
            })
          }).then(function (r) {
            return r.json().then(function (p) {
              var inner = p && p.data !== undefined ? p.data : p;
              return handleResponse({ status: r.status, data: inner }, bmsNumbers);
            });
          });
        });
      }

      var fd = new FormData();
      fd.append("campaign", campaign);
      bmsNumbers.forEach(function (n) { fd.append("recipient[]", n); });
      fd.append("file", prepared.blob, prepared.name);
      fd.append("voice_id", "");
      fd.append("is_schedule", "false");
      fd.append("schedule_date", "");

      return fetch(VOICE_URL + "?key=" + encodeURIComponent(s.bmsafricaKey), {
        method: "POST",
        body: fd
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          return handleResponse({ status: r.status, data: data }, bmsNumbers);
        });
      }).catch(function (e) {
        if (e && e.causedByCors) {
          throw err("Your browser blocked the upload (CORS). Open Settings, paste your Proxy URL into the Proxy URL field, Save, then retry.");
        }
        throw e;
      });
    });
  }

  function handleResponse(res, recipients) {
    var d = res.data || {};
    if (res.status >= 400 || d.status === "error" || d.status === "failed") {
      var msg = d.message || d.errorMessage || d.error || JSON.stringify(d);
      if (/auth|unauthorized|invalid.*key/i.test(msg)) throw err("BMS Africa authentication failed. Check your API key.");
      throw err("BMS Africa: " + msg);
    }
    var summary = d.summary || {};
    return {
      total: recipients.length,
      sent: summary.total_sent || recipients.length,
      campaignId: summary._id || null,
      raw: d,
      message: d.message || ("Voice call sent. Credits used: " + (summary.credit_used || "?"))
    };
  }

  /* --- Balance --- */
  function testConnection(s) {
    if (!s.bmsafricaKey) return Promise.reject(err("Missing BMS Africa API key."));
    return proxyFetch(s, BALANCE_URL + "?key=" + encodeURIComponent(s.bmsafricaKey), {
      method: "GET",
      headers: {}
    }).then(function (res) {
      var d = res.data || {};
      if (res.status === 200 && d.status === "success") {
        return { ok: true, balance: d.balance, currency: "credits" };
      }
      if (res.status === 401 || res.status === 403) throw err("Authentication failed. Check your API key.");
      throw err(d.message || d.error || "HTTP " + res.status);
    });
  }

  /* Get current voice balance (credits = seconds of voice). */
  function getBalance(s) {
    if (!s.bmsafricaKey) return Promise.reject(err("Missing BMS Africa API key."));
    return proxyFetch(s, BALANCE_URL + "?key=" + encodeURIComponent(s.bmsafricaKey), {
      method: "GET",
      headers: {}
    }).then(function (res) {
      var d = res.data || {};
      if (res.status === 200 && d.status === "success") {
        var credits = d.balance || 0;
        var mins = Math.floor(credits / 60);
        var secs = credits % 60;
        return {
          credits: credits,
          minutes: mins,
          seconds: secs,
          display: mins + " min " + secs + " sec",
          raw: d
        };
      }
      throw err(d.message || d.error || "Failed to get balance");
    });
  }

  /* --- Call report --- */
  function getCallReport(s, campaignId, status) {
    if (!s.bmsafricaKey) return Promise.reject(err("Missing BMS Africa API key."));
    if (!campaignId) return Promise.reject(err("No campaign ID available."));

    var url = CALLS_URL + "/" + encodeURIComponent(campaignId);
    if (status) url += "/" + encodeURIComponent(status);
    url += "?key=" + encodeURIComponent(s.bmsafricaKey);

    return proxyFetch(s, url, {
      method: "GET",
      headers: {}
    }).then(function (res) {
      var d = res.data || {};
      if (res.status === 200 && (d.status === "success" || Array.isArray(d))) {
        var list = Array.isArray(d) ? d : (d.data || d.delivery_report || d.calls || []);
        var received = [];
        var missed = [];
        var pending = [];
        var all = [];
        list.forEach(function (r) {
          var st = (r.status || "").toLowerCase();
          var entry = { phone: r.recipient || r.phone || "", status: st, answerTime: r.answer_time || "", hangUpTime: r.hang_up_time || "", totalDuration: r.total_duration || 0, retries: r.retries || 0 };
          all.push(entry);
          if (st === "received") received.push(entry);
          else if (st === "missed") missed.push(entry);
          else if (st === "pending") pending.push(entry);
        });
        return { all: all, received: received, missed: missed, pending: pending, campaignId: campaignId };
      }
      throw err(d.message || d.error || "Failed to get call report");
    });
  }

  /* Top-up is not available via the mNotify API.
   * Redirect the user to the BMS Africa dashboard wallet page. */
  function topUp() {
    return Promise.resolve({ url: "https://app.bms.africa/dashboard/voice/overview" });
  }

  global.BmsAfrica = {
    sendVoice: sendVoice,
    testConnection: testConnection,
    getBalance: getBalance,
    getCallReport: getCallReport,
    topUp: topUp
  };
})(window);
