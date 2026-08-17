/**
 * Basic-auth gate for staging.mybestbuddy.fun.
 *
 * Firebase Hosting serves static files with no way to require credentials, so
 * the staging site rewrites every request to this function instead: it checks
 * the Authorization header first, then serves the built app from its own bundled
 * copy of `app/dist`.
 *
 * Scope check: this protects the *devnet* preview from being stumbled upon,
 * indexed, or mistaken for the real thing. It is not a security boundary: basic
 * auth over HTTPS is fine for that job and nothing more. Never put a mainnet
 * secret behind it.
 */
const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");

const USER = process.env.STAGING_USER || "buddy";
const PASSWORD = process.env.STAGING_PASSWORD || "";

/**
 * Constant-time-ish comparison. Basic auth is not the security boundary here,
 * but leaking length or a prefix through early return costs nothing to avoid.
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAuth(req, res, next) {
  // Fail closed. A missing password must never mean "let everyone in".
  if (!PASSWORD) {
    res.status(503).send("Staging auth is not configured.");
    return;
  }

  const header = req.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator !== -1) {
      const user = decoded.slice(0, separator);
      const pass = decoded.slice(separator + 1);
      if (safeEqual(user, USER) && safeEqual(pass, PASSWORD)) {
        next();
        return;
      }
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Buddy staging", charset="UTF-8"');
  res.status(401).send("Authentication required.");
}

const app = express();

// Staging must never appear in search results, even if the password leaks.
app.use((req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use(requireAuth);
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: "1h" }));

// Single-page app: anything not matching a file falls through to index.html.
app.get("*", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

exports.stagingGate = onRequest(
  { region: "us-central1", memory: "256MiB", maxInstances: 3 },
  app
);

// The influencer terms register lives in its own module but must be exported
// from the functions entry point to be deployable.
exports.terms = require("./terms").terms;
