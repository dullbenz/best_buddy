use crate::constants::*;
use crate::errors::DistributorError;
use crate::state::*;
use crate::utils::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

// ---------------------------------------------------------------------------
// Bucket 2: old Buddy holders. 30-day window, instant transfer, no stream.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimOldHolder<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// Existence of this account is the double-claim guard: `init` fails if a
    /// receipt for this wallet is already on chain.
    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [OLD_CLAIM_SEED, claimant.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, ClaimReceipt>,

    /// Needed only so the payout can decrement `reserved_token`, which is what
    /// lets `sync_token_rewards` tell accounted funds from stray ones.
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination.mint == config.reward_mint,
        constraint = destination.owner == claimant.key(),
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// The reward mint itself: `transfer_checked` reads its decimals on chain.
    #[account(address = config.reward_mint)]
    pub reward_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Claim restitution as an old Buddy holder.
///
/// Tokens transfer immediately and are the claimant's to do anything with,
/// including sell. This is restitution for people who were already dumped on
/// once. Attaching a lockup to it would be the wrong instinct.
pub fn claim_old_holder(
    ctx: Context<ClaimOldHolder>,
    amount: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now >= config.claims_start,
        DistributorError::ClaimWindowNotOpen
    );
    require!(
        now < config.old_holder_deadline,
        DistributorError::ClaimWindowClosed
    );
    require!(amount > 0, DistributorError::ZeroAmount);

    let leaf = claim_leaf(&ctx.accounts.claimant.key(), amount);
    require!(
        verify_merkle_proof(&proof, config.old_holder_root, leaf),
        DistributorError::InvalidMerkleProof
    );

    config.old_holder_claimed = config
        .old_holder_claimed
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    require!(
        config.old_holder_claimed <= config.old_holder_allocation,
        DistributorError::InsufficientBucketBalance
    );

    let receipt = &mut ctx.accounts.receipt;
    receipt.claimant = ctx.accounts.claimant.key();
    receipt.amount = amount;
    receipt.claimed_at = now;
    receipt.bump = ctx.bumps.receipt;

    crate::instructions::staking::pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.reward_mint,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        &mut ctx.accounts.pool,
        amount,
    )?;

    msg!(
        "claim_old_holder: {} claimed {}",
        ctx.accounts.claimant.key(),
        amount
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Bucket 3: influencers. 72-hour window, claim opens a 30-day stream.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimInfluencer<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [INFLUENCER_CLAIM_SEED, claimant.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, ClaimReceipt>,

    #[account(
        init,
        payer = claimant,
        space = 8 + Stream::INIT_SPACE,
        seeds = [STREAM_SEED, claimant.key().as_ref()],
        bump
    )]
    pub stream: Account<'info, Stream>,

    pub system_program: Program<'info, System>,
}

/// Claim an influencer allocation inside the 72-hour window.
///
/// Claiming does not transfer anything; it opens a 30-day linear stream. The
/// point of the programme is people who show up and stay, so the allocation is
/// a commitment rather than exit liquidity.
pub fn claim_influencer(
    ctx: Context<ClaimInfluencer>,
    amount: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now >= config.claims_start,
        DistributorError::ClaimWindowNotOpen
    );
    require!(
        now < config.influencer_deadline,
        DistributorError::ClaimWindowClosed
    );
    require!(amount > 0, DistributorError::ZeroAmount);

    let leaf = claim_leaf(&ctx.accounts.claimant.key(), amount);
    require!(
        verify_merkle_proof(&proof, config.influencer_root, leaf),
        DistributorError::InvalidMerkleProof
    );

    config.influencer_claimed = config
        .influencer_claimed
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    require!(
        config.influencer_claimed <= config.influencer_allocation,
        DistributorError::InsufficientBucketBalance
    );

    let receipt = &mut ctx.accounts.receipt;
    receipt.claimant = ctx.accounts.claimant.key();
    receipt.amount = amount;
    receipt.claimed_at = now;
    receipt.bump = ctx.bumps.receipt;

    let stream = &mut ctx.accounts.stream;
    stream.beneficiary = ctx.accounts.claimant.key();
    stream.total = amount;
    stream.withdrawn = 0;
    stream.start = now;
    stream.cliff = now;
    stream.end = now
        .checked_add(INFLUENCER_STREAM_DURATION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    stream.bump = ctx.bumps.stream;

    msg!(
        "claim_influencer: {} opened a {}-token stream ending {}",
        stream.beneficiary,
        amount,
        stream.end
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Bucket 4a: the original 2014 Bitcoin signer. Open until 2030-12-31.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(destination_owner: Pubkey)]
pub struct ClaimOriginalSigner<'info> {
    /// Anyone may relay the transaction: the signature itself is the
    /// authorisation, and it is bound to `destination_owner`.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + Stream::INIT_SPACE,
        seeds = [STREAM_SEED, destination_owner.as_ref()],
        bump
    )]
    pub stream: Account<'info, Stream>,

    pub system_program: Program<'info, System>,
}

