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
/// decremented here rather than at each call site: one place to get right, and
/// no way to add another exit that forgets.
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

// ---------------------------------------------------------------------------
// Flexible staking: one position per wallet, 1.0x, exit gated only by the
// unstake cooldown. Anything with a lock lives in `Lockup` accounts below.
// ---------------------------------------------------------------------------

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

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    // The pool only opens once the config is locked. Before then, the only
    // thing that may raise `reserved_token` is `fund_vault`, which is what
    // lets `lock_config` treat `reserved_token` as an honest solvency proof.
    ctx.accounts.config.assert_locked()?;
    require!(amount > 0, DistributorError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    let is_new = position.owner == Pubkey::default();

    if is_new {
        position.owner = ctx.accounts.owner.key();
        position.amount = 0;
        position.tier = Tier::Flexible;
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
    }

    // Topping up cancels any pending unstake request: the cooldown separates a
    // withdrawal from the rewards it would capture, and a deposit restarts
    // that clock.
    position.unstake_requested_at = 0;

    let old_weight = position.weight;
    let new_amount = position
        .amount
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    // Flexible weight is the amount itself (1.0x), which is what guarantees
    // `settle` can never route anything into this position's escrow.
    let new_weight = new_amount as u128;

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
        "stake: owner={} amount={} weight={}",
        position.owner,
        amount,
        new_weight
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

/// Start the unstake cooldown. Lockups do not use this: their gate is
/// maturity, not a timer the staker starts.
pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
    let position = &mut ctx.accounts.position;
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

/// Withdraw principal after the cooldown elapses, partially or in full. A full
/// exit also sweeps out settled rewards in the same transaction.
pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    require!(amount <= position.amount, DistributorError::ZeroAmount);

    require!(
        position.unstake_requested_at != 0,
        DistributorError::NoUnstakeRequested
    );
    require!(
        now >= position.unstake_requested_at + UNSTAKE_COOLDOWN,
        DistributorError::CooldownActive
    );

    position.settle(pool)?;

    let old_weight = position.weight;
    let remaining = position
        .amount
        .checked_sub(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let new_weight = remaining as u128;

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

    // A full exit sweeps settled rewards out alongside the principal rather
    // than leaving them stranded in an emptied account. Escrow is structurally
    // zero on a flexible position; it is included so a nonzero balance could
    // never be left behind under any history.
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

/// Withdraw a flexible position's settled rewards, at any time. This is the
/// check-in loop, and locking it away would defeat the point of the pool.
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

// ---------------------------------------------------------------------------
// Lockups: one account per lock, so committing new principal can never touch
// the terms of principal already down. The multiplier's extra earnings sit in
// escrow until maturity; after maturity anyone may demote the lockup to 1.0x,
// because the commitment the boost was paying for is over.
// ---------------------------------------------------------------------------

/// Release a matured lockup's escrow and cut its weight back to 1.0x. The
/// caller must have settled first, so everything the multiplier earned during
/// the lock is already in the escrow being released here.
fn release_boost_and_demote(lockup: &mut Lockup, pool: &mut StakePool) -> Result<()> {
    lockup.claimable_token = lockup
        .claimable_token
        .checked_add(lockup.escrow_token)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    lockup.claimable_sol = lockup
        .claimable_sol
        .checked_add(lockup.escrow_sol)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    lockup.escrow_token = 0;
    lockup.escrow_sol = 0;

    let boost_weight = lockup
        .weight
        .checked_sub(lockup.amount as u128)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_weight = pool
        .total_weight
        .checked_sub(boost_weight)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    lockup.weight = lockup.amount as u128;
    lockup.demoted = true;
    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64, tier: u8, index: u64)]
pub struct LockTokens<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + LockupCounter::INIT_SPACE,
        seeds = [LOCKUP_COUNT_SEED, owner.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, LockupCounter>,

    #[account(
        init,
        payer = owner,
        space = 8 + Lockup::INIT_SPACE,
        seeds = [LOCKUP_SEED, owner.key().as_ref(), index.to_le_bytes().as_ref()],
        bump
    )]
    pub lockup: Account<'info, Lockup>,

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

