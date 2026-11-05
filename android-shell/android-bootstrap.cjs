// Node.js Mobile entrypoint for the bundled Next.js standalone server.
// The server binds to loopback, and only requests with this installation's
// unguessable session cookie can reach application routes.
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const secret = fs.readFileSync(process.argv[2], "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid local server secret");
process.env.NODE_ENV = "production";
process.env.NEXT_PUBLIC_SELF_HOSTED_MODE = "true";
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = "18471";
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.chdir(__dirname);
const originalCreateServer = http.createServer;
function equal(a, b) {
  const x = Buffer.from(a || ""); const y = Buffer.from(b || "");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
http.createServer = function (...args) {
  const listenerIndex = args.findIndex(arg => typeof arg === "function");
  if (listenerIndex >= 0) {
    const listener = args[listenerIndex];
    args[listenerIndex] = (req, res) => {
      const url = new URL(req.url || "/", "http://localhost:18471");
      if (url.pathname === "/__xunxin_health" && /^[a-f0-9]{32}$/.test(url.searchParams.get("nonce") || "")) {
        res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end(crypto.createHmac("sha256", secret).update(url.searchParams.get("nonce")).digest("hex"));
        return;
      }
      if (!/^localhost(?::18471)?$/i.test(req.headers.host || "")) {
        res.writeHead(403); res.end("Forbidden"); return;
      }
      if (url.pathname === "/" && equal(url.searchParams.get("xunxin_start"), secret)) {
        res.writeHead(302, { "Set-Cookie": `xunxin_local=${secret}; HttpOnly; SameSite=Strict; Path=/`, "Location": "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        res.end(); return;
      }
      const cookie = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("xunxin_local="));
      if (!equal(cookie?.slice("xunxin_local=".length), secret)) {
        res.writeHead(403, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); res.end("Forbidden"); return;
      }
      return listener(req, res);
    };
  }
  return originalCreateServer.apply(this, args);
};
require(path.join(__dirname, "server.js"));
