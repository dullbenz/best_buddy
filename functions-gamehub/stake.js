/**
 * Reading a player's on-chain stake, for the perks that require one.
 *
 * Premium actions — Golden Bone, Super Pet, extra shovels — are unlocked by
 * having $BUDDY staked. That fact lives on chain, so this is where the game
 * hub reads it. The client reads it too, for instant UI, but only this answer
 * counts.
 *
 * Two things shape the design. First, the browser's RPC key is Origin-locked
 * and unusable from a server, so this uses its own endpoint from
 * GAMEHUB_SERVER_RPC_URL. Second, an RPC round trip per pet would be both slow
 * and expensive, so answers are cached in Firestore and only the premium paths
 * ever wait on the chain.
 *
 * Account layouts are decoded by hand rather than through Anchor's coder: only
 * four fields are needed and the full client is a heavy dependency for a
 * function that cold-starts. The discriminator is checked on every read, so a
 * layout change surfaces as a clean failure rather than a silent wrong number.
 */
import { Connection, PublicKey } from "@solana/web3.js";

import { doc, FieldValue } from "./db.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
/** How long a cached answer may be served after the chain becomes unreachable. */
const STALE_GRACE_MS = 60 * 60 * 1000;

const DISCRIMINATORS = {
  stakePosition: Buffer.from([78, 165, 30, 111, 171, 125, 11, 220]),
  lockup: Buffer.from([1, 45, 32, 32, 57, 81, 88, 67]),
  lockupCounter: Buffer.from([103, 206, 9, 57, 85, 219, 106, 159]),
};

/** Only as many lockups as a wallet could plausibly hold get fetched. */
const MAX_LOCKUPS = 32;

let connection = null;
function rpc() {
  if (!connection) {
    const url = process.env.GAMEHUB_SERVER_RPC_URL;
    if (!url) throw new Error("GAMEHUB_SERVER_RPC_URL is not set");
    connection = new Connection(url, "confirmed");
  }
  return connection;
}

function programId() {
  const id = process.env.GAMEHUB_PROGRAM_ID;
  if (!id) throw new Error("GAMEHUB_PROGRAM_ID is not set");
  return new PublicKey(id);
}

function u64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function i64(buffer, offset) {
  return buffer.readBigInt64LE(offset);
}

function checkDiscriminator(data, expected, label) {
  if (!data || data.length < 8 || !data.subarray(0, 8).equals(expected)) {
    throw new Error(`unexpected ${label} account layout`);
  }
}

/** StakePosition: disc(8) owner(32) amount(8) tier(1) weight(16) lock_end(8) unstake_requested_at(8) */
function decodeStakePosition(data) {
  checkDiscriminator(data, DISCRIMINATORS.stakePosition, "StakePosition");
  return {
    amount: u64(data, 40),
    tier: data.readUInt8(48),
    unstakeRequestedAt: i64(data, 73),
  };
}

/** Lockup: disc(8) owner(32) index(8) amount(8) tier(1) weight(16) lock_end(8) demoted(1) */
function decodeLockup(data) {
  checkDiscriminator(data, DISCRIMINATORS.lockup, "Lockup");
  return {
    index: u64(data, 40),
    amount: u64(data, 48),
    tier: data.readUInt8(56),
    lockEnd: i64(data, 73),
    demoted: data.readUInt8(81) === 1,
  };
}

/** LockupCounter: disc(8) owner(32) count(8) bump(1) */
function decodeLockupCounter(data) {
  checkDiscriminator(data, DISCRIMINATORS.lockupCounter, "LockupCounter");
  return { count: u64(data, 40) };
}

