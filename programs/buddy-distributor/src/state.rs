use crate::constants::*;
use crate::errors::DistributorError;
use anchor_lang::prelude::*;

/// Global configuration and the accounting for buckets 2, 3 and 4.
///
/// Everything in here that governs a claim is written once at `initialize` and
/// frozen by `lock_config`. After the lock, the authority can no longer change
/// allocations, roots, deadlines or the signer key; the only remaining admin
/// surface is emergency-free. This is what makes the published pre-commitment
/// document binding rather than aspirational.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub reward_mint: Pubkey,
    /// Set true by `lock_config`. Once true, no field below may change.
    pub locked: bool,
    /// Timestamp at which claim windows begin counting.
    pub claims_start: i64,

    // ---- Bucket 2: old Buddy holders (Merkle, 30 days, instant transfer) ----
    pub old_holder_root: [u8; 32],
    pub old_holder_allocation: u64,
    pub old_holder_claimed: u64,
    pub old_holder_deadline: i64,
    pub old_holder_swept: bool,

    // ---- Bucket 3: influencers (Merkle, 72 hours, 30-day stream) ----
    pub influencer_root: [u8; 32],
    pub influencer_allocation: u64,
    pub influencer_claimed: u64,
    pub influencer_deadline: i64,
    pub influencer_swept: bool,

    // ---- Bucket 4a: the original 2014 Bitcoin signer ----
    /// Uncompressed secp256k1 public key as X||Y (the 65-byte form with the
    /// leading 0x04 stripped), exactly as `secp256k1_recover` returns it.
    pub original_signer_pubkey: [u8; 64],
    pub original_signer_allocation: u64,
    pub original_signer_claimed: bool,
    pub original_signer_swept: bool,

    // ---- Bucket 4b: the new dev (streams automatically, no claim step) ----
    pub dev_wallet: Pubkey,
    pub dev_allocation: u64,
    /// Seconds after `claims_start` before the dev stream releases anything.
    ///
    /// Fixed here, at init, rather than passed to `create_dev_stream`. That
    /// instruction is permissionless by design, so that the team cannot
    /// withhold their own lockup; if it also took the cliff as an argument,
    /// the first caller would choose the team's vesting terms, and the whole
    /// point of the lockup would rest on winning a race.
    pub dev_cliff_seconds: i64,
    pub dev_stream_created: bool,

    pub bump: u8,
    pub vault_bump: u8,
    pub sol_vault_bump: u8,
}

impl Config {
    pub fn assert_unlocked(&self) -> Result<()> {
        require!(!self.locked, DistributorError::ConfigLocked);
        Ok(())
    }

    pub fn assert_locked(&self) -> Result<()> {
        require!(self.locked, DistributorError::ConfigNotLocked);
        Ok(())
    }

    /// Tokens still sitting unclaimed in bucket 2.
    pub fn old_holder_remaining(&self) -> Result<u64> {
        self.old_holder_allocation
            .checked_sub(self.old_holder_claimed)
            .ok_or_else(|| error!(DistributorError::MathOverflow))
    }

    /// Tokens still sitting unclaimed in bucket 3.
    pub fn influencer_remaining(&self) -> Result<u64> {
        self.influencer_allocation
            .checked_sub(self.influencer_claimed)
            .ok_or_else(|| error!(DistributorError::MathOverflow))
    }
}

