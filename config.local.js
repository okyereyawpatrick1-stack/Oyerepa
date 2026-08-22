/* config.local.js
 * THIS FILE IS PRIVATE - NEVER UPLOAD IT TO GITHUB.
 * It fills your settings into this browser on first open.
 * It is listed in .gitignore so it won't be pushed if you use git.
 * If you upload files to GitHub with the web upload page, DO NOT include this file.
 * You can delete this file after you tap "Save Settings" once - the values are
 * then stored inside your browser and synced to the cloud automatically.
 */
(function () {
  try {
    var raw = localStorage.getItem("oyp_settings");
    var s = raw ? JSON.parse(raw) : {};

    if (!s.provider) s.provider = "bmsafrica";

    /* Auto-fill BMS Africa key on first open so you never have to type it. */
    if (!s.bmsafricaKey) s.bmsafricaKey = "Gb8CzHCDRCmhlmVFvJl4Tq6Fo";
    if (!s.bmsafricaCampaign) s.bmsafricaCampaign = "OYEREPA LADIES";

    /* Only auto-fill the Africa's Talking Sandbox test credentials while the
     * AT provider is selected AND not live. Hellio/Arkesel keys are never
     * touched here. */
    if (s.provider === "africastalking" && s.mode !== "live") {
      s.apiKey = "atsk_67c5a73ff400b7ea3749d5a21494cb525c94418c4b1726d9c63bdf05da7695d32079b7d8";
      s.username = "sandbox";
      s.mode = "sandbox";
      s.callFrom = "233594721229";
      s.smsFrom = "OYEREPA LADIES";
    }

    if (!s.proxyUrl) {
      s.proxyUrl = "https://oyp-proxy.okyereyawpatrick1.workers.dev";
    }

    if (!s.fbUrl) {
      s.fbUrl = "https://oyerpaladies-default-rtdb.firebaseio.com";
    }

    localStorage.setItem("oyp_settings", JSON.stringify(s));
  } catch (e) {}
})();
