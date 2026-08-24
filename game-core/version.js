/**
 * Bumped whenever a change to any sim would alter the outcome of a replay.
 *
 * Submissions carry the version the client ran; the server rejects a mismatch
 * rather than scoring a replay under different physics. Rounds issued before a
 * deploy therefore fail closed instead of silently scoring wrong.
 */
export const SIM_VERSION = 1;