/// Bucket 1: the community staking pool.
///
/// Rewards arrive here from three sources: the share of pump.fun creator fees
/// directed at this program's vaults, voluntary donations, and every forfeiture
/// in the system (expired buckets, slashed principal, abandoned boost escrow).
/// Distribution uses the standard rewards-per-share accumulator so that paying
/// N stakers costs O(1).
///
/// Nothing pushes fees in automatically. Value that arrives from outside sits
/// uncredited until someone (anyone) calls `sync_sol_rewards` or
/// `sync_token_rewards`, which is what keeps the funding path free of any
/// privileged operator.
#[account]
#[derive(InitSpace)]
pub struct StakePool {
    /// Sum of every position's weight (amount x tier multiplier).
    pub total_weight: u128,
    /// Sum of every position's principal, unweighted.
    pub total_staked: u64,
    /// Cumulative token rewards per unit of weight, scaled by ACC_PRECISION.
    pub acc_token_per_weight: u128,
    /// Cumulative SOL rewards per unit of weight, scaled by ACC_PRECISION.
    pub acc_sol_per_weight: u128,
    /// Rewards that arrived while `total_weight == 0`. Held here rather than
    /// dropped, and folded into the accumulator on the next notify once real
    /// stakers exist.
    pub pending_token_rewards: u64,
    pub pending_sol_rewards: u64,
    /// Lifetime totals, for the public dashboard.
    pub lifetime_token_rewards: u64,
    pub lifetime_sol_rewards: u64,
    /// Funds that entered the vaults through this program's own instructions
    /// and are therefore already on the ledger.
    ///
    /// Anything a vault holds *above* these figures arrived from outside (a
    /// pump.fun fee distribution, a donation, a mistake) and is uncredited
    /// until someone calls the matching `sync_*` instruction. Without this
    /// distinction those funds would be stranded permanently, because payouts
    /// only ever release amounts the accumulator knows about and the program is
    /// immutable after launch.
    ///
    /// Maintained strictly at the points where value physically enters or
    /// leaves a vault. Internal reclassification (a slashed stake becoming
    /// staker rewards, say) moves nothing and must not touch them.
    pub reserved_sol: u64,
    pub reserved_token: u64,
    pub bump: u8,
}

impl StakePool {
    /// Drain the pending buffers into the accumulator as far as whole
    /// per-weight units allow. Safe to call at any time; a no-op unless there
    /// is both something pending and someone to pay.
    ///
    /// The buffer is not only "rewards that arrived while nobody staked"; it is
    /// also the truncation remainder. `distribute_*` can only move an integer
    /// number of `ACC_PRECISION` units per weight into the accumulator, so a
    /// reward smaller than `total_weight / ACC_PRECISION` would round to zero.
    /// Rather than lose it (it was already booked into `reserved_*`, so it
    /// would be stranded forever in an immutable vault), the sub-unit remainder
    /// stays in `pending_*` and is folded in by the next, larger reward. One
    /// buffer, two jobs: nothing credited to the pool is ever undistributable.
    pub fn flush_pending(&mut self) -> Result<()> {
        if self.total_weight == 0 {
            return Ok(());
        }
        self.pending_token_rewards = self.drain_token(self.pending_token_rewards)?;
        self.pending_sol_rewards = self.drain_sol(self.pending_sol_rewards)?;
        Ok(())
    }

