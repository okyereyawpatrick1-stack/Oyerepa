/* arkesel.js - sends bulk voice calls via the Arkesel Voice SMS API.
 * Register free at arkesel.com, get your API key, top up your balance, then
 * paste the key in Settings. Arkesel's bulk voice endpoint requires a
 * recorded audio file (multipart upload) plus a recipients list:
 * POST https://sms.arkesel.com/api/v2/sms/voice/send
 */
(function (global) {
  "use strict";

  var URL = "https://sms.arkesel.com/api/v2/sms/voice/send";
  var BALANCE_URL = "https://sms.arkesel.com/api/v2/clients/balance-details";

  function err(message) {
    var e = new Error(message);
    e.causedByCors = /Failed to fetch|NetworkError|CORS|Access-Control/i.test(message || "") ? true : false;
    return e;
  }

  function doFetch(s, url, method, payload) {
    var headers = {
      "api-key": s.arkeselKey || "",
      Accept: "application/json"
    };
    var body = null;
    if (payload !== undefined) {
      body = JSON.stringify(payload);
      headers["Content-Type"] = "application/json";
    }

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

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result;
        var idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = function () {
        reject(err("Could not read the audio file: " + ((reader.error && reader.error.message) || "unknown")));
      };
      reader.readAsDataURL(file);
    });
  }

  /* Small WAV encoder (mono, 16 kHz - telephone quality) so any browser
   * recording (e.g. .webm from MediaRecorder) can be sent to Arkesel,
   * which only accepts mp3, wav, flac, aac, wma, m4a and ogg. */
  function encodeWav(audioBuffer) {
    var numChannels = 1;
    var sampleRate = 16000;
    var numFrames = audioBuffer.length;
    var blockAlign = numChannels * 2;
    var dataSize = numFrames * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);

    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    var mono = new Float32Array(numFrames);
    var chs = audioBuffer.numberOfChannels;
    for (var ch = 0; ch < chs; ch++) {
      var chData = audioBuffer.getChannelData(ch);
      for (var i = 0; i < numFrames; i++) mono[i] += chData[i] / chs;
    }
    var step = audioBuffer.sampleRate / sampleRate;
    var offset = 44;
    for (var i = 0; i < numFrames; i++) {
      var idx = Math.min(numFrames - 1, Math.floor(i * step));
      var s = Math.max(-1, Math.min(1, mono[idx]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
    return ab;
  }

  function blobToWav(blob) {
    return new Promise(function (resolve, reject) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        reject(err("Audio conversion is not supported in this browser. Use an MP3 or WAV file instead."));
        return;
      }
      var ctx = new Ctx();
      blob.arrayBuffer()
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (audioBuffer) {
          ctx.close();
          resolve(new Blob([encodeWav(audioBuffer)], { type: "audio/wav" }));
        })
        .catch(function (e) {
          try { ctx.close(); } catch (x) {}
          reject(err("Could not convert the audio file to WAV. Use an MP3 or WAV file instead. (" + e.message + ")"));
        });
    });
  }

  /* Arkesel accepts: mp3, wav, flac, aac, wma, m4a, ogg. Anything else
   * (e.g. the browser recorder's .webm) is converted to WAV automatically. */
  function prepareAudioFile(file) {
    var ext = (file.name || "").split(".").pop().toLowerCase();
    var type = (file.type || "").toLowerCase();
    var isWebm = /webm/.test(type) || ext === "webm";
    var isAllowed = /(^|\.)(mp3|wav|flac|aac|wma|m4a|ogg)$/.test(type + "." + ext) || /mp3|wav|flac|aac|wma|m4a|ogg/.test(type);
    if (!isWebm && isAllowed) {
      return Promise.resolve({ blob: file, name: file.name || "voice.mp3" });
    }
    return blobToWav(file).then(function (wavBlob) {
      var base = (file.name || "voice").replace(/\.[a-z0-9]+$/i, "");
      return { blob: wavBlob, name: (base || "voice") + ".wav" };
    });
  }

  function handleResponse(res, recipients) {
    var d = res.data || {};
    if (res.status >= 400 || d.status === "error" || d.status === "failed") {
      var msg = d.message || d.errorMessage || JSON.stringify(d);
      if (/auth/i.test(msg)) throw err("Arkesel authentication failed. Check your API key.");
      throw err("Arkesel: " + msg);
    }
    return {
      total: recipients.length,
      sent: recipients.length,
      raw: d,
      message: d.message || d.status || "Queued " + recipients.length + " voice call(s)."
    };
  }

  /* Send one voice request containing the audio file + all recipients.
   * Arkesel expects recipients as a single field: "number","number",...
   * When a Proxy URL is set, the browser sends plain JSON and the Cloudflare
   * Worker builds the multipart body itself (reliable boundaries, no CORS). */
  function sendVoice(s, recipients, opts) {
    if (!s.arkeselKey) {
      return Promise.reject(err("Missing Arkesel API key. Paste it in Settings first."));
    }
    if (!recipients.length) return Promise.reject(err("No valid recipient numbers."));

    var file = opts && opts.file;
    if (!file) {
      return Promise.reject(err("Arkesel needs a recorded audio file. Record one, tap Download, then pick it in the Audio file box — or upload an MP3/WAV."));
    }

    var voiceId = opts && opts.voiceId;

    return prepareAudioFile(file).then(function (prepared) {
      var proxy = s.proxyUrl;
      if (proxy) {
        return readFileAsBase64(prepared.blob).then(function (b64) {
          var multipart = {
            fields: { "recipients[]": recipients },
            files: [{
              name: "voice_file",
              filename: prepared.name,
              contentType: prepared.blob.type || "audio/wav",
              dataBase64: b64
            }]
          };
          if (voiceId) multipart.fields.voice_id = voiceId;
          return fetch(proxy, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: URL,
              method: "POST",
              headers: { "api-key": s.arkeselKey, Accept: "application/json" },
              multipart: multipart
            })
          }).then(function (r) {
            return r.json().then(function (payload) {
              var inner = payload && payload.data !== undefined ? payload.data : payload;
              return handleResponse({ status: r.status, data: inner }, recipients);
            });
          });
        });
      }

      var fd = new FormData();
      fd.append("voice_file", prepared.blob, prepared.name);
      recipients.forEach(function (n) { fd.append("recipients[]", n); });
      if (voiceId) fd.append("voice_id", voiceId);

      return fetch(URL, {
        method: "POST",
        headers: { "api-key": s.arkeselKey, Accept: "application/json" },
        body: fd
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          return handleResponse({ status: r.status, data: data }, recipients);
        });
      }).catch(function (e) {
        if (e && e.causedByCors) {
          throw err("Your browser blocked the upload to Arkesel (CORS). Open Settings, paste your Proxy URL (from the Cloudflare Worker in worker.js) into the Proxy URL field, then Save and retry.");
        }
        throw e;
      });
    });
  }

  function testConnection(s) {
    if (!s.arkeselKey) return Promise.reject(err("Missing Arkesel API key."));
    return doFetch(s, BALANCE_URL, "GET").then(function (res) {
      var d = res.data || {};
      if (res.status === 200) {
        var bal = d.balance || d.Balance || (d.data && d.data.balance) || (d.data && d.data.Balance);
        return { ok: true, balance: bal !== undefined ? bal : null, currency: d.currency || "GHS" };
      }
      if (res.status === 401) throw err("Authentication failed (401). Check your Arkesel API key.");
      throw err(d.message || d.error || "HTTP " + res.status);
    });
  }

  global.ArkeselProvider = {
    sendVoice: sendVoice,
    testConnection: testConnection
  };
})(window);
