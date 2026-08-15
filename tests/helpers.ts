import * as anchor from "@coral-xyz/anchor";
// Destructured from the namespace rather than imported by name.
// @coral-xyz/anchor is CommonJS, and since Node 22.18 enabled require(esm) by
// default, `import { BN } from "@coral-xyz/anchor"` fails at runtime with
// "Named export 'BN' not found" on newer Node while still working on older
// ones. The namespace form behaves the same under both.
const { BN } = anchor;
type Program<T extends anchor.Idl> = anchor.Program<T>;
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  ACCOUNT_SIZE,
} from "@solana/spl-token";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { startAnchor, ProgramTestContext, Clock } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

export const CONFIG_SEED = Buffer.from("config");
export const VAULT_SEED = Buffer.from("vault");
export const SOL_VAULT_SEED = Buffer.from("sol_vault");
export const POOL_SEED = Buffer.from("pool");
export const STAKE_SEED = Buffer.from("stake");
export const OLD_CLAIM_SEED = Buffer.from("old_claim");
export const INFLUENCER_CLAIM_SEED = Buffer.from("inf_claim");
export const STREAM_SEED = Buffer.from("stream");

export const DAY = 86_400;
export const ORIGINAL_SIGNER_DEADLINE = 1_924_991_999; // 2030-12-31T23:59:59Z

export const Tier = {
  Flexible: 0,
  OneMonth: 1,
  ThreeMonth: 2,
  TwelveMonth: 3,
} as const;

export interface Env {
  context: ProgramTestContext;
  provider: BankrunProvider;
  program: Program<any>;
  programId: PublicKey;
  payer: Keypair;
  authority: Keypair;
  mint: PublicKey;
  configPda: PublicKey;
  poolPda: PublicKey;
  vaultPda: PublicKey;
  solVaultPda: PublicKey;
}

export function pda(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function stakePda(owner: PublicKey, programId: PublicKey): PublicKey {
  return pda([STAKE_SEED, owner.toBuffer()], programId);
}

export function communityStreamPda(kind: number, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("community_stream"), Buffer.from([kind])],
    programId,
  )[0];
}

export function streamPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return pda([STREAM_SEED, owner.toBuffer()], programId);
}

/**
 * Advance the bankrun clock to an absolute unix timestamp.
 *
 * Also advances the bank a slot, which produces a fresh blockhash. Without
 * that, replaying an otherwise-identical transaction (the common "assert it
 * fails, warp, assert it now succeeds" shape) is rejected as a duplicate
 * rather than actually re-executing.
 */
export async function warpTo(
  context: ProgramTestContext,
  unixTimestamp: number,
) {
  const current = await context.banksClient.getClock();
  const nextSlot = current.slot + 1n;
  context.warpToSlot(nextSlot);
  context.setClock(
    new Clock(
      nextSlot,
      current.epochStartTimestamp,
      current.epoch,
      current.leaderScheduleEpoch,
      BigInt(unixTimestamp),
    ),
  );
}

/**
 * Advance one slot without moving the clock.
 *
 * Needed before re-sending a transaction that is byte-identical to a previous
 * one; otherwise the bank rejects it as already-processed and the program is
 * never entered.
 */
export async function advanceSlot(context: ProgramTestContext) {
  const current = await context.banksClient.getClock();
  const nextSlot = current.slot + 1n;
  context.warpToSlot(nextSlot);
  context.setClock(
    new Clock(
      nextSlot,
      current.epochStartTimestamp,
      current.epoch,
      current.leaderScheduleEpoch,
      current.unixTimestamp,
    ),
  );
}

export async function nowTs(context: ProgramTestContext): Promise<number> {
  const clock = await context.banksClient.getClock();
  return Number(clock.unixTimestamp);
}

export async function warpBy(context: ProgramTestContext, seconds: number) {
  await warpTo(context, (await nowTs(context)) + seconds);
}

export async function fundSol(
  env: Env,
  to: PublicKey,
  lamports: number,
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: env.payer.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  await env.provider.sendAndConfirm(tx, [env.payer]);
}

export async function createMint(env: Env, decimals = 6): Promise<PublicKey> {
  const mint = Keypair.generate();
  const rent = await env.context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      decimals,
      env.payer.publicKey,
      null,
    ),
  );
  await env.provider.sendAndConfirm(tx, [env.payer, mint]);
  return mint.publicKey;
}

/**
 * Plain (non-associated) token account, so tests stay independent of the ATA
 * program and can create several accounts per owner when needed.
 */
export async function createTokenAccount(
  env: Env,
  owner: PublicKey,
): Promise<PublicKey> {
  const account = Keypair.generate();
  const rent = await env.context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE)));

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: account.publicKey,
      space: ACCOUNT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(account.publicKey, env.mint, owner),
  );
  await env.provider.sendAndConfirm(tx, [env.payer, account]);
  return account.publicKey;
}

export async function mintTo(
  env: Env,
  destination: PublicKey,
  amount: bigint | number,
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(
      env.mint,
      destination,
      env.payer.publicKey,
      BigInt(amount),
    ),
  );
  await env.provider.sendAndConfirm(tx, [env.payer]);
}

export const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

/**
 * Inject a wrapped-SOL token account owned by `owner`.
 *
 * Built by hand rather than by wrapping SOL through the token program, because
 * bankrun's genesis has no native-mint account to wrap against. The layout is
 * the standard 165-byte SPL token account; what makes it *wrapped* SOL is the
 * `is_native` option being set, which is the flag `close_account` looks at when
 * deciding to release the balance as lamports.
 */
