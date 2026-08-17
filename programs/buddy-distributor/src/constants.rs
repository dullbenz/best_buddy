use anchor_lang::prelude::*;

/// PDA seeds.
pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const POOL_SEED: &[u8] = b"pool";
pub const STAKE_SEED: &[u8] = b"stake";
pub const LOCKUP_SEED: &[u8] = b"lockup";
pub const LOCKUP_COUNT_SEED: &[u8] = b"lockup_count";
pub const OLD_CLAIM_SEED: &[u8] = b"old_claim";
pub const INFLUENCER_CLAIM_SEED: &[u8] = b"inf_claim";
pub const STREAM_SEED: &[u8] = b"stream";
pub const COMMUNITY_STREAM_SEED: &[u8] = b"community_stream";

/// `CommunityStream.kind` values, doubling as the PDA seed suffix.
pub const COMMUNITY_STREAM_INFLUENCERS: u8 = 0;
pub const COMMUNITY_STREAM_SIGNER: u8 = 1;

/// Fixed-point scalar for the reward accumulators. Rewards-per-weight is stored
/// scaled by this factor so that integer division does not truncate small
/// per-weight amounts to zero.
pub const ACC_PRECISION: u128 = 1_000_000_000_000; // 1e12

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Staking tier multipliers, in basis points of the staked amount.
/// Weight = amount * multiplier_bps / 10_000.
pub const TIER_FLEXIBLE_BPS: u64 = 10_000; // 1.0x
pub const TIER_ONE_MONTH_BPS: u64 = 20_000; // 2.0x
pub const TIER_THREE_MONTH_BPS: u64 = 30_000; // 3.0x
pub const TIER_FIVE_MONTH_BPS: u64 = 50_000; // 5.0x

/// Lock durations in seconds.
pub const ONE_DAY: i64 = 86_400;
pub const LOCK_FLEXIBLE: i64 = 0;

// ---------------------------------------------------------------------------
// Every wall-clock duration exists in two forms. The real values are the
// contract; the `fast-clock` values exist ONLY so the devnet end-to-end
// campaign can watch a lock mature or a window expire inside one sitting
// instead of one month. The feature is never a default, CI never enables it,
// and `solana-verify` builds default features — so the mainnet bytecode
// provably contains the real values. If you are reading this in an audit:
// the `not(feature = "fast-clock")` branch is the deployed program.
// ---------------------------------------------------------------------------

// `#[constant]`-exported (like the cooldown) so the site's lock-length copy is
// read from the deployed binary rather than restated by hand.
#[cfg(not(feature = "fast-clock"))]
#[constant]
pub const LOCK_ONE_MONTH: i64 = 30 * ONE_DAY;
#[cfg(not(feature = "fast-clock"))]
#[constant]
pub const LOCK_THREE_MONTH: i64 = 90 * ONE_DAY;
#[cfg(not(feature = "fast-clock"))]
#[constant]
pub const LOCK_FIVE_MONTH: i64 = 150 * ONE_DAY;

#[cfg(feature = "fast-clock")]
#[constant]
pub const LOCK_ONE_MONTH: i64 = 60; // 1 minute
#[cfg(feature = "fast-clock")]
#[constant]
pub const LOCK_THREE_MONTH: i64 = 120; // 2 minutes
#[cfg(feature = "fast-clock")]
#[constant]
pub const LOCK_FIVE_MONTH: i64 = 180; // 3 minutes

/// Cooldown a flexible staker must wait between requesting an unstake and
/// withdrawing. 24 hours: fee pots accrue in public view, so without a delay a
/// large wallet could stake into a visibly fat pot, capture its share the
/// moment it is synced, and leave in the same breath. A day makes that capture
/// unpriceable in advance without turning flexible into a lock in disguise.
// Exported into the IDL via `#[constant]` so the frontend reads whichever value
// the deployed binary actually uses. Hard-coding 24h in the client made the
// site contradict a fast-clock devnet deployment (chain unlocks in 60s, UI hid
// the button for a day). Whatever is compiled here is what the app now shows.
#[cfg(not(feature = "fast-clock"))]
#[constant]
pub const UNSTAKE_COOLDOWN: i64 = ONE_DAY;
#[cfg(feature = "fast-clock")]
#[constant]
pub const UNSTAKE_COOLDOWN: i64 = 60; // 1 minute

/// Penalty applied to *principal* when a locked position exits early, in bps.
/// The forfeited boost escrow is on top of this. Both flow to the stake pool.
pub const EMERGENCY_EXIT_SLASH_BPS: u64 = 1_500; // 15%

/// Claim windows. Fast-clock variants above apply here too — see the block
/// comment beside the lock durations.
#[cfg(not(feature = "fast-clock"))]
pub const OLD_HOLDER_CLAIM_WINDOW: i64 = 30 * ONE_DAY;
#[cfg(not(feature = "fast-clock"))]
pub const INFLUENCER_CLAIM_WINDOW: i64 = 3 * ONE_DAY; // 72 hours
#[cfg(not(feature = "fast-clock"))]
pub const INFLUENCER_STREAM_DURATION: i64 = 30 * ONE_DAY;
#[cfg(not(feature = "fast-clock"))]
pub const FOUNDER_STREAM_DURATION: i64 = 365 * ONE_DAY;

#[cfg(feature = "fast-clock")]
pub const OLD_HOLDER_CLAIM_WINDOW: i64 = 6 * 60; // 6 minutes
#[cfg(feature = "fast-clock")]
pub const INFLUENCER_CLAIM_WINDOW: i64 = 4 * 60; // 4 minutes
#[cfg(feature = "fast-clock")]
pub const INFLUENCER_STREAM_DURATION: i64 = 3 * 60; // 3 minutes
#[cfg(feature = "fast-clock")]
pub const FOUNDER_STREAM_DURATION: i64 = 5 * 60; // 5 minutes

/// Unix timestamp for 2030-12-31T23:59:59Z, the deadline for the original
/// 2014 Bitcoin message signer to claim.
pub const ORIGINAL_SIGNER_DEADLINE: i64 = 1_924_991_999;

/// Bitcoin's message-signing magic prefix. Signed payload is:
///   double_sha256( 0x18 || "Bitcoin Signed Message:\n" || varint(len) || msg )
pub const BITCOIN_MSG_PREFIX: &[u8] = b"\x18Bitcoin Signed Message:\n";

/// The claim message template the original signer must sign. The full message
/// is this prefix followed by the base58 destination Solana address, binding
/// the signature to one specific recipient so it cannot be replayed elsewhere.
pub const SIGNER_CLAIM_MESSAGE_PREFIX: &str = "I am the original Signer. Claim to Solana address: ";

#[constant]
pub const PROGRAM_VERSION: u8 = 1;

/// Wrapped SOL. Hard-coded so `unwrap_wsol` can only ever act on the real one.
///
/// Declared as a plain constant rather than a `declare_id!` module: a second
/// `declare_id!` anywhere in the crate overwrites the program address Anchor
/// writes into the generated IDL, which would point every client at the wrong
/// program entirely.
pub const WSOL_MINT: Pubkey = anchor_lang::solana_program::pubkey!(
    "So11111111111111111111111111111111111111112"
);
