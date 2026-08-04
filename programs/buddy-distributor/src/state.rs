use crate::constants::*;
use crate::errors::DistributorError;
use anchor_lang::prelude::*;

/// Global configuration and the accounting for buckets 2, 3 and 4.
///
/// Everything in here that governs a claim is written once at `initialize` and
/// frozen by `lock_config`. After the lock, the authority can no longer change
/// allocations, roots, deadlines or the signer key — the only remaining admin
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

/// Bucket 1 — the community staking pool.
///
/// Rewards arrive here from three sources: the routed share of pump.fun creator
/// fees, voluntary donations, and every forfeiture in the system (expired
/// buckets, slashed principal, abandoned boost escrow). Distribution uses the
/// standard rewards-per-share accumulator so that paying N stakers costs O(1).
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
    pub bump: u8,
}

impl StakePool {
    /// Fold any rewards that accrued while the pool was empty into the
    /// accumulator. Safe to call at any time; a no-op unless there is both
    /// something pending and someone to pay.
    pub fn flush_pending(&mut self) -> Result<()> {
        if self.total_weight == 0 {
            return Ok(());
        }
        if self.pending_token_rewards > 0 {
            let amount = self.pending_token_rewards;
            self.pending_token_rewards = 0;
            self.distribute_token(amount)?;
        }
        if self.pending_sol_rewards > 0 {
            let amount = self.pending_sol_rewards;
            self.pending_sol_rewards = 0;
            self.distribute_sol(amount)?;
        }
        Ok(())
    }

    /// Add `amount` of token rewards to the pool, buffering if nobody is staked.
    pub fn add_token_rewards(&mut self, amount: u64) -> Result<()> {
        self.lifetime_token_rewards = self
            .lifetime_token_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if self.total_weight == 0 {
            self.pending_token_rewards = self
                .pending_token_rewards
                .checked_add(amount)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
            return Ok(());
        }
        self.flush_pending()?;
        self.distribute_token(amount)
    }

    /// Add `amount` lamports of rewards to the pool, buffering if nobody is staked.
    pub fn add_sol_rewards(&mut self, amount: u64) -> Result<()> {
        self.lifetime_sol_rewards = self
            .lifetime_sol_rewards
            .checked_add(amount)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        if self.total_weight == 0 {
            self.pending_sol_rewards = self
                .pending_sol_rewards
                .checked_add(amount)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
            return Ok(());
        }
        self.flush_pending()?;
        self.distribute_sol(amount)
    }

    fn distribute_token(&mut self, amount: u64) -> Result<()> {
        let delta = (amount as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        self.acc_token_per_weight = self
            .acc_token_per_weight
            .checked_add(delta)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        Ok(())
    }

    fn distribute_sol(&mut self, amount: u64) -> Result<()> {
        let delta = (amount as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(self.total_weight)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        self.acc_sol_per_weight = self
            .acc_sol_per_weight
            .checked_add(delta)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Tier {
    Flexible,
    OneMonth,
    ThreeMonth,
    TwelveMonth,
}

impl Tier {
    pub fn from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Tier::Flexible),
            1 => Ok(Tier::OneMonth),
            2 => Ok(Tier::ThreeMonth),
            3 => Ok(Tier::TwelveMonth),
            _ => Err(error!(DistributorError::InvalidTier)),
        }
    }

    pub fn multiplier_bps(&self) -> u64 {
        match self {
            Tier::Flexible => TIER_FLEXIBLE_BPS,
            Tier::OneMonth => TIER_ONE_MONTH_BPS,
            Tier::ThreeMonth => TIER_THREE_MONTH_BPS,
            Tier::TwelveMonth => TIER_TWELVE_MONTH_BPS,
        }
    }

    pub fn lock_duration(&self) -> i64 {
        match self {
            Tier::Flexible => LOCK_FLEXIBLE,
            Tier::OneMonth => LOCK_ONE_MONTH,
            Tier::ThreeMonth => LOCK_THREE_MONTH,
            Tier::TwelveMonth => LOCK_TWELVE_MONTH,
        }
    }

    pub fn is_locked_tier(&self) -> bool {
        !matches!(self, Tier::Flexible)
    }
}

/// One staker's position.
///
/// The base/boost split lives here. Rewards accrue on `weight` (amount x tier
/// multiplier), but only the portion attributable to `amount x 1.0` is
/// immediately claimable. The remainder — the part the multiplier bought — is
/// escrowed until the lock matures, and is forfeited on early exit. Without
/// this, a staker could take the 3.0x rate, claim continuously, and leave after
/// a few weeks having honoured none of the commitment the multiplier paid for.
#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub tier: Tier,
    pub weight: u128,
    /// Timestamp at which a locked tier matures. Zero for flexible.
    pub lock_end: i64,
    /// Timestamp of an unstake request for a flexible position; zero if none.
    pub unstake_requested_at: i64,
    /// Accumulator checkpoints — rewards already accounted for.
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

impl StakePosition {
    /// Move everything accrued since the last checkpoint into the two settled
    /// balances, splitting base from boost. Must be called before any change to
    /// `amount`, `weight` or `tier`, and before paying anything out.
    pub fn settle(&mut self, pool: &StakePool) -> Result<()> {
        let token_delta = pool
            .acc_token_per_weight
            .checked_sub(self.token_debt)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        let sol_delta = pool
            .acc_sol_per_weight
            .checked_sub(self.sol_debt)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;

        if token_delta > 0 && self.weight > 0 {
            let (base, boost) = Self::split(self.amount, self.weight, token_delta)?;
            self.claimable_token = self
                .claimable_token
                .checked_add(base)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
            self.escrow_token = self
                .escrow_token
                .checked_add(boost)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        }

        if sol_delta > 0 && self.weight > 0 {
            let (base, boost) = Self::split(self.amount, self.weight, sol_delta)?;
            self.claimable_sol = self
                .claimable_sol
                .checked_add(base)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
            self.escrow_sol = self
                .escrow_sol
                .checked_add(boost)
                .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        }

        self.token_debt = pool.acc_token_per_weight;
        self.sol_debt = pool.acc_sol_per_weight;
        Ok(())
    }

    /// Split an accrual across the base (1.0x) and boost (everything above 1.0x)
    /// portions. `weight >= amount` always holds because every multiplier is at
    /// least 1.0x, so the subtraction cannot underflow.
    fn split(amount: u64, weight: u128, delta: u128) -> Result<(u64, u64)> {
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

    pub fn compute_weight(amount: u64, tier: Tier) -> Result<u128> {
        (amount as u128)
            .checked_mul(tier.multiplier_bps() as u128)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or_else(|| error!(DistributorError::MathOverflow))
    }

    pub fn is_matured(&self, now: i64) -> bool {
        !self.tier.is_locked_tier() || now >= self.lock_end
    }
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

/// Holds SOL rewards (routed creator fees, donations).
///
/// Deliberately owned by this program rather than the System Program: only the
/// owning program may debit an account's lamports directly, and paying stakers
/// out of a system-owned PDA would need a CPI on every single claim.
#[account]
#[derive(InitSpace)]
pub struct SolVault {
    pub bump: u8,
}

/// One-shot marker proving a wallet already claimed from a Merkle bucket.
/// Its existence *is* the double-claim guard — `init` fails if it is present.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}