export async function createWrappedSolAccount(
  env: Env,
  owner: PublicKey,
  wrappedAmount: bigint,
): Promise<PublicKey> {
  const account = Keypair.generate();
  const rent = await env.context.banksClient.getRent();
  const rentExempt = rent.minimumBalance(BigInt(ACCOUNT_SIZE));

  const data = Buffer.alloc(ACCOUNT_SIZE);
  NATIVE_MINT.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(wrappedAmount, 64);
  data.writeUInt8(1, 108); // AccountState::Initialized
  data.writeUInt32LE(1, 109); // is_native = Some(...)
  data.writeBigUInt64LE(rentExempt, 113); // the reserve it must keep back

  env.context.setAccount(account.publicKey, {
    lamports: Number(rentExempt + wrappedAmount),
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });

  return account.publicKey;
}

/** Drop lamports straight onto an account, bypassing every program instruction. */
export async function airdropTo(
  env: Env,
  target: PublicKey,
  lamports: number,
): Promise<void> {
  const existing = await env.context.banksClient.getAccount(target);
  if (!existing) throw new Error(`${target.toBase58()} does not exist`);
  env.context.setAccount(target, {
    lamports: existing.lamports + lamports,
    data: Buffer.from(existing.data),
    owner: existing.owner,
    executable: existing.executable,
  });
}

export async function tokenBalance(
  env: Env,
  account: PublicKey,
): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(account);
  if (!info) throw new Error(`token account ${account.toBase58()} not found`);
  return Buffer.from(info.data).readBigUInt64LE(64);
}

export async function solBalance(
  env: Env,
  account: PublicKey,
): Promise<bigint> {
  const info = await env.context.banksClient.getAccount(account);
  return info ? BigInt(info.lamports) : 0n;
}

/** Spin up a fresh bankrun environment with the program loaded. */
export async function setupEnv(): Promise<Env> {
  const context = await startAnchor(".", [], []);
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);

  const idl = require("../target/idl/buddy_distributor.json");
  const program = new anchor.Program(idl, provider) as Program<any>;
  const programId = program.programId;

  const payer = context.payer;
  const authority = Keypair.generate();

  const env: Env = {
    context,
    provider,
    program,
    programId,
    payer,
    authority,
    mint: PublicKey.default,
    configPda: pda([CONFIG_SEED], programId),
    poolPda: pda([POOL_SEED], programId),
    vaultPda: pda([VAULT_SEED], programId),
    solVaultPda: pda([SOL_VAULT_SEED], programId),
  };

  await fundSol(env, authority.publicKey, 10 * LAMPORTS_PER_SOL);
  env.mint = await createMint(env);
  return env;
}

// ---------------------------------------------------------------------------
// Bitcoin message signing: mirrors utils.rs so the on-chain verifier is
// exercised against signatures produced exactly the way a real wallet would.
// ---------------------------------------------------------------------------

export function bitcoinMessageHash(message: string): Uint8Array {
  const msg = Buffer.from(message, "utf8");
  if (msg.length >= 253)
    throw new Error("message too long for a 1-byte varint");
  const payload = Buffer.concat([
    Buffer.from([0x18]),
    Buffer.from("Bitcoin Signed Message:\n", "utf8"),
    Buffer.from([msg.length]),
    msg,
  ]);
  return sha256(sha256(payload));
}

export const SIGNER_CLAIM_MESSAGE_PREFIX =
  "I am the original Signer. Claim to Solana address: ";

export function signerClaimMessage(destination: PublicKey): string {
  return `${SIGNER_CLAIM_MESSAGE_PREFIX}${destination.toBase58()}`;
}

export interface BitcoinKey {
  privateKey: Uint8Array;
  /** Uncompressed X||Y, the 0x04 prefix stripped (the form the program stores). */
  publicKeyXY: Uint8Array;
}

export function makeBitcoinKey(seed?: Uint8Array): BitcoinKey {
  const privateKey = seed ?? secp256k1.utils.randomPrivateKey();
  const uncompressed = secp256k1.getPublicKey(privateKey, false); // 65 bytes, 0x04 prefixed
  return { privateKey, publicKeyXY: uncompressed.slice(1) };
}

/** Produce the (header, 64-byte signature) pair the program expects. */
export function signBitcoinMessage(
  key: BitcoinKey,
  message: string,
  compressed = false,
): { header: number; signature: Buffer } {
  const digest = bitcoinMessageHash(message);
  const sig = secp256k1.sign(digest, key.privateKey);
  const header = (compressed ? 31 : 27) + sig.recovery;
  return { header, signature: Buffer.from(sig.toCompactRawBytes()) };
}

export function toBn(value: bigint | number): anchor.BN {
  return new BN(value.toString());
}

/** Assert a transaction fails, and that the message mentions `needle`. */
export async function expectFailure(
  promise: Promise<any>,
  needle: string,
): Promise<void> {
  try {
    await promise;
  } catch (e: any) {
    const text = JSON.stringify(e?.logs ?? []) + (e?.message ?? "") + String(e);
    if (!text.includes(needle)) {
      throw new Error(
        `expected failure containing "${needle}" but got: ${text.slice(0, 800)}`,
      );
    }
    return;
  }
  throw new Error(`expected failure containing "${needle}" but call succeeded`);
}