/// Open a new lockup at a locked tier.
///
/// `index` names the lockup PDA being created and must equal the counter's
/// current count. The counter is the authority on the next index, but Anchor
/// resolves the lockup's seeds before this handler can read (or initialize)
/// the counter, so the client supplies the index and it is pinned here; a
/// stale or skipped value fails instead of fragmenting the sequence.
pub fn lock_tokens(ctx: Context<LockTokens>, amount: u64, tier: u8, index: u64) -> Result<()> {
    // Like `stake`: the pool is not open until the config is locked, so this
    // cannot pre-inflate the `reserved_token` that `lock_config` proves against.
    ctx.accounts.config.assert_locked()?;
    require!(amount > 0, DistributorError::ZeroAmount);
    let tier = Tier::from_u8(tier)?;
    // Flexible principal belongs in `stake`. A zero-duration lockup would be a
    // flexible position that skips the unstake cooldown.
    require!(tier.is_locked_tier(), DistributorError::InvalidTier);
    let now = Clock::get()?.unix_timestamp;

    let counter = &mut ctx.accounts.counter;
    if counter.owner == Pubkey::default() {
        counter.owner = ctx.accounts.owner.key();
        counter.bump = ctx.bumps.counter;
    }
    require!(
        index == counter.count,
        DistributorError::InvalidLockupIndex
    );
    counter.count = counter
        .count
        .checked_add(1)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    let pool = &mut ctx.accounts.pool;
    let lockup = &mut ctx.accounts.lockup;

    let weight = compute_weight(amount, tier)?;
    let lock_end = now
        .checked_add(tier.lock_duration())
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    lockup.owner = ctx.accounts.owner.key();
    lockup.index = index;
    lockup.amount = amount;
    lockup.tier = tier;
    lockup.weight = weight;
    lockup.lock_end = lock_end;
    lockup.demoted = false;
    lockup.token_debt = pool.acc_token_per_weight;
    lockup.sol_debt = pool.acc_sol_per_weight;
    lockup.claimable_token = 0;
    lockup.claimable_sol = 0;
    lockup.escrow_token = 0;
    lockup.escrow_sol = 0;
    lockup.created_at = now;
    lockup.bump = ctx.bumps.lockup;

    pool.total_weight = pool
        .total_weight
        .checked_add(weight)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    // Locked principal is tokens physically entering the vault.
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
        "lock_tokens: owner={} index={} amount={} tier={:?} weight={} lock_end={}",
        lockup.owner,
        index,
        amount,
        tier,
        weight,
        lock_end
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimLockupRewards<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [LOCKUP_SEED, owner.key().as_ref(), lockup.index.to_le_bytes().as_ref()],
        bump = lockup.bump,
        has_one = owner @ DistributorError::Unauthorized,
    )]
    pub lockup: Account<'info, Lockup>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Withdraw a lockup's settled base rewards, at any time. The escrowed boost
/// is deliberately untouched here: it is only reachable through maturity.
pub fn claim_lockup_rewards(ctx: Context<ClaimLockupRewards>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let lockup = &mut ctx.accounts.lockup;
    lockup.settle(pool)?;

    // If the lock has already matured, drop it to base weight here rather than
    // waiting for a separate demote crank. The multiplier is meant to end with
    // the commitment, so an owner claiming their base rewards after maturity
    // should not keep carrying boosted weight into the next distribution. The
    // permissionless `demote_matured` crank still exists for lockups whose
    // owners never interact; this just means an active owner self-corrects.
    if now >= lockup.lock_end && !lockup.demoted {
        release_boost_and_demote(lockup, pool)?;
    }

    let token_out = lockup.claimable_token;
    let sol_out = lockup.claimable_sol;
    require!(
        token_out > 0 || sol_out > 0,
        DistributorError::NothingToWithdraw
    );
    lockup.claimable_token = 0;
    lockup.claimable_sol = 0;

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

    msg!("claim_lockup_rewards: token={} sol={}", token_out, sol_out);
    Ok(())
}

#[derive(Accounts)]
pub struct DemoteMatured<'info> {
    /// Any signer. Nothing is paid out and nothing belongs to the cranker, so
    /// no funds ever depend on who runs this.
    pub cranker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [LOCKUP_SEED, lockup.owner.as_ref(), lockup.index.to_le_bytes().as_ref()],
        bump = lockup.bump,
    )]
    pub lockup: Account<'info, Lockup>,
}

