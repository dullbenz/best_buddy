/**
 * The influencer terms register.
 *
 * Records that a wallet signed the published terms, and serves the whole list
 * back to anyone who asks.
 *
 * The important property is that **entries cannot be forged, including by us**.
 * Every write is verified here against the canonical terms text with the
 * claimed wallet's own public key, so an entry can only exist if that key
 * really produced that signature. Anyone can re-verify the served JSON offline
 * and needs no trust in this server to do it.
 *
 * What a hosted register *cannot* prevent is omission — we could in principle
 * drop a row. That is checkable too: the on-chain influencer ClaimReceipt
 * accounts are the authoritative list of who claimed, so a wallet holding a
 * receipt with no row here is a visible, provable gap. The register is designed
 * to be diffed against the chain rather than believed.
 */
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

if (!getApps().length) initializeApp();

const COLLECTION = "influencer_terms";

// Read once at cold start. This file is generated from the repo-root canonical
// copy by app/scripts/copy-idl.mjs, so it cannot drift from what the browser
// asked the wallet to sign.
const TERMS = fs.readFileSync(path.join(__dirname, "influencer-terms.txt"), "utf8");
const TERMS_SHA256 = crypto.createHash("sha256").update(TERMS, "utf8").digest("hex");

const decodeBase58 = bs58.decode ? bs58.decode : bs58.default.decode;

/** Reject anything that is not a plausible base58 Solana address. */
function parseAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return null;
  try {
    const bytes = decodeBase58(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function parseSignature(value) {
  if (typeof value !== "string") return null;
  try {
    const bytes = decodeBase58(value);
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

exports.terms = onRequest(
  { region: "us-central1", memory: "256MiB", maxInstances: 5, cors: true },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    // ---- Public read. The whole point is that third parties can audit it. ----
    if (req.method === "GET") {
      const snap = await getFirestore()
        .collection(COLLECTION)
        .orderBy("signedAt")
        .get();

      // Deliberately not cached. This is a live register that grows as people
      // sign, and it is meant to be audited — a reader who is checking whether
      // a specific wallet accepted the terms must not be shown a minute-old
      // answer and conclude the entry is missing. The CDN was doing exactly
      // that in testing.
      res.json({
        terms: TERMS,
        termsSha256: TERMS_SHA256,
        howToVerify:
          "For each entry, ed25519-verify `signature` (base58, 64 bytes) over the UTF-8 bytes of `terms`, using `address` (base58, 32 bytes) as the public key. No trust in this server is required. Cross-check completeness against the on-chain influencer claim receipts.",
        count: snap.size,
        acceptances: snap.docs.map((d) => {
          const v = d.data();
          return {
            address: d.id,
            signature: v.signature,
            termsSha256: v.termsSha256,
            signedAt: v.signedAt?.toDate?.()?.toISOString() ?? null,
          };
        }),
      });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Use GET to read the register, POST to add to it." });
      return;
    }

    // ---- Write, but only what the signature itself proves. ----
    const body = req.body ?? {};
    const addressBytes = parseAddress(body.address);
    const signatureBytes = parseSignature(body.signature);

    if (!addressBytes || !signatureBytes) {
      res.status(400).json({ error: "address and signature must be base58 (32 and 64 bytes)." });
      return;
    }

    const ok = nacl.sign.detached.verify(
      Buffer.from(TERMS, "utf8"),
      Uint8Array.from(signatureBytes),
      Uint8Array.from(addressBytes)
    );

    if (!ok) {
      // Either the wrong key signed, or the text differs from ours. Both mean
      // we must not store it — an unverifiable row would poison the register.
      res.status(400).json({ error: "Signature does not verify against the published terms." });
      return;
    }

    const ref = getFirestore().collection(COLLECTION).doc(body.address);

    // First acceptance wins. Re-signing is a no-op rather than an overwrite, so
    // the recorded timestamp is always the original one and the register only
    // ever grows.
    const existing = await ref.get();
    if (existing.exists) {
      res.json({ stored: false, alreadyRecorded: true, address: body.address });
      return;
    }

    await ref.create({
      signature: body.signature,
      termsSha256: TERMS_SHA256,
      signedAt: FieldValue.serverTimestamp(),
    });

    res.json({ stored: true, address: body.address, termsSha256: TERMS_SHA256 });
  }
);
