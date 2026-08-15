use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeParams {
    /// Merkle root over (wallet, amount) for old Buddy holders.
    pub old_holder_root: [u8; 32],
    pub old_holder_allocation: u64,
    /// Merkle root over (wallet, amount) for the published influencer list.
    pub influencer_root: [u8; 32],
    pub influencer_allocation: u64,
    /// Uncompressed secp256k1 key from the 2014 transaction, X||Y, 0x04 stripped.
    pub original_signer_pubkey: [u8; 64],
    pub original_signer_allocation: u64,
    pub dev_wallet: Pubkey,
    pub dev_allocation: u64,
    /// Seconds after `claims_start` before the dev stream begins releasing.
    pub dev_cliff_seconds: i64,
    /// When claim windows begin. Pass 0 to use the current block time.
    pub claims_start: i64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The key allowed to fund buckets before the lock. It has no power at all
    /// afterwards, and the window is a single short session, so a plain wallet
    /// is sufficient; the authority that actually matters long-term is the
    /// program's upgrade authority, which is burned on launch day.
    /// CHECK: stored as a plain key; never signs after `lock_config`.
    pub authority: UncheckedAccount<'info>,

    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + StakePool::INIT_SPACE,
        seeds = [POOL_SEED],
        bump
    )]
    pub pool: Account<'info, StakePool>,

    /// Single token vault holding every bucket's tokens plus all staked
    /// principal. Bucket balances are tracked in `Config`; the vault is the
    /// physical custody account.
    #[account(
        init,
        payer = payer,
        token::mint = reward_mint,
        token::authority = config,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Program-owned PDA holding SOL rewards (routed creator fees, donations).
    #[account(
        init,
        payer = payer,
        space = 8 + SolVault::INIT_SPACE,
        seeds = [SOL_VAULT_SEED],
        bump
    )]
    pub sol_vault: Account<'info, SolVault>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let claims_start = if params.claims_start == 0 {
        now
    } else {
        params.claims_start
    };

    // `init` already funds the vault to rent exemption. That floor is never
    // spendable as rewards: `pay_sol_from_vault` subtracts it before paying.
    ctx.accounts.sol_vault.bump = ctx.bumps.sol_vault;

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.reward_mint = ctx.accounts.reward_mint.key();
    config.locked = false;
    config.claims_start = claims_start;

    config.old_holder_root = params.old_holder_root;
    config.old_holder_allocation = params.old_holder_allocation;
    config.old_holder_claimed = 0;
    config.old_holder_deadline = claims_start
        .checked_add(OLD_HOLDER_CLAIM_WINDOW)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    config.old_holder_swept = false;

    config.influencer_root = params.influencer_root;
    config.influencer_allocation = params.influencer_allocation;
    config.influencer_claimed = 0;
    config.influencer_deadline = claims_start
        .checked_add(INFLUENCER_CLAIM_WINDOW)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    config.influencer_swept = false;

    config.original_signer_pubkey = params.original_signer_pubkey;
    config.original_signer_allocation = params.original_signer_allocation;
    config.original_signer_claimed = false;
    config.original_signer_swept = false;

    config.dev_wallet = params.dev_wallet;
    config.dev_allocation = params.dev_allocation;
    config.dev_stream_created = false;

    config.bump = ctx.bumps.config;
    config.vault_bump = ctx.bumps.vault;
    config.sol_vault_bump = ctx.bumps.sol_vault;

    let pool = &mut ctx.accounts.pool;
    pool.total_weight = 0;
    pool.total_staked = 0;
    pool.acc_token_per_weight = 0;
    pool.acc_sol_per_weight = 0;
    pool.pending_token_rewards = 0;
    pool.pending_sol_rewards = 0;
    pool.lifetime_token_rewards = 0;
    pool.lifetime_sol_rewards = 0;
    pool.reserved_sol = 0;
    pool.reserved_token = 0;
    pool.bump = ctx.bumps.pool;

    msg!(
        "distributor initialized: old={} inf={} signer={} dev={} deadline_old={} deadline_inf={}",
        params.old_holder_allocation,
        params.influencer_allocation,
        params.original_signer_allocation,
        params.dev_allocation,
        config.old_holder_deadline,
        config.influencer_deadline
    );
    Ok(())
}