    /// Move as many whole per-weight units of `pending` into the token
    /// accumulator as it holds, returning the sub-unit remainder to re-buffer.
    fn drain_token(&mut self, pending: u64) -> Result<u64> {
        if pending == 0 {
            return Ok(0);
        }
        let delta = (pending as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if delta == 0 {
            return Ok(pending);
        }
        self.acc_token_per_weight = self
            .acc_token_per_weight
            .checked_add(delta)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        // The whole tokens actually reflected in the accumulator; the rest is
        // sub-unit dust that stays buffered for next time. delta*weight can
        // never exceed pending*ACC_PRECISION, so this cannot underflow.
        let distributed = (delta
            .checked_mul(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            / ACC_PRECISION) as u64;
        Ok(pending.saturating_sub(distributed))
    }

    fn drain_sol(&mut self, pending: u64) -> Result<u64> {
        if pending == 0 {
            return Ok(0);
        }
        let delta = (pending as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if delta == 0 {
            return Ok(pending);
        }
        self.acc_sol_per_weight = self
            .acc_sol_per_weight
            .checked_add(delta)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        let distributed = (delta
            .checked_mul(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            / ACC_PRECISION) as u64;
        Ok(pending.saturating_sub(distributed))
    }

    /// Add `amount` of token rewards to the pool.
    ///
    /// Everything routes through `pending_token_rewards`: fold the new amount
    /// in, then drain whole per-weight units into the accumulator. When nobody
    /// is staked it simply stays buffered; when the amount is smaller than one
    /// per-weight unit the sub-unit remainder stays buffered. Either way the
    /// full `amount` is accounted and none of it can be stranded.
    pub fn add_token_rewards(&mut self, amount: u64) -> Result<()> {
        self.lifetime_token_rewards = self
            .lifetime_token_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        self.pending_token_rewards = self
            .pending_token_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if self.total_weight == 0 {
            return Ok(());
        }
        self.pending_token_rewards = self.drain_token(self.pending_token_rewards)?;
        Ok(())
    }

    /// Add `amount` lamports of rewards to the pool. Same buffering as
    /// `add_token_rewards`.
    pub fn add_sol_rewards(&mut self, amount: u64) -> Result<()> {
        self.lifetime_sol_rewards = self
            .lifetime_sol_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        self.pending_sol_rewards = self
            .pending_sol_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if self.total_weight == 0 {
            return Ok(());
        }
        self.pending_sol_rewards = self.drain_sol(self.pending_sol_rewards)?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Tier {
    Flexible,
    OneMonth,
    ThreeMonth,
    FiveMonth,
}

impl Tier {
    pub fn from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Tier::Flexible),
            1 => Ok(Tier::OneMonth),
            2 => Ok(Tier::ThreeMonth),
            3 => Ok(Tier::FiveMonth),
            _ => Err(error!(DistributorError::InvalidTier)),
        }
    }

    pub fn multiplier_bps(&self) -> u64 {
        match self {
            Tier::Flexible => TIER_FLEXIBLE_BPS,
            Tier::OneMonth => TIER_ONE_MONTH_BPS,
            Tier::ThreeMonth => TIER_THREE_MONTH_BPS,
            Tier::FiveMonth => TIER_FIVE_MONTH_BPS,
        }
    }

    pub fn lock_duration(&self) -> i64 {
        match self {
            Tier::Flexible => LOCK_FLEXIBLE,
            Tier::OneMonth => LOCK_ONE_MONTH,
            Tier::ThreeMonth => LOCK_THREE_MONTH,
            Tier::FiveMonth => LOCK_FIVE_MONTH,
        }
    }

    pub fn is_locked_tier(&self) -> bool {
        !matches!(self, Tier::Flexible)
    }
}

/// Weight = amount x tier multiplier. Shared by flexible positions (where the
/// multiplier is 1.0x and weight equals amount) and lockups.
pub fn compute_weight(amount: u64, tier: Tier) -> Result<u128> {
    (amount as u128)
        .checked_mul(tier.multiplier_bps() as u128)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or_else(|| error!(DistributorError::MathOverflow))
}

/// Split an accrual across the base (1.0x) and boost (everything above 1.0x)
/// portions. `weight >= amount` always holds because every multiplier is at
/// least 1.0x, so the subtraction cannot underflow.
pub(crate) fn split_accrual(amount: u64, weight: u128, delta: u128) -> Result<(u64, u64)> {
    let total = weight
        .checked_mul(delta)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?
        .checked_div(ACC_PRECISION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let base = (amount as u128)
        .checked_mul(delta)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?
        .checked_div(ACC_PRECISION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let base = base.min(total);
    let boost = total
        .checked_sub(base)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    Ok((
        u64::try_from(base).map_err(|_| error!(DistributorError::MathOverflow))?,
        u64::try_from(boost).map_err(|_| error!(DistributorError::MathOverflow))?,
    ))
}

/// Move everything accrued since the last checkpoint into the settled
/// balances, splitting base from boost. One implementation for both
/// `StakePosition` and `Lockup` so the two account types can never disagree on
/// the split. Must run before any change to `amount` or `weight`, and before
/// paying anything out.
#[allow(clippy::too_many_arguments)]
fn settle_accrual(
    pool: &StakePool,
    amount: u64,
    weight: u128,
    token_debt: &mut u128,
    sol_debt: &mut u128,
    claimable_token: &mut u64,
    claimable_sol: &mut u64,
    escrow_token: &mut u64,
    escrow_sol: &mut u64,
) -> Result<()> {
    let token_delta = pool
        .acc_token_per_weight
        .checked_sub(*token_debt)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let sol_delta = pool
        .acc_sol_per_weight
        .checked_sub(*sol_debt)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    if token_delta > 0 && weight > 0 {
        let (base, boost) = split_accrual(amount, weight, token_delta)?;
        *claimable_token = claimable_token
            .checked_add(base)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        *escrow_token = escrow_token
            .checked_add(boost)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    }

    if sol_delta > 0 && weight > 0 {
        let (base, boost) = split_accrual(amount, weight, sol_delta)?;
        *claimable_sol = claimable_sol
            .checked_add(base)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        *escrow_sol = escrow_sol
            .checked_add(boost)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    }

    *token_debt = pool.acc_token_per_weight;
    *sol_debt = pool.acc_sol_per_weight;
    Ok(())
}

/// One staker's flexible position, one per wallet.
///
/// Flexible-only: `tier` is kept for account layout but is always `Flexible`,
/// so `weight == amount` and the boost half of `settle` is structurally zero;
/// the escrow fields never leave zero. Locked stakes live in `Lockup` accounts
/// instead, one per lock, because a single mutable tier here would let a
/// top-up rewrite the terms of principal that was already committed.
#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    pub owner: Pubkey,
    pub amount: u64,
    /// Always `Flexible`; kept for layout.
    pub tier: Tier,
    pub weight: u128,
    /// Always zero; kept for layout. Flexible positions gate on the unstake
    /// cooldown, not a maturity date.
    pub lock_end: i64,
    /// Timestamp of an unstake request; zero if none.
    pub unstake_requested_at: i64,
    /// Accumulator checkpoints: rewards already accounted for.
    pub token_debt: u128,
    pub sol_debt: u128,
    /// Settled base rewards, withdrawable at any time.
    pub claimable_token: u64,
    pub claimable_sol: u64,
    /// Structurally zero (`weight == amount` means the boost split is empty);
    /// kept for layout.
    pub escrow_token: u64,
    pub escrow_sol: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl StakePosition {
    /// See `settle_accrual`. On a flexible position the boost half is always
    /// zero, but routing through the shared math keeps that a property of the
    /// weights rather than a separate code path to trust.
    pub fn settle(&mut self, pool: &StakePool) -> Result<()> {
        settle_accrual(
            pool,
            self.amount,
            self.weight,
            &mut self.token_debt,
            &mut self.sol_debt,
            &mut self.claimable_token,
            &mut self.claimable_sol,
            &mut self.escrow_token,
            &mut self.escrow_sol,
        )
    }
}

/// One locked stake. A wallet may hold any number of these, each with its own
/// tier, maturity and index, so committing new principal can never touch the
/// terms of principal already locked.
///
/// The base/boost split lives here. Rewards accrue on `weight` (amount x tier
/// multiplier), but only the portion attributable to `amount x 1.0` is
/// immediately claimable. The remainder, the part the multiplier bought, is
/// escrowed until the lock matures, and is forfeited on early exit. Without
/// this, a staker could take the 5.0x rate, claim continuously, and leave after
/// a few weeks having honoured none of the commitment the multiplier paid for.
#[account]
#[derive(InitSpace)]
pub struct Lockup {
    pub owner: Pubkey,
    /// Position in the owner's `LockupCounter` sequence; part of the PDA seeds.
    pub index: u64,
    pub amount: u64,
    pub tier: Tier,
    pub weight: u128,
    pub lock_end: i64,
    /// Set once maturity has released the escrow and cut `weight` back to
    /// `amount`. After maturity the commitment is over, and letting the
    /// multiplier keep accruing would pay for a lock no longer being honoured;
    /// anyone may crank `demote_matured` to stop it.
    pub demoted: bool,
    /// Accumulator checkpoints: rewards already accounted for.
    pub token_debt: u128,
    pub sol_debt: u128,
    /// Settled base rewards, withdrawable at any time.
    pub claimable_token: u64,
    pub claimable_sol: u64,
    /// Settled boost rewards, withdrawable only at lock maturity.
    pub escrow_token: u64,
    pub escrow_sol: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Lockup {
    /// See `settle_accrual`.
    pub fn settle(&mut self, pool: &StakePool) -> Result<()> {
        settle_accrual(
            pool,
            self.amount,
            self.weight,
            &mut self.token_debt,
            &mut self.sol_debt,
            &mut self.claimable_token,
            &mut self.claimable_sol,
            &mut self.escrow_token,
            &mut self.escrow_sol,
        )
    }
}

/// Per-wallet lockup sequence. `count` only ever increases, so a closed
/// lockup's PDA can never be re-created, and every lockup a wallet has ever
/// opened keeps a unique, enumerable address.
#[account]
#[derive(InitSpace)]
pub struct LockupCounter {
    pub owner: Pubkey,
    pub count: u64,
    pub bump: u8,
}

/// Linear vesting stream used by bucket 3 (influencers, 30 days) and bucket 4
/// (founders, 12 months with an optional cliff).
#[account]
#[derive(InitSpace)]
pub struct Stream {
    pub beneficiary: Pubkey,
    pub total: u64,
    pub withdrawn: u64,
    pub start: i64,
    /// Nothing is withdrawable before this timestamp. Equal to `start` when
    /// there is no cliff.
    pub cliff: i64,
    pub end: i64,
    pub bump: u8,
}

impl Stream {
    /// Total vested at `now`, ignoring what has already been withdrawn.
    pub fn vested(&self, now: i64) -> Result<u64> {
        if now < self.cliff {
            return Ok(0);
        }
        if now >= self.end {
            return Ok(self.total);
        }
        let elapsed = now
            .checked_sub(self.start)
            .ok_or_else(|| error!(DistributorError::MathOverflow))? as u128;
        let duration = self
            .end
            .checked_sub(self.start)
            .ok_or_else(|| error!(DistributorError::MathOverflow))? as u128;
        if duration == 0 {
            return Ok(self.total);
        }
        let vested = (self.total as u128)
            .checked_mul(elapsed)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(duration)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        u64::try_from(vested).map_err(|_| error!(DistributorError::MathOverflow))
    }

    pub fn withdrawable(&self, now: i64) -> Result<u64> {
        self.vested(now)?
            .checked_sub(self.withdrawn)
            .ok_or_else(|| error!(DistributorError::MathOverflow))
    }
}

/// Holds SOL rewards for stakers.
///
/// Deliberately owned by this program rather than the System Program: only the
/// owning program may debit an account's lamports directly, and paying stakers
/// out of a system-owned PDA would need a CPI on every single claim.
///
/// Lamports can land here from anywhere (a pump.fun fee distribution, a
/// donation) because crediting an account needs no permission. They only
/// become staker rewards once `sync_sol_rewards` accounts for them, which
/// anyone may call.
#[account]
#[derive(InitSpace)]
pub struct SolVault {
    pub bump: u8,
}

/// One-shot marker proving a wallet already claimed from a Merkle bucket.
/// Its existence *is* the double-claim guard: `init` fails if it is present.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

/// A swept allocation on its way back to the community, on the claimant's own
/// schedule.
///
/// The rule this enforces: forfeiting a stream does not turn it into a lump
/// sum. An influencer who claimed would have received their tokens across 30
/// days, and the 2014 signer across a year, so when they never claim and the
/// allocation returns to the stakers, it returns at exactly that pace. Sweeping
/// must never pay the community faster than claiming would have paid the
/// claimant, or a sweep becomes a jackpot event worth lobbying for.
///
/// Pure accounting, like the sweeps themselves: the tokens never move. Anyone
/// may crank `release_community_stream` to credit the vested portion to the
/// staking accumulator; until someone does, the vested amount simply waits,
/// exactly like un-synced creator fees.
#[account]
#[derive(InitSpace)]
pub struct CommunityStream {
    /// Which sweep created it. See `COMMUNITY_STREAM_INFLUENCERS` /
    /// `COMMUNITY_STREAM_SIGNER`. Doubles as the PDA seed suffix.
    pub kind: u8,
    pub total: u64,
    /// Portion already credited to the staking pool.
    pub released: u64,
    pub start: i64,
    pub end: i64,
    pub bump: u8,
}

impl CommunityStream {
    /// Same linear schedule as `Stream::vested`, with no cliff.
    pub fn vested(&self, now: i64) -> Result<u64> {
        if now <= self.start {
            return Ok(0);
        }
        if now >= self.end {
            return Ok(self.total);
        }
        let elapsed = now
            .checked_sub(self.start)
            .ok_or_else(|| error!(DistributorError::MathOverflow))? as u128;
        let duration = self
            .end
            .checked_sub(self.start)
            .ok_or_else(|| error!(DistributorError::MathOverflow))? as u128;
        if duration == 0 {
            return Ok(self.total);
        }
        let vested = (self.total as u128)
            .checked_mul(elapsed)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(duration)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        u64::try_from(vested).map_err(|_| error!(DistributorError::MathOverflow))
    }

    pub fn releasable(&self, now: i64) -> Result<u64> {
        self.vested(now)?
            .checked_sub(self.released)
            .ok_or_else(|| error!(DistributorError::MathOverflow))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_from_u8_maps_all_four_and_rejects_the_rest() {
        assert_eq!(Tier::from_u8(0).unwrap(), Tier::Flexible);
        assert_eq!(Tier::from_u8(1).unwrap(), Tier::OneMonth);
        assert_eq!(Tier::from_u8(2).unwrap(), Tier::ThreeMonth);
        assert_eq!(Tier::from_u8(3).unwrap(), Tier::FiveMonth);
        assert!(Tier::from_u8(4).is_err());
        assert!(Tier::from_u8(255).is_err());
    }

    #[test]
    fn tier_multipliers_match_the_published_schedule() {
        assert_eq!(Tier::Flexible.multiplier_bps(), 10_000);
        assert_eq!(Tier::OneMonth.multiplier_bps(), 20_000);
        assert_eq!(Tier::ThreeMonth.multiplier_bps(), 30_000);
        assert_eq!(Tier::FiveMonth.multiplier_bps(), 50_000);
    }

    // Real-clock only: the fast-clock build deliberately shrinks these.
    #[cfg(not(feature = "fast-clock"))]
    #[test]
    fn tier_lock_durations_match_the_published_schedule() {
        assert_eq!(Tier::Flexible.lock_duration(), 0);
        assert_eq!(Tier::OneMonth.lock_duration(), 30 * 86_400);
        assert_eq!(Tier::ThreeMonth.lock_duration(), 90 * 86_400);
        assert_eq!(Tier::FiveMonth.lock_duration(), 150 * 86_400);
    }

    #[test]
    fn only_flexible_is_unlocked() {
        assert!(!Tier::Flexible.is_locked_tier());
        assert!(Tier::OneMonth.is_locked_tier());
        assert!(Tier::ThreeMonth.is_locked_tier());
        assert!(Tier::FiveMonth.is_locked_tier());
    }

    #[test]
    fn compute_weight_applies_the_multiplier() {
        assert_eq!(compute_weight(1_000, Tier::Flexible).unwrap(), 1_000);
        assert_eq!(compute_weight(1_000, Tier::OneMonth).unwrap(), 2_000);
        assert_eq!(compute_weight(1_000, Tier::ThreeMonth).unwrap(), 3_000);
        assert_eq!(compute_weight(1_000, Tier::FiveMonth).unwrap(), 5_000);
    }

    #[test]
    fn split_at_flexible_weight_yields_no_boost() {
        // weight == amount: everything is base, which is what lets flexible
        // positions keep their escrow fields at zero without a special case.
        let (base, boost) = split_accrual(100, 100, ACC_PRECISION).unwrap();
        assert_eq!(base, 100);
        assert_eq!(boost, 0);
    }

    #[test]
    fn split_routes_multiplier_excess_to_boost() {
        // 5.0x: of every 500 accrued on 100 principal, 100 is base, 400 boost.
        let (base, boost) = split_accrual(100, 500, ACC_PRECISION).unwrap();
        assert_eq!(base, 100);
        assert_eq!(boost, 400);
    }
}
