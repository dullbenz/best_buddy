use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use anchor_lang::prelude::*;

/// Every sweep shares one shape: after a bucket's deadline passes, whatever is
/// left in it becomes staking rewards for the community. The tokens are already
/// physically in the vault, so a sweep is pure accounting — it moves the
/// remainder from a bucket's ledger into the pool accumulator.
///
/// All three are permissionless. Nobody has to trust the team to run them, and
/// nobody can stop them from being run.
#[derive(Accounts)]
pub struct Sweep<'info> {
    pub cranker: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
}

/// Bucket 2 → bucket 1, after the 30-day old-holder window closes.
pub fn sweep_old_holders(ctx: Context<Sweep>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now >= config.old_holder_deadline,
        DistributorError::SweepTooEarly
    );
    require!(!config.old_holder_swept, DistributorError::AlreadyClaimed);

    let remaining = config.old_holder_remaining()?;
    config.old_holder_swept = true;
    config.old_holder_claimed = config.old_holder_allocation;

    if remaining > 0 {
        ctx.accounts.pool.add_token_rewards(remaining)?;
    }

    msg!("sweep_old_holders: {} unclaimed tokens moved to bucket 1", remaining);
    Ok(())
}

/// Bucket 3 → bucket 1, after the 72-hour influencer window closes.
pub fn sweep_influencers(ctx: Context<Sweep>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now >= config.influencer_deadline,
        DistributorError::SweepTooEarly
    );
    require!(!config.influencer_swept, DistributorError::AlreadyClaimed);

    let remaining = config.influencer_remaining()?;
    config.influencer_swept = true;
    config.influencer_claimed = config.influencer_allocation;

    if remaining > 0 {
        ctx.accounts.pool.add_token_rewards(remaining)?;
    }

    msg!(
        "sweep_influencers: {} unclaimed tokens moved to bucket 1",
        remaining
    );
    Ok(())
}

/// Bucket 4a → bucket 1, if the original signer never surfaces by 2030-12-31.
pub fn sweep_original_signer(ctx: Context<Sweep>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now > ORIGINAL_SIGNER_DEADLINE,
        DistributorError::SweepTooEarly
    );
    require!(
        !config.original_signer_claimed,
        DistributorError::AlreadyClaimed
    );
    require!(
        !config.original_signer_swept,
        DistributorError::AlreadyClaimed
    );

    let amount = config.original_signer_allocation;
    config.original_signer_swept = true;

    if amount > 0 {
        ctx.accounts.pool.add_token_rewards(amount)?;
    }

    msg!(
        "sweep_original_signer: {} tokens returned to the community after the 2030 deadline",
        amount
    );
    Ok(())
}
