/* store.js - shared storage
 * Uses localStorage on each device, and optionally a free Firebase
 * Realtime Database to share settings + contacts across many phones.
 * Firebase is accessed via its plain REST API (no SDK needed).
 */
(function (global) {
  "use strict";

  var LS_SETTINGS = "oyp_settings";
  var LS_CONTACTS = "oyp_contacts";
  var ORGS = ["oyerepa-ladies", "oyerepa-funclub"];
  var ORG_LABELS = { "oyerepa-ladies": "OYEREPA LADIES", "oyerepa-funclub": "OYEREPA FUN CLUB" };

  function defaultSettings() {
    return {
      org: "oyerepa-ladies",
      provider: "bmsafrica",
      username: "",
      apiKey: "",
      mode: "sandbox",
      smsFrom: "OYEREPA LADIES",
      callFrom: "",
      proxyUrl: "",
      fbUrl: "",
      fbPassword: "",
      hellioToken: "",
      arkeselKey: "",
      arkeselVoiceId: "",
      arkeselSender: "OYEREPA LADIES",
      bmsafricaKey: "",
      bmsafricaCampaign: "OYEREPA LADIES"
    };
  }

  function uid() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizePhone(p) {
    if (!p) return "";
    p = String(p).trim().replace(/[^\d+]/g, "");
    if (p.length === 9) return "233" + p;
    if (p.length === 10 && p.charAt(0) === "0") return "233" + p.slice(1);
    if (p.length === 13 && p.indexOf("233") === 0) return p;
    if (p.length === 12 && p.charAt(0) === "+") return p.slice(1);
    return p;
  }

  function normalizeAll() {
    var c = getContacts();
    var changed = false;
    c.forEach(function (ct) {
      var n = normalizePhone(ct.phone);
      if (n !== ct.phone) { ct.phone = n; changed = true; }
    });
    if (changed) saveContacts(c);
    return c;
  }

  function getSettings() {
    var s = defaultSettings();
    try {
      var raw = localStorage.getItem(LS_SETTINGS);
      if (raw) Object.assign(s, JSON.parse(raw));
    } catch (e) {}
    return s;
  }

  function saveSettings(s) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  }

  function getContacts() {
    try {
      var raw = localStorage.getItem(LS_CONTACTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveContacts(c) {
    localStorage.setItem(LS_CONTACTS, JSON.stringify(c));
  }

  function addContact(name, phone) {
    var c = getContacts();
    phone = normalizePhone(phone);
    if (!phone) return { ok: false, error: "No valid phone number." };
    var dup = c.some(function (x) { return x.phone === phone; });
    if (dup) return { ok: false, error: "That number already exists." };
    c.push({ id: uid(), name: name || "Unnamed", phone: phone, added: Date.now() });
    saveContacts(c);
    return { ok: true };
  }

  function removeContact(id) {
    saveContacts(getContacts().filter(function (c) { return c.id !== id; }));
  }

  /* ------- Organization-scoped storage (members, attendance, dues) ------- */

  function orgKey(org, suffix) {
    return "oyp_" + org + "_" + suffix;
  }

  function getOrg() {
    return getSettings().org || "oyerepa-ladies";
  }

  function getMembers(org) {
    org = org || getOrg();
    try {
      var raw = localStorage.getItem(orgKey(org, "members"));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveMembers(members, org) {
    org = org || getOrg();
    localStorage.setItem(orgKey(org, "members"), JSON.stringify(members));
  }

  function addMember(name, phone, location, org) {
    var m = getMembers(org);
    phone = normalizePhone(phone);
    if (!phone) return { ok: false, error: "No valid phone number." };
    var dup = m.some(function (x) { return x.phone === phone; });
    if (dup) return { ok: false, error: "That member already exists." };
    m.push({ id: uid(), name: name || "Unnamed", phone: phone, location: location || "", added: Date.now() });
    saveMembers(m, org);
    return { ok: true };
  }

  function removeMember(id, org) {
    saveMembers(getMembers(org).filter(function (m) { return m.id !== id; }), org);
  }

  function importMembers(rows, org) {
    var m = getMembers(org);
    var count = 0;
    rows.forEach(function (r) {
      var phone = normalizePhone(r.phone || "");
      if (!phone) return;
      var dup = m.some(function (x) { return x.phone === phone; });
      if (dup) return;
      m.push({ id: uid(), name: r.name || "Unnamed", phone: phone, location: r.location || "", added: Date.now() });
      count++;
    });
    saveMembers(m, org);
    return count;
  }

  /* Attendance: { date: "YYYY-MM-DD", members: { memberId: true/false } } */
  function getAttendance(org) {
    org = org || getOrg();
    try {
      var raw = localStorage.getItem(orgKey(org, "attendance"));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveAttendance(records, org) {
    org = org || getOrg();
    localStorage.setItem(orgKey(org, "attendance"), JSON.stringify(records));
  }

  function markAttendance(date, memberId, present, org) {
    var records = getAttendance(org);
    var rec = records.find(function (r) { return r.date === date; });
    if (!rec) {
      rec = { date: date, members: {} };
      records.push(rec);
    }
    rec.members[memberId] = present;
    saveAttendance(records, org);
    return { ok: true };
  }

  function getAttendanceForDate(date, org) {
    var records = getAttendance(org);
    var rec = records.find(function (r) { return r.date === date; });
    return rec ? rec.members : {};
  }

  function getAttendanceReport(fromDate, toDate, org) {
    var records = getAttendance(org);
    var members = getMembers(org);
    var report = [];
    records.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    records.forEach(function (rec) {
      if (fromDate && rec.date < fromDate) return;
      if (toDate && rec.date > toDate) return;
      var present = 0, absent = 0;
      members.forEach(function (m) {
        if (rec.members[m.id]) present++;
        else absent++;
      });
      report.push({ date: rec.date, present: present, absent: absent, total: members.length });
    });
    return report;
  }

  /* Dues: { memberId, amount, date, note } */
  function getDues(org) {
    org = org || getOrg();
    try {
      var raw = localStorage.getItem(orgKey(org, "dues"));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveDues(records, org) {
    org = org || getOrg();
    localStorage.setItem(orgKey(org, "dues"), JSON.stringify(records));
  }

  function addDue(memberId, amount, date, note, org) {
    var d = getDues(org);
    d.push({ id: uid(), memberId: memberId, amount: Number(amount) || 0, date: date, note: note || "" });
    saveDues(d, org);
    return { ok: true };
  }

  function removeDue(id, org) {
    saveDues(getDues(org).filter(function (d) { return d.id !== id; }), org);
  }

  function getDuesForMember(memberId, org) {
    return getDues(org).filter(function (d) { return d.memberId === memberId; });
  }

  function getTotalDues(org) {
    return getDues(org).reduce(function (sum, d) { return sum + d.amount; }, 0);
  }

  function getDuesReport(fromDate, toDate, org) {
    var dues = getDues(org);
    var members = getMembers(org);
    var report = [];
    dues.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    dues.forEach(function (d) {
      if (fromDate && d.date < fromDate) return;
      if (toDate && d.date > toDate) return;
      var member = members.find(function (m) { return m.id === d.memberId; });
      report.push({ date: d.date, memberName: member ? member.name : "Unknown", amount: d.amount, note: d.note });
    });
    return report;
  }

  /* ------- Firebase Realtime Database REST helpers ------- */

  function fbUrl(dbUrl, path) {
    return dbUrl.replace(/\/+$/, "") + "/" + path + ".json";
  }

  function fbFetch(dbUrl, path, method, body) {
    return fetch(fbUrl(dbUrl, path), {
      method: method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" }
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    });
  }

  function syncPush(s) {
    if (!s.fbUrl) return Promise.resolve({ ok: false, error: "No Firebase URL set." });
    var orgData = {};
    ORGS.forEach(function (org) {
      orgData[org] = {
        members: getMembers(org),
        attendance: getAttendance(org),
        dues: getDues(org)
      };
    });
    var data = {
      settings: s,
      contacts: getContacts(),
      orgs: orgData
    };
    if (s.fbPassword) data.password = s.fbPassword;
    return fbFetch(s.fbUrl, "oyp", "PUT", data).then(function (res) {
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: "Could not reach Firebase: " + e.message };
    });
  }

  function syncPull(s) {
    if (!s.fbUrl) return Promise.resolve({ ok: false, error: "No Firebase URL set." });
    return fbFetch(s.fbUrl, "oyp", "GET").then(function (res) {
      if (!res || !res.settings) {
        return { ok: false, error: "Nothing in the cloud yet. Save Settings on one device first." };
      }
      if (s.fbPassword && res.password && res.password !== s.fbPassword) {
        return { ok: false, error: "Wrong share password." };
      }
      saveSettings(res.settings);
      if (Array.isArray(res.contacts)) saveContacts(res.contacts);
      if (res.orgs) {
        ORGS.forEach(function (org) {
          if (res.orgs[org]) {
            if (Array.isArray(res.orgs[org].members)) saveMembers(res.orgs[org].members, org);
            if (Array.isArray(res.orgs[org].attendance)) saveAttendance(res.orgs[org].attendance, org);
            if (Array.isArray(res.orgs[org].dues)) saveDues(res.orgs[org].dues, org);
          }
        });
      }
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: "Could not reach Firebase: " + e.message };
    });
  }

  global.Store = {
    LS_SETTINGS: LS_SETTINGS,
    LS_CONTACTS: LS_CONTACTS,
    ORGS: ORGS,
    ORG_LABELS: ORG_LABELS,
    defaultSettings: defaultSettings,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getContacts: getContacts,
    saveContacts: saveContacts,
    addContact: addContact,
    removeContact: removeContact,
    normalizePhone: normalizePhone,
    normalizeAll: normalizeAll,
    uid: uid,
    syncPush: syncPush,
    syncPull: syncPull,
    getOrg: getOrg,
    getMembers: getMembers,
    saveMembers: saveMembers,
    addMember: addMember,
    removeMember: removeMember,
    importMembers: importMembers,
    getAttendance: getAttendance,
    saveAttendance: saveAttendance,
    markAttendance: markAttendance,
    getAttendanceForDate: getAttendanceForDate,
    getAttendanceReport: getAttendanceReport,
    getDues: getDues,
    saveDues: saveDues,
    addDue: addDue,
    removeDue: removeDue,
    getDuesForMember: getDuesForMember,
    getTotalDues: getTotalDues,
    getDuesReport: getDuesReport
  };
})(window);
