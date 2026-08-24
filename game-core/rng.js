/**
 * Deterministic seeded RNG for the game hub sims.
 *
 * The server issues a 32-byte hex seed per round; the client plays against it
 * and the server replays the same inputs against the same seed. Every piece of
 * randomness in a round must come from here — never Math.random, never a
 * clock — or client and server disagree and honest scores get rejected.
 *
 * sfc32 is used because it is tiny, fast, and passes PractRand far beyond what
 * a game needs. All outputs are unsigned 32-bit integers: the sims are
 * integer-only so results are bit-identical across JS engines.
 */

/** murmur3 finalizer: avalanches a u32 so near-identical inputs diverge. */
function fmix32(h) {
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Fold a 32-byte seed into sfc32's four state words.
 *
 * Every one of the seed's eight words is mixed into every accumulator through
 * an avalanching hash. Plain XOR folding was the obvious thing to write here
 * and is wrong: any seed built from a repeating byte pattern cancels itself to
 * zero, so whole families of distinct seeds would play out identically.
 *
 * @param {string} seedHex 64 hex chars (32 bytes)
 * @returns {number[]} four u32 words
 */
function seedWords(seedHex) {
  if (typeof seedHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("seed must be 64 hex characters");
  }
  const state = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x85a308d3];
  for (let i = 0; i < 8; i++) {
    const word = parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0;
    for (let j = 0; j < 4; j++) {
      state[j] = fmix32((state[j] ^ Math.imul(word + j + 1, 0x9e3779b1)) >>> 0);
    }
  }
  return state;
}

/**
 * @param {string} seedHex 64 hex chars
 * @param {number} stream  integer lane (e.g. throw index) so one seed yields
 *                         independent sequences per stream
 */
export function createRng(seedHex, stream = 0) {
  let [a, b, c, d] = seedWords(seedHex);
  // Mix the stream id in, then discard warm-up outputs so nearby streams diverge.
  a = (a ^ (stream * 0x9e3779b9)) >>> 0;
  b = (b + stream) >>> 0;

  function nextU32() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return out >>> 0;
  }
  for (let i = 0; i < 12; i++) nextU32();

  return {
    nextU32,
    /** uniform-enough integer in [0, n) — modulo bias is irrelevant at game scale */
    nextInt(n) {
      if (!Number.isInteger(n) || n <= 0) throw new Error("nextInt needs n > 0");
      return nextU32() % n;
    },
    /** integer in [lo, hi] inclusive */
    nextRange(lo, hi) {
      return lo + (nextU32() % (hi - lo + 1));
    },
  };
}
