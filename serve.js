var http = require("http");
var fs = require("fs");
var path = require("path");
var port = process.env.PORT || 8080;
var root = __dirname;

var mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

http.createServer(function (req, res) {
  var urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); } catch (e) { urlPath = "/"; }
  if (urlPath === "/") urlPath = "/index.html";
  var file = path.normalize(path.join(root, urlPath));
  if (file.indexOf(root) !== 0) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("Not found: " + urlPath);
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, function () {
  console.log("OYEREPA LADIES is running at: http://localhost:" + port);
  console.log("Keep this window open. Close it to stop the site.");
  var exec = require("child_process").exec;
  exec('start http://localhost:' + port);
});
