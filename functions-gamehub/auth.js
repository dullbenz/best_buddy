/**
 * Sign-In With Solana.
 *
 * The wallet signs a server-issued message; the server verifies the ed25519
 * signature and mints a Firebase custom token. The client trades that for an ID
 * token and sends it as a bearer token on every call.
 *
 * This deliberately differs from the influencer terms register in
 * `functions/terms.js`, which verifies a signature over a fixed public string.
 * That signature is an attestation and is meant to be replayable forever. A
 * login must not be, so the signed bytes here carry a single-use nonce, an
 * expiry, the cluster, and the domain: a signature captured from staging cannot
 * be replayed on production, and a signature captured at all cannot be replayed
 * twice.
 *
 * Firebase Auth is used rather than a self-issued JWT because the hub reads
 * leaderboards and the live pet counter straight from Firestore. Those reads
 * need a Firebase identity to be governed by security rules, and this way there
 * is no signing secret to hold, rotate, or leak through the deploy-time .env.
 */
import { getAuth } from "firebase-admin/auth";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { randomBytes } from "node:crypto";

import { col, FieldValue, Timestamp, db } from "./db.js";
import { badRequest, forbidden, handler, unauthorized } from "./middleware.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const DOMAINS = {
  "mainnet-beta": "gamehub.mybestbuddy.fun",
  devnet: "gamehub-staging.mybestbuddy.fun",
};

/** Decode a base58 Solana address, or reject it. Mirrors functions/terms.js. */
export function parseAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return null;
  try {
    const bytes = bs58.decode(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function parseSignature(value) {
  if (typeof value !== "string") return null;
  try {
    const bytes = bs58.decode(value);
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The exact bytes the wallet is asked to sign.
 *
 * Rebuilt server-side at verification time from stored values — the copy handed
 * to the client is for display only, so a client that lies about what it showed
 * the user simply fails to verify.
 */
export function buildSignInMessage({ domain, wallet, cluster, nonce, issuedAt, expiresAt }) {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to the Best Buddy game hub. This is free and moves no funds.",
    "",
    `Cluster: ${cluster}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join("\n");
}

export function adminWallets() {
  return (process.env.GAMEHUB_ADMIN_WALLETS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function mountAuthRoutes(app, cluster) {
  const domain = DOMAINS[cluster];

  app.post(
    "/auth/challenge",
    handler(async (req, res) => {
      const wallet = req.body?.wallet;
      if (!parseAddress(wallet)) {
        throw badRequest("BAD_WALLET", "That is not a Solana address.");
      }

      const nonce = bs58.encode(randomBytes(32));
      const now = new Date();
      const expires = new Date(now.getTime() + NONCE_TTL_MS);
      const issuedAt = now.toISOString();
      const expiresAt = expires.toISOString();

      await col(cluster, "authNonces")
        .doc(nonce)
        .set({
          wallet,
          used: false,
          issuedAt,
          expiresAtIso: expiresAt,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromDate(new Date(expires.getTime() + NONCE_TTL_MS)),
        });

      res.json({
        nonce,
        expiresAt,
        message: buildSignInMessage({ domain, wallet, cluster, nonce, issuedAt, expiresAt }),
      });
    }),
  );

  app.post(
    "/auth/verify",
    handler(async (req, res) => {
      const { wallet, nonce, signature } = req.body || {};
      const publicKey = parseAddress(wallet);
      const signatureBytes = parseSignature(signature);
      if (!publicKey) throw badRequest("BAD_WALLET", "That is not a Solana address.");
      if (!signatureBytes) throw badRequest("BAD_SIGNATURE", "Signature must be 64 bytes, base58.");
      if (typeof nonce !== "string" || nonce.length < 32) {
        throw badRequest("BAD_NONCE", "Missing sign-in nonce.");
      }

      const ref = col(cluster, "authNonces").doc(nonce);

      // Burn the nonce transactionally before checking the signature, so two
      // concurrent verifications of the same challenge cannot both succeed.
      const record = await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const data = snapshot.data();
        if (data.used) return null;
        if (new Date(data.expiresAtIso).getTime() < Date.now()) return null;
        tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
        return data;
      });

      if (!record || record.wallet !== wallet) {
        throw unauthorized("CHALLENGE_INVALID", "That sign-in request expired. Try again.");
      }

      const message = buildSignInMessage({
        domain,
        wallet,
        cluster,
        nonce,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAtIso,
      });

      const verified = nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        signatureBytes,
        publicKey,
      );
      if (!verified) {
        throw unauthorized("SIGNATURE_INVALID", "That signature does not match your wallet.");
      }

      const isAdmin = adminWallets().includes(wallet);
      const token = await getAuth().createCustomToken(`${cluster}:${wallet}`, {
        wallet,
        cluster,
        admin: isAdmin,
      });

      res.json({ token, wallet, cluster, admin: isAdmin });
    }),
  );
}

/**
 * Require a signed-in wallet.
 *
 * The uid carries the cluster the token was minted for. A token minted by the
 * devnet instance is rejected here by the mainnet instance even though both
 * read the same Firebase project — belt and braces alongside the fact that the
 * two instances write to different collection roots anyway.
 */
export function requireSession(cluster) {
  return handler(async (req, res, next) => {
    // The public routes attach a session opportunistically; don't pay for a
    // second token verification when one already succeeded on this request.
    if (req.session?.wallet && req.session.cluster === cluster) {
      next();
      return;
    }

    const header = req.get("authorization") || "";
    if (!header.startsWith("Bearer ")) {
      throw unauthorized("NO_SESSION", "Sign in to play for points.");
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(header.slice(7).trim());
    } catch {
      throw unauthorized("SESSION_INVALID", "Your sign-in expired. Sign in again.");
    }

    const [tokenCluster, wallet] = String(decoded.uid).split(":");
    if (tokenCluster !== cluster || !wallet) {
      throw unauthorized("WRONG_CLUSTER", "That sign-in belongs to a different network.");
    }

    req.session = { uid: decoded.uid, wallet, cluster, admin: decoded.admin === true };
    next();
  });
}

export function requireAdmin() {
  return handler(async (req, res, next) => {
    // Re-check the allowlist rather than trusting the claim alone: an admin
    // removed from the list should lose access without waiting for their token
    // to expire.
    if (!req.session?.admin || !adminWallets().includes(req.session.wallet)) {
      throw forbidden("NOT_ADMIN", "That endpoint is not yours.");
    }
    next();
  });
}
