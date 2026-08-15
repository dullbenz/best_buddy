//! # Buddy Distributor
//!
//! A four-bucket community distributor for the Buddy relaunch. The token itself
//! launches on pump.fun as an ordinary fair launch — no custom mint, no LP
//! custody, no admin keys over supply. Everything bespoke lives here instead.
//!
//! | Bucket | Who | Window | Payout |
//! |--------|-----|--------|--------|
//! | 1 | Community stakers | perpetual | streaming, pro-rata |
//! | 2 | Old Buddy holders (Merkle snapshot) | 30 days | instant, sellable |
//! | 3 | Influencers (published list) | 72 hours | 30-day stream |
//! | 4a | The original 2014 Bitcoin signer | until 2030-12-31 | 12-month stream |
//! | 4b | The new dev | automatic | 12-month stream, with cliff |
//!
//! One rule governs everything: **whatever goes unclaimed ends up in bucket 1.**
//! Expired influencer allocations, the old-holder remainder, the founder
//! allocation if the 2014 signer never appears, forfeited boost escrow and
//! slashed principal from early unstakers — all of it becomes staking rewards
//! for the community that stayed.
//!
//! The new dev holds nothing after deployment. His allocation exists only as a
//! stream inside this program, on the same terms published before launch.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("4S2qKjy8Sm8TVxxN5GX3E2aQJHsXk5TTQy7FSA7GCQ2V");

// NOTE: builds emit one warning here — anchor-lang 0.31.1 calls the deprecated
// `AccountInfo::realloc` inside this macro's expansion. It is left visible on
// purpose. A module-scoped `#[allow(deprecated)]` does not reach it, because
// the macro also emits sibling items at crate level; the only thing that
// silences it is a crate-wide allow, which would also hide genuine deprecations
// in the actual logic. One known warning beats that trade.
//
// It is cosmetic: `realloc` still works, and once deployed the bytecode is
// frozen regardless of what the SDK renames later.
#[program]
pub mod buddy_distributor {
    use super::*;

    // ---- setup (authority only, and only before the lock) ----

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        instructions::admin::fund_vault(ctx, amount)
    }

    /// Freeze every claim parameter. After this the authority cannot change
    /// allocations, roots, deadlines or the signer key.
    pub fn lock_config(ctx: Context<LockConfig>) -> Result<()> {
        instructions::admin::lock_config(ctx)
    }

    pub fn create_dev_stream(ctx: Context<CreateDevStream>, cliff_seconds: i64) -> Result<()> {
        instructions::admin::create_dev_stream(ctx, cliff_seconds)
    }

    // ---- bucket 1: staking ----

    pub fn stake(ctx: Context<Stake>, amount: u64, tier: u8) -> Result<()> {
        instructions::staking::stake(ctx, amount, tier)
    }

    pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
        instructions::staking::request_unstake(ctx)
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::staking::unstake(ctx, amount)
    }

    pub fn emergency_exit(ctx: Context<EmergencyExit>) -> Result<()> {
        instructions::staking::emergency_exit(ctx)
    }

    /// Withdraw settled base rewards. Always available, every tier.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::staking::claim_rewards(ctx)
    }

    /// Withdraw the boost portion. Only at lock maturity.
    pub fn withdraw_boost_escrow(ctx: Context<WithdrawBoostEscrow>) -> Result<()> {
        instructions::staking::withdraw_boost_escrow(ctx)
    }

    pub fn notify_token_rewards(ctx: Context<NotifyTokenRewards>, amount: u64) -> Result<()> {
        instructions::rewards::notify_token_rewards(ctx, amount)
    }

    pub fn notify_sol_rewards(ctx: Context<NotifySolRewards>, amount: u64) -> Result<()> {
        instructions::rewards::notify_sol_rewards(ctx, amount)
    }

    pub fn flush_pending(ctx: Context<FlushPending>) -> Result<()> {
        instructions::rewards::flush_pending(ctx)
    }

    /// Credit lamports that reached the SOL vault without going through
    /// `notify_sol_rewards` — pump.fun fee distributions, donations, mistakes.
    pub fn sync_sol_rewards(ctx: Context<SyncSolRewards>) -> Result<()> {
        instructions::rewards::sync_sol_rewards(ctx)
    }

    /// The same, for reward-mint tokens sent straight to the token vault.
    pub fn sync_token_rewards(ctx: Context<SyncTokenRewards>) -> Result<()> {
        instructions::rewards::sync_token_rewards(ctx)
    }

    /// Turn vault-held wrapped SOL into lamports and credit it. Needed because
    /// pump.fun pays post-graduation creator fees in wSOL.
    pub fn unwrap_wsol(ctx: Context<UnwrapWsol>) -> Result<()> {
        instructions::rewards::unwrap_wsol(ctx)
    }

    // ---- buckets 2, 3, 4 ----

    pub fn claim_old_holder(
        ctx: Context<ClaimOldHolder>,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::claims::claim_old_holder(ctx, amount, proof)
    }

    pub fn claim_influencer(
        ctx: Context<ClaimInfluencer>,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::claims::claim_influencer(ctx, amount, proof)
    }

    pub fn claim_original_signer(
        ctx: Context<ClaimOriginalSigner>,
        destination_owner: Pubkey,
        header: u8,
        signature: [u8; 64],
    ) -> Result<()> {
        instructions::claims::claim_original_signer(ctx, destination_owner, header, signature)
    }

    pub fn stream_withdraw(ctx: Context<StreamWithdraw>) -> Result<()> {
        instructions::claims::stream_withdraw(ctx)
    }

    // ---- sweeps: the dead-man rule, permissionless ----

    pub fn sweep_old_holders(ctx: Context<Sweep>) -> Result<()> {
        instructions::sweep::sweep_old_holders(ctx)
    }

    pub fn sweep_influencers(ctx: Context<SweepInfluencersToStream>) -> Result<()> {
        instructions::sweep::sweep_influencers(ctx)
    }

    pub fn sweep_original_signer(ctx: Context<SweepSignerToStream>) -> Result<()> {
        instructions::sweep::sweep_original_signer(ctx)
    }

    /// Credit whatever a swept bucket's community stream has vested so far to
    /// the staking pool. Permissionless.
    pub fn release_community_stream(ctx: Context<ReleaseCommunityStream>) -> Result<()> {
        instructions::sweep::release_community_stream(ctx)
    }
}
