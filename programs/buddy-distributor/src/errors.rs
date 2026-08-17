use anchor_lang::prelude::*;

#[error_code]
pub enum DistributorError {
    #[msg("Config is already locked and cannot be modified")]
    ConfigLocked,
    #[msg("Config must be locked before this action")]
    ConfigNotLocked,
    #[msg("Only the configured authority may perform this action")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid staking tier")]
    InvalidTier,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Position is still locked")]
    StillLocked,
    #[msg("No unstake has been requested for this position")]
    NoUnstakeRequested,
    #[msg("Unstake cooldown has not elapsed")]
    CooldownActive,
    #[msg("Emergency exit is only available to locked positions")]
    NotLocked,
    #[msg("Boost escrow is only withdrawable at lock maturity")]
    EscrowNotMatured,
    #[msg("Invalid Merkle proof for this claim")]
    InvalidMerkleProof,
    #[msg("This allocation has already been claimed")]
    AlreadyClaimed,
    #[msg("The claim window for this bucket has closed")]
    ClaimWindowClosed,
    #[msg("The claim window for this bucket has not opened yet")]
    ClaimWindowNotOpen,
    #[msg("The claim window is still open; cannot sweep yet")]
    SweepTooEarly,
    #[msg("Signature recovery failed")]
    SignatureRecoveryFailed,
    #[msg("Recovered public key does not match the original signer")]
    SignerMismatch,
    #[msg("Invalid signature recovery id")]
    InvalidRecoveryId,
    #[msg("Nothing is currently withdrawable from this stream")]
    NothingToWithdraw,
    #[msg("Stream has already been initialized for this beneficiary")]
    StreamAlreadyExists,
    #[msg("Bucket has insufficient unclaimed balance for this operation")]
    InsufficientBucketBalance,
    #[msg("No stakers are present; rewards cannot be distributed")]
    NoStakers,
    #[msg("Message is too long to encode with a single-byte varint")]
    MessageTooLong,
    #[msg("Account is not a wrapped-SOL token account owned by the SOL vault")]
    InvalidWsolAccount,

    #[msg("Dev cliff must be between zero and the stream duration")]
    InvalidCliff,

    #[msg("Lockup already demoted to base weight")]
    AlreadyDemoted,
    #[msg("Lockup index does not match the owner's counter")]
    InvalidLockupIndex,
    #[msg("Source is not a foreign-token account owned by a program vault")]
    InvalidRecoverySource,
}