/// Move the committed token allocations into the vault. Callable only before
/// the lock, and only by the authority.
#[derive(Accounts)]
pub struct FundVault<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ DistributorError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Needed so the deposit registers in `reserved_token`.
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, constraint = source.mint == config.reward_mint)]
    pub source: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    ctx.accounts.config.assert_unlocked()?;
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
            anchor_spl::token::Transfer {
                from: ctx.accounts.source.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
    )?;
    msg!("vault funded with {}", amount);
    Ok(())
}

/// Freeze the configuration.
///
/// This is the moment the published tokenomics stop being a promise. The
/// authority verifies the vault physically holds every committed allocation,
/// then gives up the ability to change any of them. Claims cannot run until
/// this has happened.
#[derive(Accounts)]
pub struct LockConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ DistributorError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
}

pub fn lock_config(ctx: Context<LockConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.assert_unlocked()?;

    let committed = config
        .old_holder_allocation
        .checked_add(config.influencer_allocation)
        .and_then(|v| v.checked_add(config.original_signer_allocation))
        .and_then(|v| v.checked_add(config.dev_allocation))
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    // Deliberately checks what arrived through `fund_vault`, not what the
    // vault happens to hold. `reserved_token` rises only inside that
    // instruction, so tokens that got here any other way cannot satisfy this:
    // a donation to the vault address we publish, or the last tranche sent by
    // an ordinary wallet transfer instead of the instruction.
    //
    // The distinction decides whether this contract can end up insolvent.
    // Anything the vault holds beyond `reserved_token` is untracked, and
    // untracked tokens belong to the staking pool the moment anyone calls
    // `sync_token_rewards`. Letting them count as bucket backing here would
    // promise the same tokens to two different people, and this instruction
    // is the point of no return: `fund_vault` asserts the config is unlocked,
    // so the moment this succeeds there is no way to add tokens ever again.
    require!(
        ctx.accounts.pool.reserved_token >= committed,
        DistributorError::InsufficientBucketBalance
    );

    // Implied by the line above, since the vault can never hold less than is
    // reserved. Stated anyway, because this is the last instant the promise
    // can still be refused, and it costs one comparison to say out loud that
    // the tokens are really there.
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.pool.reserved_token,
        DistributorError::InsufficientBucketBalance
    );

    config.locked = true;
    msg!(
        "config locked; {} tokens committed across buckets, {} reserved in the vault",
        committed,
        ctx.accounts.pool.reserved_token
    );
    Ok(())
}

/// Create the dev's vesting stream. Permissionless on purpose: anyone can
/// trigger it, and it can only ever produce the exact terms fixed at init.
/// The dev's tokens never touch a wallet he controls; they exist only inside
/// this stream.
#[derive(Accounts)]
pub struct CreateDevStream<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + Stream::INIT_SPACE,
        seeds = [STREAM_SEED, config.dev_wallet.as_ref()],
        bump
    )]
    pub stream: Account<'info, Stream>,

    pub system_program: Program<'info, System>,
}

pub fn create_dev_stream(ctx: Context<CreateDevStream>, cliff_seconds: i64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;
    require!(
        !config.dev_stream_created,
        DistributorError::StreamAlreadyExists
    );

    let start = config.claims_start;
    let stream = &mut ctx.accounts.stream;
    stream.beneficiary = config.dev_wallet;
    stream.total = config.dev_allocation;
    stream.withdrawn = 0;
    stream.start = start;
    stream.cliff = start
        .checked_add(cliff_seconds.max(0))
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    stream.end = start
        .checked_add(FOUNDER_STREAM_DURATION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    stream.bump = ctx.bumps.stream;

    config.dev_stream_created = true;
    msg!(
        "dev stream created: total={} start={} cliff={} end={}",
        stream.total,
        stream.start,
        stream.cliff,
        stream.end
    );
    Ok(())
}
