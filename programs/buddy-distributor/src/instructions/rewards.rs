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

/// Deposit token rewards into bucket 1. Permissionless by design — the routed
/// share of pump.fun creator fees, community donations and any future revenue
/// all arrive through this one door, and anyone can top the pool up without
/// asking permission.
pub fn notify_token_rewards(ctx: Context<NotifyTokenRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);

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

/// Deposit SOL rewards into bucket 1.
pub fn notify_sol_rewards(ctx: Context<NotifySolRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, DistributorError::ZeroAmount);

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