function pda(seeds, program) {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

/**
 * Read a wallet's stake straight from the chain. No caching — callers should
 * use `getStakeStatus` unless they specifically want a fresh read.
 */
export async function fetchStakeFromChain(wallet) {
  const owner = new PublicKey(wallet);
  const program = programId();
  const connection = rpc();

  const positionPda = pda([Buffer.from("stake"), owner.toBuffer()], program);
  const counterPda = pda([Buffer.from("lockup_count"), owner.toBuffer()], program);

  const [positionInfo, counterInfo] = await connection.getMultipleAccountsInfo([
    positionPda,
    counterPda,
  ]);

  let flexAmount = 0n;
  if (positionInfo) flexAmount = decodeStakePosition(positionInfo.data).amount;

  const lockups = [];
  if (counterInfo) {
    const { count } = decodeLockupCounter(counterInfo.data);
    const total = Number(count > BigInt(MAX_LOCKUPS) ? BigInt(MAX_LOCKUPS) : count);
    const addresses = [];
    for (let index = 0; index < total; index++) {
      addresses.push(pda([Buffer.from("lockup"), owner.toBuffer(), u64Le(index)], program));
    }
    // getMultipleAccountsInfo caps at 100 keys; MAX_LOCKUPS keeps us well under.
    const infos = addresses.length ? await connection.getMultipleAccountsInfo(addresses) : [];
    for (const info of infos) {
      if (!info) continue;
      const lockup = decodeLockup(info.data);
      if (lockup.amount > 0n) lockups.push(lockup);
    }
  }

  const activeLockups = lockups.filter((lockup) => !lockup.demoted);
  const lockedAmount = lockups.reduce((sum, lockup) => sum + lockup.amount, 0n);

  return {
    // A position with an unstake requested still counts: the tokens are still
    // staked until they are actually withdrawn, and taking someone's perks away
    // the moment they start a 24h cooldown would be a mean surprise.
    staked: flexAmount > 0n || lockups.length > 0,
    flexAmount: flexAmount.toString(),
    lockedAmount: lockedAmount.toString(),
    totalAmount: (flexAmount + lockedAmount).toString(),
    lockupCount: lockups.length,
    activeLockupCount: activeLockups.length,
    highestTier: lockups.reduce((best, lockup) => Math.max(best, lockup.tier), 0),
  };
}

/**
 * Stake status for a wallet, cached.
 *
 * If the chain is unreachable, a recent cached answer is served rather than
 * failing: losing RPC should degrade a perk, never break the games. Only if
 * there is no usable cache at all does this report unstaked, and callers use
 * that solely to deny a premium action.
 */
export async function getStakeStatus(cluster, wallet, { force = false } = {}) {
  // Under the emulator there is no chain to ask. GAMEHUB_STAKE_STUB names the
  // wallets to treat as staked ("*" for all), so the end-to-end suite can test
  // both sides of every perk gate without funding anything. It is read only
  // when the Functions emulator is running, so setting it in a deployed
  // environment does nothing.
  if (process.env.FUNCTIONS_EMULATOR === "true" && process.env.GAMEHUB_STAKE_STUB) {
    const stubbed = process.env.GAMEHUB_STAKE_STUB.split(",").map((entry) => entry.trim());
    const staked = stubbed.includes("*") || stubbed.includes(wallet);
    return {
      staked,
      flexAmount: staked ? "5000000000" : "0",
      lockedAmount: "0",
      totalAmount: staked ? "5000000000" : "0",
      lockupCount: 0,
      activeLockupCount: 0,
      highestTier: 0,
      source: "stub",
    };
  }

  const ref = doc(cluster, "stakeCache", wallet);
  const snapshot = await ref.get();
  const cached = snapshot.exists ? snapshot.data() : null;
  const age = cached?.fetchedAtMs ? Date.now() - cached.fetchedAtMs : Infinity;

  if (!force && cached && age < CACHE_TTL_MS) {
    return { ...cached.status, source: "cache" };
  }

  try {
    const status = await fetchStakeFromChain(wallet);
    await ref.set({
      status,
      fetchedAtMs: Date.now(),
      fetchedAt: FieldValue.serverTimestamp(),
    });
    return { ...status, source: "chain" };
  } catch (error) {
    if (cached && age < STALE_GRACE_MS) {
      return { ...cached.status, source: "stale", staleReason: String(error?.message || error) };
    }
    return {
      staked: false,
      flexAmount: "0",
      lockedAmount: "0",
      totalAmount: "0",
      lockupCount: 0,
      activeLockupCount: 0,
      highestTier: 0,
      source: "unavailable",
      staleReason: String(error?.message || error),
    };
  }
}
