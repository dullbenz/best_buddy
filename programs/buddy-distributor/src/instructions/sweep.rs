use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use anchor_lang::prelude::*;

/// After a bucket's deadline passes, whatever is left in it belongs to the
/// community. The tokens are already physically in the vault, so every sweep
/// is pure accounting: no transfer happens.
///
/// How fast the community receives it depends on how fast the claimant would
/// have: the old-holder bucket paid instantly, so its sweep credits the pool
/// instantly; the influencer and signer buckets streamed, so their sweeps open
/// a `CommunityStream` on the identical schedule. A sweep must never pay the
/// community faster than a claim would have paid the claimant; otherwise an
/// expiry becomes a jackpot event worth rooting for.
///
/// All sweeps are permissionless. Nobody has to trust the team to run them,
/// and nobody can stop them from being run.
#[derive(Accounts)]
pub struct Sweep<'info> {
    pub cranker: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
}

/// A sweep whose bucket streamed: creates the community stream instead of
/// touching the pool. The pool is only credited later, by the release crank,
/// at the pace the claimant would have received it.
#[derive(Accounts)]
pub struct SweepInfluencersToStream<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = cranker,
        space = 8 + CommunityStream::INIT_SPACE,
        seeds = [COMMUNITY_STREAM_SEED, &[COMMUNITY_STREAM_INFLUENCERS]],
        bump
    )]
    pub community_stream: Account<'info, CommunityStream>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepSignerToStream<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = cranker,
        space = 8 + CommunityStream::INIT_SPACE,
        seeds = [COMMUNITY_STREAM_SEED, &[COMMUNITY_STREAM_SIGNER]],
        bump
    )]
    pub community_stream: Account<'info, CommunityStream>,

    pub system_program: Program<'info, System>,
}

/// Credit whatever a community stream has vested since the last call to the
/// staking pool. Permissionless, like every other crank here: the schedule is
/// fixed by the sweep, and this only moves accounting forward along it.
#[derive(Accounts)]
pub struct ReleaseCommunityStream<'info> {
    pub cranker: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [COMMUNITY_STREAM_SEED, &[community_stream.kind]],
        bump = community_stream.bump
    )]
    pub community_stream: Account<'info, CommunityStream>,
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
///
/// Streams rather than credits: an influencer who claimed would have received
/// this across 30 days, so the community does too.
pub fn sweep_influencers(ctx: Context<SweepInfluencersToStream>) -> Result<()> {
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

    let cs = &mut ctx.accounts.community_stream;
    cs.kind = COMMUNITY_STREAM_INFLUENCERS;
    cs.total = remaining;
    cs.released = 0;
    cs.start = now;
    cs.end = now
        .checked_add(INFLUENCER_STREAM_DURATION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    cs.bump = ctx.bumps.community_stream;

    msg!(
        "sweep_influencers: {} unclaimed tokens now streaming to bucket 1 over {} seconds",
        remaining,
        INFLUENCER_STREAM_DURATION
    );
    Ok(())
}

/// Bucket 4a → bucket 1, if the original signer never surfaces by 2030-12-31.
pub fn sweep_original_signer(ctx: Context<SweepSignerToStream>) -> Result<()> {
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

    let cs = &mut ctx.accounts.community_stream;
    cs.kind = COMMUNITY_STREAM_SIGNER;
    cs.total = amount;
    cs.released = 0;
    cs.start = now;
    cs.end = now
        .checked_add(FOUNDER_STREAM_DURATION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    cs.bump = ctx.bumps.community_stream;

    msg!(
        "sweep_original_signer: {} tokens now streaming to the community over {} seconds",
        amount,
        FOUNDER_STREAM_DURATION
    );
    Ok(())
}

/// Move a community stream's vested-but-uncredited portion into the staking
/// accumulator. Fails when nothing has vested since the last call, so a
/// spammed crank cannot pad the reward history with zero-value events.
pub fn release_community_stream(ctx: Context<ReleaseCommunityStream>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cs = &mut ctx.accounts.community_stream;

    let delta = cs.releasable(now)?;
    require!(delta > 0, DistributorError::NothingToWithdraw);

    cs.released = cs
        .released
        .checked_add(delta)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    ctx.accounts.pool.add_token_rewards(delta)?;

    msg!(
        "release_community_stream: kind {} released {} to bucket 1 ({} of {} total)",
        cs.kind,
        delta,
        cs.released,
        cs.total
    );
    Ok(())
}
