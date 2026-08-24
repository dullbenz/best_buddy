/**
 * Cross-cutting request machinery: error envelopes, rate limiting, idempotency.
 *
 * The existing backend has none of this — it serves one endpoint that is
 * cryptographically self-verifying. A game API is a different shape: it hands
 * out points, so an unthrottled or replayable request is a scoring bug.
 */
import { col, db, FieldValue, Timestamp } from "./db.js";

/** A failure the client is allowed to see the reason for. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new ApiError(400, code, message, details);
export const unauthorized = (code, message) => new ApiError(401, code, message);
export const forbidden = (code, message) => new ApiError(403, code, message);
export const notFound = (code, message) => new ApiError(404, code, message);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);
export const tooMany = (code, message, details) => new ApiError(429, code, message, details);

/** Wrap an async handler so a rejection becomes a JSON error, never a hang. */
export function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(logger) {
  // Express identifies error middleware by arity, so `next` must stay declared.
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    logger.error("unhandled gamehub error", { path: req.path, error: error?.stack || error });
    res.status(500).json({
      error: { code: "INTERNAL", message: "Something broke on our side. Try again." },
    });
  };
}

/**
 * The caller's IP, taken from the first hop of X-Forwarded-For.
 *
 * Hosting and Cloud Run both append to this header, so the leftmost entry is
 * the client. It is client-controllable, which is why it only ever gates
 * unauthenticated endpoints — anything that awards points is keyed by wallet.
 */
export function clientIp(req) {
  const forwarded = req.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0].trim();
  return first || req.ip || "unknown";
}

/**
 * Fixed-window rate limit backed by Firestore.
 *
 * Fixed windows allow a burst of up to 2x the limit across a boundary. That is
 * fine here: these limits exist to stop scripted abuse and runaway cost, not to
 * shape traffic precisely, and the per-game cooldowns are enforced separately
 * against real state.
 *
 * @param {object} options
 * @param {string} options.scope      label, e.g. "pet"
 * @param {number} options.limit      requests allowed per window
 * @param {number} options.windowMs   window length
 * @param {"wallet"|"ip"} options.by   what to key on
 */
export function rateLimit(cluster, { scope, limit, windowMs, by = "wallet" }) {
  return handler(async (req, res, next) => {
    const identity = by === "ip" ? clientIp(req) : req.session?.wallet;
    if (!identity) {
      // No identity to limit means the auth middleware will reject anyway.
      next();
      return;
    }

    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const key = `${scope}:${by}:${identity}:${windowStart}`;
    const ref = col(cluster, "rateLimits").doc(key.replace(/\//g, "_"));

    const count = await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = snapshot.exists ? snapshot.data().count || 0 : 0;
      if (current >= limit) return current + 1;
      tx.set(
        ref,
        {
          count: FieldValue.increment(1),
          scope,
          // TTL policy on this field sweeps the documents; nothing else does.
          expiresAt: Timestamp.fromMillis(windowStart + windowMs * 2),
        },
        { merge: true },
      );
      return current + 1;
    });

    if (count > limit) {
      const retryAfterMs = windowStart + windowMs - Date.now();
      res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      throw tooMany("RATE_LIMITED", "Slow down a moment.", { retryAfterMs });
    }
    next();
  });
}

/**
 * Make a mutating request safe to retry.
 *
 * The client sends a `requestId` it generated; the response is recorded against
 * it. A retry after a dropped connection replays the stored response instead of
 * awarding points twice. The record is written inside the same transaction as
 * the mutation by `runIdempotent`, so there is no window where one exists
 * without the other.
 */
export function idempotencyRef(cluster, uid, requestId) {
  return col(cluster, "idempotency").doc(`${uid}__${requestId}`);
}

export function requireRequestId(req) {
  const requestId = req.body?.requestId;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
    throw badRequest("BAD_REQUEST_ID", "A requestId of 8-64 url-safe characters is required.");
  }
  return requestId;
}

/**
 * Run `work` exactly once per (uid, requestId).
 *
 * @param {(tx: FirebaseFirestore.Transaction) => Promise<object>} work
 *        Must do all its reads before its writes, as Firestore requires.
 * @returns {Promise<{response: object, replayed: boolean}>}
 */
export async function runIdempotent(cluster, uid, requestId, work) {
  const ref = idempotencyRef(cluster, uid, requestId);
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      return { response: existing.data().response, replayed: true };
    }
    const response = await work(tx);
    tx.set(ref, {
      response,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000),
    });
    return { response, replayed: false };
  });
}

/** Placeholder for App Check, which is deliberately not enabled yet. */
export function verifyAppCheck() {
  return (req, res, next) => next();
}
