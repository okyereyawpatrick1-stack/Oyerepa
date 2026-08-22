/* app.js - UI logic for OYEREPA LADIES / FUN CLUB manager */
(function () {
  "use strict";

  var S = Store.getSettings();
  var selectedMemberIds = {};
  var lastCampaignId = null;

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function autoSync() {
    var s = Store.getSettings();
    if (s.fbUrl) Store.syncPush(s);
  }

  /* ---------------- Tabs ---------------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-page").forEach(function (p) {
      p.classList.toggle("active", p.id === "tab-" + name);
    });
  }

  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.dataset.tab); });
  });
  $("btnOpenMenu").addEventListener("click", function () { showTab("members"); });

  /* ---------------- Organization Switcher ---------------- */
  function switchOrg() {
    S = Store.getSettings();
    S.org = $("orgSwitcher").value;
    Store.saveSettings(S);
    selectedMemberIds = {};
    renderDashboard();
    renderMembers();
    populateDuesMembers();
    renderDuesSummary();
    renderAttendanceList();
    toast("Switched to " + Store.ORG_LABELS[S.org]);
  }

  /* ---------------- Members ---------------- */
  function renderMembers() {
    var list = $("memberList");
    var q = ($("memberSearch").value || "").toLowerCase().trim();
    var all = Store.getMembers();
    var filtered = all.filter(function (m) {
      return !q || m.name.toLowerCase().indexOf(q) >= 0 || m.phone.indexOf(q) >= 0 || (m.location || "").toLowerCase().indexOf(q) >= 0;
    });
    $("memberCount").textContent = all.length;

    if (!all.length) {
      list.innerHTML = '<div class="empty">No members yet. Add one above or import a CSV.</div>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<div class="empty">No members match your search.</div>';
      return;
    }

    list.innerHTML = filtered.map(function (m) {
      var checked = selectedMemberIds[m.id] ? "checked" : "";
      return '<div class="contact">' +
        '<input type="checkbox" data-id="' + m.id + '" ' + checked + '>' +
        '<span class="avatar">' + esc((m.name || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="info"><span class="name">' + esc(m.name) + "</span>" +
        '<span class="num">' + esc(m.phone) + (m.location ? " &middot; " + esc(m.location) : "") + "</span></span>" +
        '<button class="del" data-id="' + m.id + '" title="Delete">&#10005;</button>' +
        "</div>";
    }).join("");

    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (cb.checked) selectedMemberIds[cb.dataset.id] = true;
        else delete selectedMemberIds[cb.dataset.id];
      });
    });
    list.querySelectorAll(".del").forEach(function (b) {
      b.addEventListener("click", function () {
        delete selectedMemberIds[b.dataset.id];
        Store.removeMember(b.dataset.id);
        renderMembers();
        populateDuesMembers();
        renderDuesSummary();
        toast("Member deleted");
        autoSync();
      });
    });
  }

  function addMember() {
    var name = $("memberName").value.trim();
    var phone = $("memberPhone").value.trim();
    var location = $("memberLocation").value.trim();
    if (!phone) { toast("Enter a phone number."); return; }
    var r = Store.addMember(name, phone, location);
    if (!r.ok) { toast(r.error); return; }
    $("memberName").value = "";
    $("memberPhone").value = "";
    $("memberLocation").value = "";
    renderMembers();
    populateDuesMembers();
    renderDuesSummary();
    toast("Member added");
    autoSync();
  }

  function importMemberCsv(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = reader.result;
      var rows = [];
      var cur = [], field = "", inQ = false;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQ) {
          if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
          else field += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ",") { cur.push(field); field = ""; }
        else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && text[i + 1] === "\n") i++;
          cur.push(field); field = "";
          if (cur.some(function (c) { return c.trim() !== ""; })) rows.push(cur);
          cur = [];
        } else field += ch;
      }
      if (field !== "" || cur.length) { cur.push(field); if (cur.some(function (c) { return c.trim() !== ""; })) rows.push(cur); }

      if (!rows.length) { toast("Empty file"); return; }
      var header = rows[0].map(function (h) { return h.toLowerCase().trim(); });
      var nameIdx = header.indexOf("name") >= 0 ? header.indexOf("name") : 0;
      var phoneIdx = header.indexOf("phone") >= 0 ? header.indexOf("phone") :
                     (header.indexOf("number") >= 0 ? header.indexOf("number") : 1);
      var locIdx = header.indexOf("location") >= 0 ? header.indexOf("location") :
                   (header.indexOf("address") >= 0 ? header.indexOf("address") : -1);
      var start = header.indexOf("name") >= 0 || header.indexOf("phone") >= 0 ? 1 : 0;

      var members = [];
      for (var j = start; j < rows.length; j++) {
        members.push({
          name: (rows[j][nameIdx] || "").trim(),
          phone: (rows[j][phoneIdx] || "").trim(),
          location: locIdx >= 0 ? (rows[j][locIdx] || "").trim() : ""
        });
      }
      var count = Store.importMembers(members);
      renderMembers();
      populateDuesMembers();
      renderDuesSummary();
      toast("Imported " + count + " member(s)");
      autoSync();
    };
    reader.readAsText(file);
  }

  /* ---------------- Attendance ---------------- */
  function renderAttendanceList() {
    var list = $("attendanceList");
    var date = $("attendanceDate").value || today();
    var members = Store.getMembers();
    var attendance = Store.getAttendanceForDate(date);

    if (!members.length) {
      list.innerHTML = '<div class="empty">No members registered. Add members first.</div>';
      return;
    }

    list.innerHTML = members.map(function (m) {
      var checked = attendance[m.id] ? "checked" : "";
      return '<div class="contact">' +
        '<input type="checkbox" data-id="' + m.id + '" ' + checked + '>' +
        '<span class="avatar">' + esc((m.name || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="info"><span class="name">' + esc(m.name) + "</span>" +
        '<span class="num">' + esc(m.phone) + (m.location ? " &middot; " + esc(m.location) : "") + "</span></span>" +
        "</div>";
    }).join("");

    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        Store.markAttendance(date, cb.dataset.id, cb.checked);
      });
    });
  }

  function saveAttendance() {
    var date = $("attendanceDate").value || today();
    var members = Store.getMembers();
    $("attendanceList").querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      Store.markAttendance(date, cb.dataset.id, cb.checked);
    });
    var attendance = Store.getAttendanceForDate(date);
    var present = 0, absent = 0;
    members.forEach(function (m) { if (attendance[m.id]) present++; else absent++; });
    $("attendanceStatus").innerHTML = '<span class="ok">Saved! ' + present + " present, " + absent + " absent for " + date + "</span>";
    toast("Attendance saved");
    autoSync();
  }

  function loadAttendance() {
    renderAttendanceList();
    var date = $("attendanceDate").value || today();
    var members = Store.getMembers();
    var attendance = Store.getAttendanceForDate(date);
    var present = 0, absent = 0;
    members.forEach(function (m) { if (attendance[m.id]) present++; else absent++; });
    $("attendanceStatus").textContent = present + " present, " + absent + " absent for " + date;
  }

  function generateAttReport() {
    var from = $("attReportFrom").value;
    var to = $("attReportTo").value;
    if (!from || !to) { toast("Select both dates."); return; }
    var report = Store.getAttendanceReport(from, to);
    if (!report.length) {
      $("attReportResult").textContent = "No attendance records in this range.";
      $("attReportTable").innerHTML = "";
      return;
    }
    var totalPresent = 0, totalSessions = report.length;
    report.forEach(function (r) { totalPresent += r.present; });
    var avg = totalSessions > 0 ? (totalPresent / totalSessions).toFixed(1) : 0;
    $("attReportResult").innerHTML = '<span class="ok">' + totalSessions + " session(s), average " + avg + " present per session</span>";

    var html = '<table class="report-table"><thead><tr><th>Date</th><th>Present</th><th>Absent</th><th>Total</th></tr></thead><tbody>';
    report.forEach(function (r) {
      html += "<tr><td>" + esc(r.date) + '</td><td class="ok">' + r.present + '</td><td class="err">' + r.absent + "</td><td>" + r.total + "</td></tr>";
    });
    html += "</tbody></table>";
    $("attReportTable").innerHTML = html;
  }

  /* ---------------- Dues ---------------- */
  function populateDuesMembers() {
    var sel = $("duesMemberSelect");
    var members = Store.getMembers();
    sel.innerHTML = '<option value="">-- choose member --</option>';
    members.forEach(function (m) {
      sel.innerHTML += '<option value="' + m.id + '">' + esc(m.name) + " (" + esc(m.phone) + ")</option>";
    });
  }

  function addDues() {
    var memberId = $("duesMemberSelect").value;
    var amount = $("duesAmount").value;
    var date = $("duesDate").value || today();
    var note = $("duesNote").value.trim();
    if (!memberId) { toast("Select a member."); return; }
    if (!amount || Number(amount) <= 0) { toast("Enter a valid amount."); return; }
    Store.addDue(memberId, amount, date, note);
    $("duesAmount").value = "";
    $("duesNote").value = "";
    renderDuesSummary();
    toast("Payment recorded");
    autoSync();
  }

  function renderDuesSummary() {
    var total = Store.getTotalDues();
    var dues = Store.getDues();
    var members = Store.getMembers();
    $("duesSummary").innerHTML = "<strong>Total collected: GHS " + total.toFixed(2) + "</strong> from " + dues.length + " payment(s) across " + members.length + " member(s)";

    var breakdown = {};
    members.forEach(function (m) { breakdown[m.id] = { name: m.name, total: 0 }; });
    dues.forEach(function (d) {
      if (breakdown[d.memberId]) breakdown[d.memberId].total += d.amount;
    });

    var el = $("duesMemberBreakdown");
    var items = Object.keys(breakdown).map(function (id) { return { name: breakdown[id].name, total: breakdown[id].total }; });
    items.sort(function (a, b) { return b.total - a.total; });

    if (!items.length) {
      el.innerHTML = '<div class="empty">No members registered yet.</div>';
      return;
    }

    el.innerHTML = items.map(function (item) {
      return '<div class="contact">' +
        '<span class="avatar">' + esc((item.name || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="info"><span class="name">' + esc(item.name) + "</span>" +
        '<span class="num">GHS ' + item.total.toFixed(2) + "</span></span>" +
        "</div>";
    }).join("");
  }

  function generateDuesReport() {
    var from = $("duesReportFrom").value;
    var to = $("duesReportTo").value;
    if (!from || !to) { toast("Select both dates."); return; }
    var report = Store.getDuesReport(from, to);
    if (!report.length) {
      $("duesReportResult").textContent = "No payments in this range.";
      $("duesReportTable").innerHTML = "";
      return;
    }
    var total = report.reduce(function (s, r) { return s + r.amount; }, 0);
    $("duesReportResult").innerHTML = '<span class="ok">' + report.length + " payment(s), total GHS " + total.toFixed(2) + "</span>";

    var html = '<table class="report-table"><thead><tr><th>Date</th><th>Member</th><th>Amount</th><th>Note</th></tr></thead><tbody>';
    report.forEach(function (r) {
      html += "<tr><td>" + esc(r.date) + "</td><td>" + esc(r.memberName) + '</td><td class="ok">GHS ' + r.amount.toFixed(2) + "</td><td>" + esc(r.note) + "</td></tr>";
    });
    html += "</tbody></table>";
    $("duesReportTable").innerHTML = html;
  }

  /* ---------------- Bulk Calls ---------------- */
  var mediaRec = null, recChunks = [], recBlob = null;

  function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast("Recording is not supported in this browser.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recChunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
      mediaRec.onstop = function () {
        recBlob = new Blob(recChunks, { type: mediaRec.mimeType || "audio/webm" });
        $("btnRecPlay").disabled = false;
        $("btnRecDownload").disabled = false;
        $("recTimer").textContent = "Recording saved (" + Math.round(recBlob.size / 1024) + " KB).";
        stream.getTracks().forEach(function (t) { t.stop(); });
      };
      mediaRec.start();
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (mediaRec && mediaRec.state === "recording") {
          $("recTimer").textContent = "Recording... " + Math.round((Date.now() - t0) / 1000) + "s";
        } else clearInterval(iv);
      }, 500);
      $("btnRecStart").classList.add("recording");
      $("btnRecStart").textContent = "Recording...";
      $("btnRecStop").disabled = false;
    }).catch(function () { toast("Microphone access denied."); });
  }

  function stopRec() {
    if (mediaRec && mediaRec.state === "recording") mediaRec.stop();
    $("btnRecStart").classList.remove("recording");
    $("btnRecStart").textContent = "Record Again";
    $("btnRecStop").disabled = true;
  }

  function playRec() {
    if (!recBlob) return;
    var reader = new FileReader();
    reader.onload = function () { new Audio(reader.result).play(); };
    reader.readAsDataURL(recBlob);
  }

  function downloadRec() {
    if (!recBlob) return;
    var reader = new FileReader();
    reader.onload = function () {
      var a = document.createElement("a");
      a.href = reader.result;
      a.download = "OYEREPA-announcement.webm";
      a.click();
    };
    reader.readAsDataURL(recBlob);
  }

  function updateCallCounts() {
    var callN = AT.parseNumbers($("callRecipients").value).length;
    $("callCount").textContent = callN + " recipient(s) selected";
  }

  function fillCallRecipients() {
    var members = Store.getMembers();
    var ids = Object.keys(selectedMemberIds).filter(function (id) { return selectedMemberIds[id]; });
    var chosen = ids.length ? members.filter(function (m) { return selectedMemberIds[m.id]; }) : members;
    if (!chosen.length) { toast("No members registered."); return; }
    var nums = chosen.map(function (m) { return m.phone; });
    var existing = $("callRecipients").value ? $("callRecipients").value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var merged = existing.concat(nums);
    var seen = {}, out = [];
    merged.forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
    $("callRecipients").value = out.join("\n");
    updateCallCounts();
    toast("Added " + nums.length + " member(s) to call list");
  }

  function logTo(el, line, cls) {
    var d = document.createElement("div");
    d.className = cls || "info";
    d.textContent = line;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  function callAll() {
    var btn = $("btnCallAll");
    var s = Store.getSettings();
    var to = AT.parseNumbers($("callRecipients").value);
    var text = $("callText").value.trim();
    var mediaUrl = $("callMediaUrl").value.trim();
    var provider = s.provider || "bmsafrica";

    if (provider === "bmsafrica" && !s.bmsafricaKey) {
      $("callProgress").textContent = "Please add your BMS Africa API Key in Settings first.";
      $("callProgress").className = "status error";
      return;
    }
    if (provider === "hellio" && !s.hellioToken) {
      $("callProgress").textContent = "Please add your Hellio API Token in Settings first.";
      $("callProgress").className = "status error";
      return;
    }
    if (provider === "arkesel" && !s.arkeselKey) {
      $("callProgress").textContent = "Please add your Arkesel API Key in Settings first.";
      $("callProgress").className = "status error";
      return;
    }
    if (provider === "africastalking" && (!s.username || !s.apiKey)) {
      $("callProgress").textContent = "Please add your Africa's Talking Username and API Key in Settings first.";
      $("callProgress").className = "status error";
      return;
    }
    if (!to.length) {
      $("callProgress").textContent = "Add at least one recipient.";
      $("callProgress").className = "status error";
      return;
    }

    btn.disabled = true;
    $("callLog").innerHTML = "";
    $("callProgress").textContent = "Calling " + to.length + " number(s)...";
    $("callProgress").className = "status";

    var job;
    if (provider === "hellio") {
      job = Hellio.sendVoice(s, to, { text: text, audioUrl: mediaUrl, voice: "alloy" });
    } else if (provider === "arkesel") {
      var audioFile = $("callAudioFile").files && $("callAudioFile").files[0];
      job = ArkeselProvider.sendVoice(s, to, { file: audioFile, voiceId: s.arkeselVoiceId });
    } else if (provider === "bmsafrica") {
      var bmsAudioFile = $("callAudioFile").files && $("callAudioFile").files[0];
      job = BmsAfrica.sendVoice(s, to, { file: bmsAudioFile, campaign: s.bmsafricaCampaign });
    } else {
      var from = $("callFrom").value.trim() || s.callFrom;
      if (!from) {
        $("callProgress").textContent = "Enter a Caller ID number.";
        $("callProgress").className = "status error";
        btn.disabled = false;
        return;
      }
      job = AT.makeCall(s, to.join("\n"), from);
    }

    job.then(function (r) {
      logTo($("callLog"), "OK: " + r.message, "ok");
      logTo($("callLog"), "Voice calls queued for " + r.total + " number(s).", "info");
      $("callProgress").textContent = "Done. Voice calls queued: " + r.total + ".";
      $("callProgress").className = "status ok";
      if (r.campaignId) {
        lastCampaignId = r.campaignId;
        $("callReportCard").classList.remove("hidden");
        logTo($("callLog"), "Campaign ID: " + r.campaignId + " - refreshing report in 5 seconds...", "info");
        setTimeout(function () { loadCallReport(r.campaignId); }, 5000);
      }
      refreshBalance();
    }).catch(function (e) {
      logTo($("callLog"), "ERROR: " + e.message, "err");
      $("callProgress").textContent = "Failed: " + e.message;
      $("callProgress").className = "status error";
    }).then(function () {
      btn.disabled = false;
    });
  }

  /* ---------------- Call Report ---------------- */
  function loadCallReport(campaignId) {
    var s = Store.getSettings();
    var p = s.provider || "bmsafrica";
    if (p !== "bmsafrica" || !campaignId || !s.bmsafricaKey) return;

    $("callReportSummary").textContent = "Loading report...";
    $("callReportList").innerHTML = "";

    BmsAfrica.getCallReport(s, campaignId, null).then(function (r) {
      var received = r.received.length;
      var missed = r.missed.length;
      var pending = r.pending.length;
      var total = r.all.length;
      $("callReportSummary").innerHTML =
        "<strong>" + received + " answered</strong> &middot; " +
        "<strong>" + missed + " missed</strong> &middot; " +
        (pending ? "<strong>" + pending + " pending</strong> &middot; " : "") +
        total + " total";

      if (!total) {
        $("callReportList").innerHTML = '<div style="color:var(--muted);padding:0.5rem 0;">No data yet. Tap Refresh in a few seconds.</div>';
        return;
      }

      var html = '<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">' +
        '<button class="btn btn-ghost report-tab active" data-filter="all" style="font-size:0.8rem;">All (' + total + ")</button>" +
        '<button class="btn btn-ghost report-tab" data-filter="received" style="font-size:0.8rem;color:var(--green);">Answered (' + received + ")</button>" +
        '<button class="btn btn-ghost report-tab" data-filter="missed" style="font-size:0.8rem;color:var(--red);">Missed (' + missed + ")</button>" +
        "</div>";
      r.all.forEach(function (e) {
        var badge = e.status === "received" ? '<span class="call-badge answered">Answered</span>' :
                    e.status === "missed" ? '<span class="call-badge missed">Missed</span>' :
                    '<span class="call-badge pending">Pending</span>';
        var duration = e.totalDuration ? " &middot; " + e.totalDuration + "s" : "";
        html += '<div class="call-entry" data-status="' + e.status + '">' +
          '<span class="call-phone">' + esc(e.phone) + "</span>" + badge +
          (duration ? '<span class="call-duration">' + duration + "</span>" : "") +
          "</div>";
      });
      $("callReportList").innerHTML = html;

      $("callReportList").querySelectorAll(".report-tab").forEach(function (b) {
        b.addEventListener("click", function () {
          $("callReportList").querySelectorAll(".report-tab").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          var filter = b.dataset.filter;
          $("callReportList").querySelectorAll(".call-entry").forEach(function (el) {
            el.style.display = (filter === "all" || el.dataset.status === filter) ? "" : "none";
          });
        });
      });
    }).catch(function (e) {
      $("callReportSummary").textContent = "Could not load report: " + e.message;
    });
  }

  /* ---------------- Voice Wallet ---------------- */
  function refreshBalance() {
    var s = Store.getSettings();
    var p = s.provider || "bmsafrica";
    if (p !== "bmsafrica") {
      $("voiceBalanceDisplay").textContent = "Balance shown for BMS Africa only.";
      return;
    }
    if (!s.bmsafricaKey) {
      $("voiceBalanceDisplay").textContent = "Add your BMS Africa API key in Settings first.";
      return;
    }
    $("voiceBalanceDisplay").textContent = "Loading balance...";
    BmsAfrica.getBalance(s).then(function (b) {
      $("voiceBalanceDisplay").innerHTML = "<strong>" + b.minutes + " min " + b.seconds + " sec</strong> voice time remaining (" + b.credits + " credits)";
    }).catch(function (e) {
      $("voiceBalanceDisplay").textContent = "Could not load balance: " + e.message;
    });
  }

  function doTopUp() {
    var s = Store.getSettings();
    if (s.provider !== "bmsafrica") { toast("Top-up is only available for BMS Africa."); return; }
    if (!s.bmsafricaKey) { toast("Add your BMS Africa API key in Settings first."); return; }
    $("btnTopUp").disabled = true;
    $("btnTopUp").textContent = "Opening dashboard...";
    BmsAfrica.topUp(s).then(function (r) {
      window.open(r.url, "_blank");
      $("btnTopUp").textContent = "Top Up Wallet";
      $("btnTopUp").disabled = false;
      toast("Dashboard opened. Top up, then tap Refresh Balance.");
    }).catch(function (e) {
      $("btnTopUp").textContent = "Top Up Wallet";
      $("btnTopUp").disabled = false;
      toast("Could not open dashboard: " + e.message);
    });
  }

  /* ---------------- Settings ---------------- */
  function loadSettingsIntoForm() {
    S = Store.getSettings();
    $("orgSwitcher").value = S.org || "oyerepa-ladies";
    $("setProvider").value = S.provider || "bmsafrica";
    $("setBmsAfricaKey").value = S.bmsafricaKey || "";
    $("setHellioToken").value = S.hellioToken || "";
    $("setArkeselKey").value = S.arkeselKey || "";
    $("setArkeselVoiceId").value = S.arkeselVoiceId || "";
    $("setArkeselSender").value = S.arkeselSender || "";
    $("setUsername").value = S.username;
    $("setApiKey").value = S.apiKey;
    $("setMode").value = S.mode || "sandbox";
    $("setCallFrom").value = S.callFrom || "";
    $("setProxyUrl").value = S.proxyUrl || "";
    $("setFbUrl").value = S.fbUrl || "";
    $("setFbPassword").value = S.fbPassword || "";
    applyProviderUI();
    updateShareLink();
  }

  function saveSettingsFromForm() {
    S = Store.getSettings();
    S.org = $("orgSwitcher").value;
    S.provider = $("setProvider").value;
    S.bmsafricaKey = $("setBmsAfricaKey").value.trim();
    S.hellioToken = $("setHellioToken").value.trim();
    S.arkeselKey = $("setArkeselKey").value.trim();
    S.arkeselVoiceId = $("setArkeselVoiceId").value.trim();
    S.arkeselSender = $("setArkeselSender").value.trim() || "OYEREPA LADIES";
    S.username = $("setUsername").value.trim();
    S.apiKey = $("setApiKey").value.trim();
    S.mode = $("setMode").value;
    S.callFrom = $("setCallFrom").value.trim();
    S.proxyUrl = $("setProxyUrl").value.trim();
    S.fbUrl = $("setFbUrl").value.trim();
    S.fbPassword = $("setFbPassword").value.trim();
    Store.saveSettings(S);
    updateShareLink();
    applyProviderUI();
    $("settingsStatus").textContent = "Saved on this device.";
    $("settingsStatus").className = "status ok";

    if (S.fbUrl) {
      $("settingsStatus").textContent = "Saved. Uploading to the cloud...";
      Store.syncPush(S).then(function (r) {
        if (r.ok) {
          $("settingsStatus").textContent = "Saved and synced to the cloud.";
          $("settingsStatus").className = "status ok";
        } else {
          $("settingsStatus").textContent = "Saved locally, cloud sync failed: " + r.error;
          $("settingsStatus").className = "status error";
        }
      });
    }
  }

  function updateShareLink() {
    var s = Store.getSettings();
    $("fbShareLink").textContent = s.fbUrl ? "Cloud ready: other phones open the same site and tap Sync from cloud." : "";
  }

  function applyProviderUI() {
    var p = ($("setProvider").value || "bmsafrica");
    $("provider-hellio").classList.toggle("hidden", p !== "hellio");
    $("provider-arkesel").classList.toggle("hidden", p !== "arkesel");
    $("provider-at").classList.toggle("hidden", p !== "africastalking");
    $("provider-bmsafrica").classList.toggle("hidden", p !== "bmsafrica");

    $("callFromField").classList.toggle("hidden", p !== "africastalking");
    $("callTextField").classList.toggle("hidden", p === "bmsafrica" || p === "arkesel" || p === "africastalking");
    $("callAudioField").classList.toggle("hidden", p !== "arkesel" && p !== "bmsafrica");
    $("callMediaField").classList.toggle("hidden", p === "arkesel" || p === "bmsafrica");
    $("voiceWalletCard").classList.toggle("hidden", p !== "bmsafrica");

    if (p === "hellio") {
      $("callTextHint").textContent = "Hellio reads this message aloud automatically.";
      $("callText").placeholder = "Type the message that will be spoken...";
    } else if (p === "arkesel") {
      $("callAudioFileHint").textContent = "Arkesel sends a recorded audio file. .webm recordings are converted to WAV automatically.";
    } else if (p === "bmsafrica") {
      $("callAudioFileHint").textContent = "BMS Africa sends a recorded audio file. .webm recordings are converted to WAV automatically.";
    } else {
      $("callTextHint").textContent = "Africa's Talking plays audio from your hosted voice call flow.";
    }
  }

  function testApi() {
    saveSettingsFromForm();
    S = Store.getSettings();
    $("apiTestResult").textContent = "Testing connection...";
    $("apiTestResult").className = "status";
    var p = S.provider || "bmsafrica";
    var job = p === "hellio" ? Hellio.testConnection(S)
            : p === "arkesel" ? ArkeselProvider.testConnection(S)
            : p === "bmsafrica" ? BmsAfrica.testConnection(S)
            : AT.testConnection(S);
    job.then(function (r) {
      $("apiTestResult").textContent = r.balance !== null
        ? "Connected! Balance: " + (r.currency ? r.currency + " " : "") + r.balance
        : "Connected!";
      $("apiTestResult").className = "status ok";
    }).catch(function (e) {
      $("apiTestResult").textContent = "Connection failed: " + e.message;
      $("apiTestResult").className = "status error";
    });
  }

  /* ---------------- Init ---------------- */
  function wire() {
    /* Org switcher */
    $("orgSwitcher").addEventListener("change", switchOrg);

    /* Members */
    $("btnAddMember").addEventListener("click", addMember);
    $("btnImportMemberCsv").addEventListener("click", function () { $("fileMemberCsv").click(); });
    $("fileMemberCsv").addEventListener("change", function () {
      if (this.files[0]) importMemberCsv(this.files[0]);
      this.value = "";
    });
    $("memberSearch").addEventListener("input", renderMembers);
    $("btnSelectAllMembers").addEventListener("click", function () {
      Store.getMembers().forEach(function (m) { selectedMemberIds[m.id] = true; });
      renderMembers();
    });
    $("btnClearMemberSel").addEventListener("click", function () {
      selectedMemberIds = {};
      renderMembers();
    });
    $("btnDeleteMemberSel").addEventListener("click", function () {
      var ids = Object.keys(selectedMemberIds).filter(function (id) { return selectedMemberIds[id]; });
      if (!ids.length) { toast("Select members first."); return; }
      var remaining = Store.getMembers().filter(function (m) { return !selectedMemberIds[m.id]; });
      Store.saveMembers(remaining);
      selectedMemberIds = {};
      renderMembers();
      populateDuesMembers();
      renderDuesSummary();
      toast("Deleted " + ids.length + " member(s)");
      autoSync();
    });
    $("btnCallMembers").addEventListener("click", function () {
      fillCallRecipients();
      showTab("calls");
    });

    /* Attendance */
    $("attendanceDate").addEventListener("change", renderAttendanceList);
    $("btnSaveAttendance").addEventListener("click", saveAttendance);
    $("btnLoadAttendance").addEventListener("click", loadAttendance);
    $("btnAttReport").addEventListener("click", generateAttReport);

    /* Dues */
    $("btnAddDues").addEventListener("click", addDues);
    $("btnDuesReport").addEventListener("click", generateDuesReport);

    /* Calls */
    $("callRecipients").addEventListener("input", updateCallCounts);
    $("callAddAll").addEventListener("click", fillCallRecipients);
    $("callAddSelected").addEventListener("click", fillCallRecipients);
    $("btnRecStart").addEventListener("click", startRec);
    $("btnRecStop").addEventListener("click", stopRec);
    $("btnRecPlay").addEventListener("click", playRec);
    $("btnRecDownload").addEventListener("click", downloadRec);
    $("btnCallAll").addEventListener("click", callAll);
    $("btnRefreshBalance").addEventListener("click", refreshBalance);
    $("btnTopUp").addEventListener("click", doTopUp);
    $("btnRefreshReport").addEventListener("click", function () {
      if (lastCampaignId) loadCallReport(lastCampaignId);
      else toast("No campaign to refresh. Send a call first.");
    });

    /* Settings */
    $("setProvider").addEventListener("change", function () {
      applyProviderUI();
      refreshBalance();
    });
    $("btnSaveSettings").addEventListener("click", saveSettingsFromForm);
    $("btnTestApi").addEventListener("click", testApi);
    $("btnSyncNow").addEventListener("click", function () {
      var s = Store.getSettings();
      $("settingsStatus").textContent = "Syncing from cloud...";
      $("settingsStatus").className = "status";
      Store.syncPull(s).then(function (r) {
        if (r.ok) {
          loadSettingsIntoForm();
          renderDashboard();
          renderMembers();
          populateDuesMembers();
          renderDuesSummary();
          $("settingsStatus").textContent = "Synced from the cloud.";
          $("settingsStatus").className = "status ok";
          toast("Cloud synced");
        } else {
          $("settingsStatus").textContent = "Sync failed: " + r.error;
          $("settingsStatus").className = "status error";
        }
      });
    });
    $("btnClearLocal").addEventListener("click", function () {
      if (!confirm("Reset all settings and data on THIS device?")) return;
      localStorage.removeItem(Store.LS_SETTINGS);
      localStorage.removeItem(Store.LS_CONTACTS);
      loadSettingsIntoForm();
      renderDashboard();
      renderMembers();
      populateDuesMembers();
      renderDuesSummary();
      toast("This device reset");
    });
  }

  /* --- Settings Password Gate --- */
  (function () {
    var gate = $("settingsGate");
    var content = $("settingsContent");
    if (!gate || !content) return;
    var unlocked = sessionStorage.getItem("oyp_settings_unlocked") === "1";
    if (unlocked) { gate.style.display = "none"; content.classList.remove("hidden"); }
    $("btnUnlockSettings").addEventListener("click", function () {
      var pw = $("settingsPassword").value;
      if (pw === "1234") {
        sessionStorage.setItem("oyp_settings_unlocked", "1");
        gate.style.display = "none";
        content.classList.remove("hidden");
      } else {
        $("unlockStatus").textContent = "Wrong password.";
        $("unlockStatus").className = "status error";
      }
    });
    $("settingsPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("btnUnlockSettings").click();
    });
  })();

  /* --- Dashboard --- */
  function renderDashboard() {
    var members = Store.getMembers();
    var dues = Store.getDues();
    var total = Store.getTotalDues();
    var att = Store.getAttendance();
    var el;
    el = $("dashMemberCount"); if (el) el.textContent = members.length;
    el = $("dashDuesTotal"); if (el) el.textContent = "GHS " + total.toFixed(2);
    el = $("dashDuesCount"); if (el) el.textContent = dues.length;
    el = $("dashAttCount"); if (el) el.textContent = att.length;
    el = $("topbarOrg"); if (el) el.textContent = Store.ORG_LABELS[S.org] || "OYEREPA LADIES";
  }

  /* --- Boot --- */
  $("attendanceDate").value = today();
  $("duesDate").value = today();
  wire();
  loadSettingsIntoForm();
  renderDashboard();
  renderMembers();
  populateDuesMembers();
  renderDuesSummary();
  renderAttendanceList();
  updateCallCounts();
  updateShareLink();
  refreshBalance();
})();