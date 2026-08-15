use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer};

/// Move lamports out of the SOL reward vault.
///
/// The vault is owned by this program, which is what permits debiting its
/// lamports directly instead of paying for a System CPI on every claim. Its
/// rent-exempt floor is never spendable.
///
/// This is the single exit for lamports, which is why `reserved_sol` is
/// decremented here rather than at each of the four call sites: one place to
/// get right, and no way to add a fifth exit that forgets.
pub(crate) fn pay_sol_from_vault<'info>(
    sol_vault: &Account<'info, SolVault>,
    recipient: &AccountInfo<'info>,
    pool: &mut StakePool,
    amount: u64,
    rent: &Rent,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let info = sol_vault.to_account_info();
    let floor = rent.minimum_balance(info.data_len());
    let available = info.lamports().saturating_sub(floor);
    require!(
        available >= amount,
        DistributorError::InsufficientBucketBalance
    );

    pool.reserved_sol = pool
        .reserved_sol
        .checked_sub(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    **info.try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;
    Ok(())
}

/// Move reward-mint tokens out of the vault.
///
/// The counterpart to `pay_sol_from_vault`, and the single exit for tokens for
/// the same reason: `reserved_token` is maintained in one place. It also
/// replaces six near-identical copies of this CPI that previously lived in the
/// claim, stream, unstake, exit and reward paths.
pub(crate) fn pay_token_from_vault<'info>(
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    config: &Account<'info, Config>,
    token_program: &Program<'info, Token>,
    pool: &mut StakePool,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    pool.reserved_token = pool
        .reserved_token
        .checked_sub(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    let signer: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config.bump]]];
    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: destination.to_account_info(),
                authority: config.to_account_info(),
            },
            signer,
        ),
        amount,
    )
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + StakePosition::INIT_SPACE,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, StakePosition>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = source.mint == config.reward_mint,
        constraint = source.owner == owner.key(),
    )]
    pub source: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake(ctx: Context<Stake>, amount: u64, tier_raw: u8) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);
    let tier = Tier::from_u8(tier_raw)?;
    let now = Clock::get()?.unix_timestamp;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let is_new = position.owner == Pubkey::default();

    if is_new {
        position.owner = ctx.accounts.owner.key();
        position.amount = 0;
        position.tier = tier;
        position.weight = 0;
        position.lock_end = 0;
        position.unstake_requested_at = 0;
        position.token_debt = pool.acc_token_per_weight;
        position.sol_debt = pool.acc_sol_per_weight;
        position.claimable_token = 0;
        position.claimable_sol = 0;
        position.escrow_token = 0;
        position.escrow_sol = 0;
        position.created_at = now;
        position.bump = ctx.bumps.position;
    } else {
        // Settle at the *old* weight before anything about the position changes.
        position.settle(pool)?;
        // A top-up may keep the current tier or move up to a longer lock, but it
        // may never move down; that would let someone buy the 5.0x rate and
        // then shorten the commitment it was paying for.
        require!(
            tier.multiplier_bps() >= position.tier.multiplier_bps(),
            DistributorError::InvalidTier
        );
    }

    let tier_changed = position.tier != tier;
    position.tier = tier;

    if tier.is_locked_tier() {
        let fresh_lock = now
            .checked_add(tier.lock_duration())
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        // Upgrading restarts the clock at the new duration. A same-tier top-up
        // never shortens or extends the existing lock on principal already down.
        position.lock_end = if tier_changed || is_new {
            fresh_lock
        } else {
            position.lock_end.max(now)
        };
    } else {
        position.lock_end = 0;
    }

    // Re-staking cancels any pending unstake request.
    position.unstake_requested_at = 0;

    let old_weight = position.weight;
    let new_amount = position
        .amount
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let new_weight = StakePosition::compute_weight(new_amount, tier)?;

    position.amount = new_amount;
    position.weight = new_weight;

    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|v| v.checked_add(new_weight))
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    // Staked principal is tokens physically entering the vault.
    pool.reserved_token = pool
        .reserved_token
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    anchor_spl::token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.source.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    msg!(
        "stake: owner={} amount={} tier={:?} weight={} lock_end={}",
        position.owner,
        amount,
        tier,
        new_weight,
        position.lock_end
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RequestUnstake<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ DistributorError::Unauthorized,
    )]
    pub position: Account<'info, StakePosition>,
}

/// Start the flexible-tier cooldown. Locked tiers do not use this: their gate
/// is maturity, not a timer the staker starts.
pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    require!(!position.tier.is_locked_tier(), DistributorError::NotLocked);
    position.unstake_requested_at = Clock::get()?.unix_timestamp;
    msg!("unstake requested at {}", position.unstake_requested_at);
    Ok(())
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ DistributorError::Unauthorized,
    )]
    pub position: Account<'info, StakePosition>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Withdraw principal after the lock matures (locked tiers) or after the
