use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as system_transfer, Transfer as SystemTransfer};
use anchor_spl::token::{Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct NotifyTokenRewards<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = source.mint == config.reward_mint,
        constraint = source.owner == depositor.key(),
    )]
    pub source: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Push token rewards into bucket 1 from an account you control.
///
/// Permissionless — anyone can top the pool up. Use this when you hold the
/// tokens and want to donate them; use `sync_token_rewards` instead when tokens
/// have already landed in the vault by some other route.
pub fn notify_token_rewards(ctx: Context<NotifyTokenRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);

    ctx.accounts.pool.reserved_token = ctx
        .accounts
        .pool
        .reserved_token
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    anchor_spl::token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.source.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;

    ctx.accounts.pool.add_token_rewards(amount)?;
    msg!("notify_token_rewards: {}", amount);
    Ok(())
}

#[derive(Accounts)]
pub struct NotifySolRewards<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    pub system_program: Program<'info, System>,
}

/// Push SOL rewards into bucket 1 from your own wallet.
///
/// The counterpart to `sync_sol_rewards`: this one moves lamports *and* books
/// them in a single step, which is why it can only credit what it transfers.
pub fn notify_sol_rewards(ctx: Context<NotifySolRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);

    ctx.accounts.pool.reserved_sol = ctx
        .accounts
        .pool
        .reserved_sol
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    system_transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            SystemTransfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    ctx.accounts.pool.add_sol_rewards(amount)?;
    msg!("notify_sol_rewards: {}", amount);
    Ok(())
}

#[derive(Accounts)]
pub struct FlushPending<'info> {
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
}

/// Fold rewards that arrived while nobody was staked into the accumulator.
///
/// Rewards deposited into an empty pool are buffered rather than dropped, and
/// land on whoever is staked when this runs. Because that timing is
/// observable, the pool should not be funded before staking opens; the deploy
/// runbook sequences it that way.
pub fn flush_pending(ctx: Context<FlushPending>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.total_weight > 0, DistributorError::NoStakers);
    pool.flush_pending()?;
    msg!(
        "flush_pending complete: acc_token={} acc_sol={}",
        pool.acc_token_per_weight,
        pool.acc_sol_per_weight
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Sync — turn funds that arrived from outside into staker rewards.
//
// Crediting an account on Solana needs no permission, so value can land in the
// vaults without this program being involved: a pump.fun fee distribution, a
// donation to an address published on the Verify page, a mistake. `notify_*`
// cannot help — it books only what it transfers itself.
//
// Without these instructions such funds would be visible, unowned and
// permanently frozen, on a contract that can never be patched. With them,
// anyone can sweep them to the stakers. That is also what lets creator fees be
// pointed straight at the vault instead of a wallet somebody has to be trusted
// to empty.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SyncSolRewards<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    pub rent: Sysvar<'info, Rent>,
}

/// Credit lamports sitting in the SOL vault that nobody has accounted for yet.
pub fn sync_sol_rewards(ctx: Context<SyncSolRewards>) -> Result<()> {
    let info = ctx.accounts.sol_vault.to_account_info();
    // The rent-exempt floor keeps the vault alive and is never distributable.
    let floor = ctx.accounts.rent.minimum_balance(info.data_len());
    let untracked = info
        .lamports()
        .saturating_sub(floor)
        .saturating_sub(ctx.accounts.pool.reserved_sol);

    require!(untracked > 0, DistributorError::NothingToWithdraw);

    let pool = &mut ctx.accounts.pool;
    pool.reserved_sol = pool
        .reserved_sol
        .checked_add(untracked)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.add_sol_rewards(untracked)?;

    msg!("sync_sol_rewards: credited {} untracked lamports", untracked);
    Ok(())
}

#[derive(Accounts)]
pub struct SyncTokenRewards<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
}

/// Credit reward-mint tokens sitting in the vault that nobody has accounted for.
pub fn sync_token_rewards(ctx: Context<SyncTokenRewards>) -> Result<()> {
    let untracked = ctx
        .accounts
        .vault
        .amount
        .saturating_sub(ctx.accounts.pool.reserved_token);

    require!(untracked > 0, DistributorError::NothingToWithdraw);

    let pool = &mut ctx.accounts.pool;
    pool.reserved_token = pool
        .reserved_token
        .checked_add(untracked)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.add_token_rewards(untracked)?;

    msg!("sync_token_rewards: credited {} untracked tokens", untracked);
    Ok(())
}

#[derive(Accounts)]
pub struct UnwrapWsol<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [SOL_VAULT_SEED], bump = config.sol_vault_bump)]
    pub sol_vault: Account<'info, SolVault>,

    /// A wrapped-SOL token account owned by the SOL vault. Closing it releases
    /// both the wrapped balance and the account's own rent as plain lamports.
    #[account(
        mut,
        constraint = wsol_account.mint == WSOL_MINT @ DistributorError::InvalidWsolAccount,
        constraint = wsol_account.owner == sol_vault.key() @ DistributorError::InvalidWsolAccount,
    )]
    pub wsol_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Convert wrapped SOL held by the vault into spendable lamports, and credit it.
///
/// Once a pump.fun coin graduates to the AMM, creator fees are paid in wrapped
/// SOL into a token account rather than as native lamports. Without this the
/// vault could receive fees it was structurally unable to distribute — and
/// being immutable, would stay that way forever.
///
/// Permissionless, and hard-wired to the wSOL mint so it can never be pointed
/// at anything else.
pub fn unwrap_wsol(ctx: Context<UnwrapWsol>) -> Result<()> {
    let before = ctx.accounts.sol_vault.to_account_info().lamports();

    let sol_vault_bump = ctx.accounts.config.sol_vault_bump;
    let signer: &[&[&[u8]]] = &[&[SOL_VAULT_SEED, &[sol_vault_bump]]];

    anchor_spl::token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::CloseAccount {
            account: ctx.accounts.wsol_account.to_account_info(),
            destination: ctx.accounts.sol_vault.to_account_info(),
            authority: ctx.accounts.sol_vault.to_account_info(),
        },
        signer,
    ))?;

    let after = ctx.accounts.sol_vault.to_account_info().lamports();
    let released = after
        .checked_sub(before)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    require!(released > 0, DistributorError::NothingToWithdraw);

    let pool = &mut ctx.accounts.pool;
    pool.reserved_sol = pool
        .reserved_sol
        .checked_add(released)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    pool.add_sol_rewards(released)?;

    msg!("unwrap_wsol: released and credited {} lamports", released);
    Ok(())
}
