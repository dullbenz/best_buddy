/**
 * Basic-auth gate for the staging game hub.
 *
 * Same shape as the gate protecting staging.mybestbuddy.fun in
 * functions/index.js, and deliberately a separate function rather than a reuse
 * of it: that one serves the claim site's build from its own bundle, and making
 * one function serve both would mean a game hub deploy could ship whichever
 * claim-site build happened to be lying around. Two gates, two bundles, no
 * coupling.
 *
 * Scope check, unchanged from the original: this keeps the devnet preview from
 * being stumbled upon, indexed, or mistaken for the real thing. It is not a
 * security boundary. Never put a mainnet secret behind it.
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const USER = process.env.STAGING_USER || "buddy";
const PASSWORD = process.env.STAGING_PASSWORD || "";

/** Constant-time-ish comparison: leaking a length or a prefix costs nothing to avoid. */
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

  res.set("WWW-Authenticate", 'Basic realm="Buddy game hub staging", charset="UTF-8"');
  res.status(401).send("Authentication required.");
}

export function makeGate() {
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

  return app;
}