/// cooldown elapses (flexible). Fully exiting also sweeps out settled base
/// rewards and the matured boost escrow in the same transaction.
pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    require!(amount <= position.amount, DistributorError::ZeroAmount);

    if position.tier.is_locked_tier() {
        require!(now >= position.lock_end, DistributorError::StillLocked);
    } else {
        require!(
            position.unstake_requested_at != 0,
            DistributorError::NoUnstakeRequested
        );
        require!(
            now >= position.unstake_requested_at + UNSTAKE_COOLDOWN,
            DistributorError::CooldownActive
        );
    }

    position.settle(pool)?;

    let old_weight = position.weight;
    let remaining = position
        .amount
        .checked_sub(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let new_weight = StakePosition::compute_weight(remaining, position.tier)?;

    position.amount = remaining;
    position.weight = new_weight;

    pool.total_weight = pool
        .total_weight
        .checked_sub(old_weight)
        .and_then(|v| v.checked_add(new_weight))
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    // A full exit is by definition at or past maturity, so the boost escrow is
    // released alongside the principal rather than stranded in the account.
    let mut token_out = amount;
    let mut sol_out = 0u64;
    if remaining == 0 {
        token_out = token_out
            .checked_add(position.claimable_token)
            .and_then(|v| v.checked_add(position.escrow_token))
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        sol_out = position
            .claimable_sol
            .checked_add(position.escrow_sol)
            .ok_or_else(|| error!(DistributorError::MathOverflow))?;
        position.claimable_token = 0;
        position.escrow_token = 0;
        position.claimable_sol = 0;
        position.escrow_sol = 0;
        position.unstake_requested_at = 0;
    }

    pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        pool,
        token_out,
    )?;

    pay_sol_from_vault(
        &ctx.accounts.sol_vault,
        &ctx.accounts.owner.to_account_info(),
        pool,
        sol_out,
        &ctx.accounts.rent,
    )?;

    msg!(
        "unstake: principal={} tokens_out={} sol_out={} remaining={}",
        amount,
        token_out,
        sol_out,
        remaining
    );
    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyExit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ DistributorError::Unauthorized,
        close = owner,
    )]
    pub position: Account<'info, StakePosition>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Break a lock early.
///
/// The staker keeps their settled base rewards. That is the part a flexible
/// staker would have earned anyway, and it was always immediately claimable.
/// They forfeit the boost escrow (the portion the multiplier bought, which they
/// did not finish earning) plus 15% of principal. Both forfeitures are
/// redistributed to the stakers who stayed, which is why the exiting position's
/// weight is removed from the pool *before* the redistribution happens.
pub fn emergency_exit(ctx: Context<EmergencyExit>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;

    require!(
        position.tier.is_locked_tier(),
        DistributorError::NotLocked
    );
    require!(now < position.lock_end, DistributorError::StillLocked);

    position.settle(pool)?;

    let principal = position.amount;
    let slash = (principal as u128)
        .checked_mul(EMERGENCY_EXIT_SLASH_BPS as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR as u128))
        .ok_or_else(|| error!(DistributorError::MathOverflow))? as u64;
    let principal_out = principal
        .checked_sub(slash)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    let forfeited_token = position.escrow_token;
    let forfeited_sol = position.escrow_sol;
    let base_token = position.claimable_token;
    let base_sol = position.claimable_sol;

    // Remove this position from the pool first so the forfeit is shared only
    // among the stakers who remain.
    pool.total_weight = pool
        .total_weight
        .checked_sub(position.weight)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(principal)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    position.amount = 0;
    position.weight = 0;
    position.claimable_token = 0;
    position.claimable_sol = 0;
    position.escrow_token = 0;
    position.escrow_sol = 0;

    // The slash and the forfeited boost stay physically in the vaults; they
    // are only reclassified from "this staker's" to "everyone else's". The
    // reserved counters therefore stay exactly where they are.
    let redistributed_token = forfeited_token
        .checked_add(slash)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.add_token_rewards(redistributed_token)?;
    pool.add_sol_rewards(forfeited_sol)?;

    let token_out = principal_out
        .checked_add(base_token)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        pool,
        token_out,
    )?;

    pay_sol_from_vault(
        &ctx.accounts.sol_vault,
        &ctx.accounts.owner.to_account_info(),
        pool,
        base_sol,
        &ctx.accounts.rent,
    )?;

    msg!(
        "emergency_exit: principal={} slash={} forfeited_boost_token={} forfeited_boost_sol={}",
        principal,
        slash,
        forfeited_token,
        forfeited_sol
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ DistributorError::Unauthorized,
    )]
    pub position: Account<'info, StakePosition>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Withdraw settled base rewards. Available to every tier at any time: this is
/// the check-in loop, and locking it away would defeat the point of the pool.
/// The boost portion is deliberately untouched here.
pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    position.settle(pool)?;

    let token_out = position.claimable_token;
    let sol_out = position.claimable_sol;
    require!(
        token_out > 0 || sol_out > 0,
        DistributorError::NothingToWithdraw
    );
    position.claimable_token = 0;
    position.claimable_sol = 0;

    pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        pool,
        token_out,
    )?;

    pay_sol_from_vault(
        &ctx.accounts.sol_vault,
        &ctx.accounts.owner.to_account_info(),
        pool,
        sol_out,
        &ctx.accounts.rent,
    )?;

    msg!("claim_rewards: token={} sol={}", token_out, sol_out);
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawBoostEscrow<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ DistributorError::Unauthorized,
    )]
    pub position: Account<'info, StakePosition>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Release the boost portion once the lock has matured. Before maturity this
/// always fails; that is precisely what makes the multiplier conditional on
/// honouring the lock rather than a free upgrade.
pub fn withdraw_boost_escrow(ctx: Context<WithdrawBoostEscrow>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;

    require!(position.is_matured(now), DistributorError::EscrowNotMatured);
    position.settle(pool)?;

    let token_out = position.escrow_token;
    let sol_out = position.escrow_sol;
    require!(
        token_out > 0 || sol_out > 0,
        DistributorError::NothingToWithdraw
    );
    position.escrow_token = 0;
    position.escrow_sol = 0;

    pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        pool,
        token_out,
    )?;

    pay_sol_from_vault(
        &ctx.accounts.sol_vault,
        &ctx.accounts.owner.to_account_info(),
        pool,
        sol_out,
        &ctx.accounts.rent,
    )?;

    msg!("withdraw_boost_escrow: token={} sol={}", token_out, sol_out);
    Ok(())
}