/// Cut a matured lockup back to base weight. Permissionless: the owner has no
/// incentive to run this (it only reduces their share), so anyone may. Until
/// someone does, a matured lockup keeps earning at its multiplier, which is
/// paying for a commitment that has already ended, at every other staker's
/// expense.
pub fn demote_matured(ctx: Context<DemoteMatured>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let lockup = &mut ctx.accounts.lockup;

    require!(now >= lockup.lock_end, DistributorError::EscrowNotMatured);
    require!(!lockup.demoted, DistributorError::AlreadyDemoted);

    // Settle at the boosted weight first: everything earned up to this moment
    // was earned under the lock and belongs to the owner.
    lockup.settle(pool)?;
    release_boost_and_demote(lockup, pool)?;

    msg!(
        "demote_matured: owner={} index={} weight={}",
        lockup.owner,
        lockup.index,
        lockup.weight
    );
    Ok(())
}

#[derive(Accounts)]
pub struct UnlockTokens<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [LOCKUP_SEED, owner.key().as_ref(), lockup.index.to_le_bytes().as_ref()],
        bump = lockup.bump,
        has_one = owner @ DistributorError::Unauthorized,
        close = owner,
    )]
    pub lockup: Account<'info, Lockup>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Close a matured lockup: principal, base rewards and the escrowed boost all
/// pay out together, and the account's rent returns to the owner.
pub fn unlock_tokens(ctx: Context<UnlockTokens>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let lockup = &mut ctx.accounts.lockup;

    require!(now >= lockup.lock_end, DistributorError::StillLocked);

    // Settle at whatever weight is current: boosted if no crank demoted this
    // lockup yet, base if one already did.
    lockup.settle(pool)?;
    if !lockup.demoted {
        release_boost_and_demote(lockup, pool)?;
    }

    let principal = lockup.amount;
    let token_out = principal
        .checked_add(lockup.claimable_token)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    let sol_out = lockup.claimable_sol;

    // Post-demotion `weight == amount`, so this removes exactly the base
    // weight that remained.
    pool.total_weight = pool
        .total_weight
        .checked_sub(lockup.weight)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(principal)
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
        sol_out,
        &ctx.accounts.rent,
    )?;

    msg!(
        "unlock_tokens: principal={} tokens_out={} sol_out={}",
        principal,
        token_out,
        sol_out
    );
    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyExitLockup<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        mut,
        seeds = [LOCKUP_SEED, owner.key().as_ref(), lockup.index.to_le_bytes().as_ref()],
        bump = lockup.bump,
        has_one = owner @ DistributorError::Unauthorized,
        close = owner,
    )]
    pub lockup: Account<'info, Lockup>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    #[account(mut, constraint = destination.mint == config.reward_mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Break a lockup early.
///
/// The staker keeps their settled base rewards. That is the part a flexible
/// staker would have earned anyway, and it was always immediately claimable.
/// They forfeit the boost escrow (the portion the multiplier bought, which
/// they did not finish earning) plus 15% of principal. Both forfeitures are
/// redistributed to the stakers who stayed, which is why the exiting lockup's
/// weight is removed from the pool *before* the redistribution happens.
///
/// Only before maturity: a matured lockup has honoured its commitment and
/// exits through `unlock_tokens` with nothing to forfeit.
pub fn emergency_exit_lockup(ctx: Context<EmergencyExitLockup>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let lockup = &mut ctx.accounts.lockup;

    require!(now < lockup.lock_end, DistributorError::StillLocked);

    // No route pulls staked principal back out inside the first 24 hours. The
    // flexible tier enforces that through the unstake cooldown; a locked tier
    // must honour the same floor before an early exit, or a one-month lockup
    // would be a way to unstake within minutes and sidestep the flash-stake
    // protection the cooldown exists for. Same window, same reason, every tier.
    require!(
        now >= lockup.created_at + UNSTAKE_COOLDOWN,
        DistributorError::CooldownActive
    );

    lockup.settle(pool)?;

    let principal = lockup.amount;
    let slash = (principal as u128)
        .checked_mul(EMERGENCY_EXIT_SLASH_BPS as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR as u128))
        .ok_or_else(|| error!(DistributorError::MathOverflow))? as u64;
    let principal_out = principal
        .checked_sub(slash)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    let forfeited_token = lockup.escrow_token;
    let forfeited_sol = lockup.escrow_sol;
    let base_token = lockup.claimable_token;
    let base_sol = lockup.claimable_sol;

    // Remove this lockup from the pool first so the forfeit is shared only
    // among the stakers who remain.
    pool.total_weight = pool
        .total_weight
        .checked_sub(lockup.weight)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(principal)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

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
        "emergency_exit_lockup: principal={} slash={} forfeited_boost_token={} forfeited_boost_sol={}",
        principal,
        slash,
        forfeited_token,
        forfeited_sol
    );
    Ok(())
}
