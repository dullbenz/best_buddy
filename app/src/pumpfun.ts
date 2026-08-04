/**
 * pump.fun instruction builders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY PUMP.FUN-COUPLED CODE IN THE PROJECT, AND THAT IS DELIBERATE.
 *
 * The distributor program never references pump.fun. If it did, their next
 * interface change would permanently break an immutable contract that has to
 * keep working until 2030 — and they shipped two breaking fee changes in a
 * single quarter. Keeping the coupling here means a change on their side costs
 * us a frontend redeploy instead of a dead fee stream.
 *
 * Layouts are transcribed from the official IDL at
 * github.com/pump-fun/pump-public-docs (`idl/pump.json`, `idl/pump_amm.json`),
 * a copy of which is committed at `idl/pump.json` so anyone can check this file
 * against it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every instruction below is permissionless. pump.fun's own docs say so for all
 * of them: "It is permissionless: anyone can call it for a given creator." That
 * is what lets any visitor push fees to the community without a key, a bot, or
 * anyone's trust.
 */
import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
export const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);
export const PUMP_FEES_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
export const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Anchor's 8-byte discriminator: first 8 bytes of sha256("global:<name>"). */
function discriminator(name: string): Buffer {
  return Buffer.from(sha256(`global:${name}`)).subarray(0, 8);
}

const pda = (seeds: (Buffer | Uint8Array)[], programId: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const bondingCurvePda = (mint: PublicKey) =>
  pda([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID);

export const sharingConfigPda = (mint: PublicKey) =>
  pda([Buffer.from("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM_ID);

/** Where bonding-curve creator fees accrue, keyed by whoever the creator is. */
export const creatorVaultPda = (creator: PublicKey) =>
  pda([Buffer.from("creator-vault"), creator.toBuffer()], PUMP_PROGRAM_ID);

/** The AMM's equivalent, which owns the wSOL ATA fees land in post-graduation. */
export const ammCreatorVaultAuthorityPda = (creator: PublicKey) =>
  pda([Buffer.from("creator_vault"), creator.toBuffer()], PUMP_AMM_PROGRAM_ID);

export const eventAuthorityPda = (programId: PublicKey) =>
  pda([Buffer.from("__event_authority")], programId);

export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
  return pda(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

const meta = (
  pubkey: PublicKey,
  isWritable = false,
  isSigner = false
): AccountMeta => ({ pubkey, isWritable, isSigner });

/**
 * Sweep AMM-side creator fees back into the bonding-curve vault so the pump
 * program can distribute them. Only relevant once the coin has graduated.
 */
export function transferCreatorFeesToPumpIx(
  mint: PublicKey,
  sharingConfig: PublicKey
): TransactionInstruction {
  const vaultAuthority = ammCreatorVaultAuthorityPda(sharingConfig);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: [
      meta(mint),
      meta(sharingConfig),
      meta(vaultAuthority),
      meta(associatedTokenAddress(vaultAuthority, NATIVE_MINT), true),
      meta(creatorVaultPda(sharingConfig), true),
      meta(NATIVE_MINT),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
      meta(eventAuthorityPda(PUMP_AMM_PROGRAM_ID)),
      meta(PUMP_AMM_PROGRAM_ID),
    ],
    data: discriminator("transfer_creator_fees_to_pump_v2"),
  });
}

/**
 * Pay the bonding-curve creator vault out to every shareholder in the frozen
 * sharing config. Shareholders ride along as remaining accounts.
 */
export function distributeCreatorFeesIx(
  payer: PublicKey,
  mint: PublicKey,
  shareholders: PublicKey[],
  initializeAta = false
): TransactionInstruction {
  const sharingConfig = sharingConfigPda(mint);
  const creatorVault = creatorVaultPda(sharingConfig);

  const data = Buffer.concat([
    discriminator("distribute_creator_fees_v2"),
    Buffer.from([initializeAta ? 1 : 0]),
  ]);

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(mint),
      meta(bondingCurvePda(mint)),
      meta(sharingConfig),
      meta(creatorVault, true),
      meta(SystemProgram.programId),
      meta(eventAuthorityPda(PUMP_PROGRAM_ID)),
      meta(PUMP_PROGRAM_ID),
      meta(associatedTokenAddress(creatorVault, NATIVE_MINT), true),
      meta(NATIVE_MINT),
      meta(TOKEN_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID),
      // Shareholders are writable because they are being paid.
      ...shareholders.map((s) => meta(s, true)),
    ],
    data,
  });
}

export interface PendingFees {
  /** Lamports waiting in the bonding-curve creator vault. */
  bondingCurve: bigint;
  /** Wrapped SOL waiting in the AMM vault ATA, if the coin has graduated. */
  amm: bigint;
}

/**
 * Read what is currently claimable, so the UI can say "there is money to move"
 * rather than offering a button that might do nothing.
 */
export async function readPendingFees(
  connection: Connection,
  mint: PublicKey
): Promise<PendingFees> {
  const sharingConfig = sharingConfigPda(mint);
  const curveVault = creatorVaultPda(sharingConfig);
  const ammVaultAta = associatedTokenAddress(
    ammCreatorVaultAuthorityPda(sharingConfig),
    NATIVE_MINT
  );

  const [curveInfo, ammInfo] = await connection.getMultipleAccountsInfo([
    curveVault,
    ammVaultAta,
  ]);

  // The vault keeps a rent-exempt floor that is never distributable.
  const floor = BigInt(
    await connection.getMinimumBalanceForRentExemption(curveInfo?.data.length ?? 0)
  );
  const bonding = curveInfo
    ? BigInt(curveInfo.lamports) > floor
      ? BigInt(curveInfo.lamports) - floor
      : 0n
    : 0n;

  // SPL token accounts hold the amount at offset 64.
  const amm =
    ammInfo && ammInfo.data.length >= 72
      ? ammInfo.data.readBigUInt64LE(64)
      : 0n;

  return { bondingCurve: bonding, amm };
}

/** Read the frozen shareholder list, for the Verify page. */
export interface SharingConfigView {
  exists: boolean;
  adminRevoked: boolean;
  shareholders: { address: string; shareBps: number }[];
}

export async function readSharingConfig(
  connection: Connection,
  mint: PublicKey
): Promise<SharingConfigView> {
  const info = await connection.getAccountInfo(sharingConfigPda(mint));
  if (!info) return { exists: false, adminRevoked: false, shareholders: [] };

  // Layout after the 8-byte discriminator, transcribed from pump_fees.json:
  //   version u8 | admin Pubkey | admin_revoked bool | mint Pubkey
  //   | shareholder_count u8 | [ (Pubkey, u16) ; count ]
  const d = info.data;
  let o = 8;
  o += 1; // version
  o += 32; // admin
  const adminRevoked = d[o] === 1;
  o += 1;
  o += 32; // mint
  const count = d[o];
  o += 1;

  const shareholders: { address: string; shareBps: number }[] = [];
  for (let i = 0; i < count && o + 34 <= d.length; i++) {
    shareholders.push({
      address: new PublicKey(d.subarray(o, o + 32)).toBase58(),
      shareBps: d.readUInt16LE(o + 32),
    });
    o += 34;
  }

  return { exists: true, adminRevoked, shareholders };
}