/// Prove control of the secp256k1 key that signed the original 2014 Bitcoin
/// message, and open the founder stream to a Solana address of the signer's
/// choosing.
///
/// The signed message embeds the destination address, so a signature is
/// worthless to anyone who intercepts it; it can only ever fund the address
/// the signer named. Verification uses the on-chain secp256k1 recovery syscall
/// against the uncompressed public key that the 2014 spend revealed, so no
/// off-chain attestation or trusted oracle is involved.
pub fn claim_original_signer(
    ctx: Context<ClaimOriginalSigner>,
    destination_owner: Pubkey,
    header: u8,
    signature: [u8; 64],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.assert_locked()?;

    require!(
        now <= ORIGINAL_SIGNER_DEADLINE,
        DistributorError::ClaimWindowClosed
    );
    require!(
        !config.original_signer_claimed,
        DistributorError::AlreadyClaimed
    );
    require!(
        !config.original_signer_swept,
        DistributorError::ClaimWindowClosed
    );

    let message = signer_claim_message(&destination_owner);
    verify_bitcoin_signature(
        &message,
        header,
        &signature,
        &config.original_signer_pubkey,
    )?;

    config.original_signer_claimed = true;

    let stream = &mut ctx.accounts.stream;
    stream.beneficiary = destination_owner;
    stream.total = config.original_signer_allocation;
    stream.withdrawn = 0;
    stream.start = now;
    stream.cliff = now;
    stream.end = now
        .checked_add(FOUNDER_STREAM_DURATION)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;
    stream.bump = ctx.bumps.stream;

    msg!(
        "claim_original_signer: verified; {} tokens streaming to {} until {}",
        stream.total,
        destination_owner,
        stream.end
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Stream withdrawals, shared by buckets 3 and 4.
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct StreamWithdraw<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [STREAM_SEED, beneficiary.key().as_ref()],
        bump = stream.bump,
        constraint = stream.beneficiary == beneficiary.key() @ DistributorError::Unauthorized,
    )]
    pub stream: Account<'info, Stream>,

    /// Needed only so the payout can decrement `reserved_token`.
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,

    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination.mint == config.reward_mint,
        constraint = destination.owner == beneficiary.key(),
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// The reward mint itself: `transfer_checked` reads its decimals on chain.
    #[account(address = config.reward_mint)]
    pub reward_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn stream_withdraw(ctx: Context<StreamWithdraw>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let stream = &mut ctx.accounts.stream;

    let amount = stream.withdrawable(now)?;
    require!(amount > 0, DistributorError::NothingToWithdraw);

    stream.withdrawn = stream
        .withdrawn
        .checked_add(amount)
        .ok_or_else(|| error!(DistributorError::MathOverflow))?;

    crate::instructions::staking::pay_token_from_vault(
        &ctx.accounts.vault,
        &ctx.accounts.destination,
        &ctx.accounts.reward_mint,
        &ctx.accounts.config,
        &ctx.accounts.token_program,
        &mut ctx.accounts.pool,
        amount,
    )?;

    msg!(
        "stream_withdraw: {} released {} ({} of {} total)",
        stream.beneficiary,
        amount,
        stream.withdrawn,
        stream.total
    );
    Ok(())
}
