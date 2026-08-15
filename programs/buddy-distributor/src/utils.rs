use crate::constants::*;
use crate::errors::DistributorError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash as sha256;
use anchor_lang::solana_program::keccak;
use anchor_lang::solana_program::secp256k1_recover::secp256k1_recover;

/// Verify a sorted-pair Merkle proof.
///
/// Sorted pairs mean the tree is built by hashing `min(a,b) || max(a,b)` at
/// every level, so a proof carries only sibling hashes and no direction bits.
/// This matches the OpenZeppelin/Uniswap convention and the `merkle.ts` tooling
/// in this repo, which lets anyone regenerate the tree from public chain data
/// and check it against the root committed here.
pub fn verify_merkle_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: [u8; 32]) -> bool {
    let mut computed = leaf;
    for sibling in proof.iter() {
        computed = if computed <= *sibling {
            keccak::hashv(&[&computed, sibling]).0
        } else {
            keccak::hashv(&[sibling, &computed]).0
        };
    }
    computed == root
}

/// Build the leaf for a claim. Double-hashed to make second-preimage attacks
/// against internal nodes infeasible: a 64-byte internal node can never be
/// mistaken for a leaf preimage.
pub fn claim_leaf(claimant: &Pubkey, amount: u64) -> [u8; 32] {
    let inner = keccak::hashv(&[claimant.as_ref(), &amount.to_le_bytes()]).0;
    keccak::hashv(&[&inner]).0
}

/// Assemble the exact byte string a Bitcoin wallet signs for a text message:
///
/// ```text
/// 0x18 "Bitcoin Signed Message:\n" varint(len(msg)) msg
/// ```
///
/// then double-SHA256 it. Reproducing this on-chain is what lets the original
/// signer prove ownership of the 2014 key with nothing more exotic than the
/// `signmessage` command any Bitcoin wallet already has.
pub fn bitcoin_message_hash(message: &[u8]) -> Result<[u8; 32]> {
    // A single-byte varint covers lengths up to 252, which is far more than the
    // claim message ever needs. Reject anything longer rather than silently
    // encoding it wrong.
    require!(message.len() < 253, DistributorError::MessageTooLong);

    let mut payload = Vec::with_capacity(BITCOIN_MSG_PREFIX.len() + 1 + message.len());
    payload.extend_from_slice(BITCOIN_MSG_PREFIX);
    payload.push(message.len() as u8);
    payload.extend_from_slice(message);

    let first = sha256(&payload);
    let second = sha256(first.as_ref());
    Ok(second.to_bytes())
}

/// The exact message the original signer must sign, binding the signature to
/// one destination Solana address. Without this binding, a signature harvested
/// from anywhere else could be replayed by whoever saw it first.
pub fn signer_claim_message(destination: &Pubkey) -> Vec<u8> {
    format!("{}{}", SIGNER_CLAIM_MESSAGE_PREFIX, destination).into_bytes()
}

/// Recover the secp256k1 public key that produced a Bitcoin-style message
/// signature and confirm it matches `expected` (64-byte X||Y form).
///
/// `header` is the first byte of the 65-byte base64 signature Bitcoin wallets
/// emit: `27 + recid` for an uncompressed key, `31 + recid` for a compressed
/// one. Both forms are accepted; the recovered key is identical either way,
/// since compression only affects how the key is serialised, not its value.
pub fn verify_bitcoin_signature(
    message: &[u8],
    header: u8,
    signature: &[u8; 64],
    expected: &[u8; 64],
) -> Result<()> {
    let recovery_id = match header {
        27..=30 => header - 27,
        31..=34 => header - 31,
        _ => return Err(error!(DistributorError::InvalidRecoveryId)),
    };

    let digest = bitcoin_message_hash(message)?;

    let recovered = secp256k1_recover(&digest, recovery_id, signature)
        .map_err(|_| error!(DistributorError::SignatureRecoveryFailed))?;

    require!(
        recovered.to_bytes() == *expected,
        DistributorError::SignerMismatch
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merkle_single_leaf_is_root() {
        let leaf = [7u8; 32];
        assert!(verify_merkle_proof(&[], leaf, leaf));
    }

    #[test]
    fn merkle_rejects_wrong_root() {
        let leaf = [7u8; 32];
        assert!(!verify_merkle_proof(&[], [8u8; 32], leaf));
    }

    #[test]
    fn merkle_two_leaf_proof_is_order_independent() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let root = keccak::hashv(&[&a, &b]).0; // a < b, so a comes first
        assert!(verify_merkle_proof(&[b], root, a));
        assert!(verify_merkle_proof(&[a], root, b));
    }

    #[test]
    fn bitcoin_hash_matches_known_vectors() {
        // Independently reproducible: double-SHA256 of the standard signed-message
        // envelope. Any drift in the prefix or varint encoding breaks these.
        assert_eq!(
            hex_lower(&bitcoin_message_hash(b"hello").unwrap()),
            "cf0447ec85f0ce7150a257db32ebfcb7523dae17c36dbd1be598779fec0484f4"
        );
        assert_eq!(
            hex_lower(&bitcoin_message_hash(b"").unwrap()),
            "80e795d4a4caadd7047af389d9f7f220562feb6196032e2131e10563352c4bcc"
        );
    }

    #[test]
    fn bitcoin_hash_rejects_overlong_message() {
        assert!(bitcoin_message_hash(&[b'a'; 253]).is_err());
    }

    #[test]
    fn recovery_id_parsing_accepts_both_key_forms() {
        // Header bytes 27..30 (uncompressed) and 31..34 (compressed) must map to
        // recovery ids 0..3. Anything else is rejected outright.
        let sig = [0u8; 64];
        let expected = [0u8; 64];
        for header in [26u8, 35u8, 0u8, 255u8] {
            let err = verify_bitcoin_signature(b"x", header, &sig, &expected).unwrap_err();
            assert!(format!("{:?}", err).contains("InvalidRecoveryId"));
        }
    }

    fn hex_lower(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
