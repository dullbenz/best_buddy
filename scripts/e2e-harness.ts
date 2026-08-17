/**
 * Shared harness for the devnet end-to-end campaign (scripts/e2e-campaign.ts).
 *
 * Everything here is about running real transactions against a real (dev)net
 * and recording, per scenario, exactly what happened — so the campaign report
 * is generated from evidence, not from a claim. It deliberately does not touch
 * bankrun: the whole point of the campaign is that it runs on a live chain the
 * user (and a security reviewer) can independently inspect on Solscan.
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  createInitializeAccount3Instruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

export const DECIMALS = 6;
export const UNIT = 10n ** BigInt(DECIMALS);

/** A recorded scenario outcome — one row of the campaign report. */
export interface Row {
  id: string;
  /** What the site/docs claim this proves. */
  claim: string;
  /** pass | fail | note (documented behavior, not a pass/fail). */
  status: "pass" | "fail" | "note";
  /** Human-readable result. */
  detail: string;
  /** A devnet tx signature (success paths) if there is a single defining one. */
  signature?: string;
  /** The Anchor error code observed (rejection paths), e.g. "ConfigLocked". */
  errorCode?: string;
}

export class Reporter {
  rows: Row[] = [];
  constructor(public run: string, public programId: string) {}

  record(row: Row) {
    this.rows.push(row);
    const mark = row.status === "pass" ? "✓" : row.status === "note" ? "•" : "✗";
    const sig = row.signature ? `  ${row.signature.slice(0, 12)}…` : "";
    const err = row.errorCode ? `  [${row.errorCode}]` : "";
    console.log(`   ${mark} ${row.id}: ${row.detail}${err}${sig}`);
    if (row.status === "fail") {
      console.log(`     ^^^ FAILED — expected: ${row.claim}`);
    }
  }

  pass(id: string, claim: string, detail: string, signature?: string) {
    this.record({ id, claim, status: "pass", detail, signature });
  }
  note(id: string, claim: string, detail: string, signature?: string) {
    this.record({ id, claim, status: "note", detail, signature });
  }
  fail(id: string, claim: string, detail: string) {
    this.record({ id, claim, status: "fail", detail });
  }

  save(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    const path = `${dir}/run-${this.run}.json`;
    fs.writeFileSync(
      path,
      JSON.stringify(
        { run: this.run, programId: this.programId, rows: this.rows },
        null,
        2
      )
    );
    return path;
  }

  summary() {
    const p = this.rows.filter((r) => r.status === "pass").length;
    const n = this.rows.filter((r) => r.status === "note").length;
    const f = this.rows.filter((r) => r.status === "fail").length;
    return { pass: p, note: n, fail: f, total: this.rows.length };
  }
}

/**
 * Map an Anchor/Solana error to the program's error-code name, so a rejection
 * scenario can assert the *reason*, not merely that something failed.
 */
export function errorName(e: any): string {
  const anchorName = e?.error?.errorCode?.code;
  if (anchorName) return anchorName;
  const text = JSON.stringify(e?.logs ?? []) + (e?.message ?? "") + String(e);
  // Anchor logs "Error Code: X." for program errors.
  const m = text.match(/Error Code: (\w+)/);
  if (m) return m[1];
  if (/already in use/i.test(text)) return "AccountInUse";
  if (/custom program error: 0x0\b/.test(text)) return "AccountInUse";
  if (/ConstraintRaw|constraint was violated/i.test(text)) return "ConstraintRaw";
  if (/ConstraintSeeds/i.test(text)) return "ConstraintSeeds";
  return "Unknown";
}

/**
 * Run a call expected to FAIL, and assert the error code matches. Returns the
 * observed code so the caller can record it.
 */
export async function expectError(
  promise: Promise<any>,
  expected: string | string[]
): Promise<{ ok: boolean; observed: string }> {
  const wanted = Array.isArray(expected) ? expected : [expected];
  try {
    await promise;
    return { ok: false, observed: "SUCCEEDED (expected failure)" };
  } catch (e: any) {
    const observed = errorName(e);
    return { ok: wanted.includes(observed), observed };
  }
}

export function loadKeypair(pathish: string): Keypair {
  const resolved = pathish.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(resolved, "utf8")))
  );
}

/** A live-chain test context: connection, funded payer, anchor program. */
export interface Ctx {
  connection: Connection;
  payer: Keypair;
  provider: AnchorProvider;
  program: Program<any>;
  account: any;
  programId: PublicKey;
  explorer: (sig: string) => string;
}

export async function makeCtx(): Promise<Ctx> {
  const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair(process.env.KEYPAIR ?? "~/.config/solana/id.json");
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = require("../target/idl/buddy_distributor.json");
  const program = new Program(idl, provider) as Program<any>;
  const cluster = /devnet/.test(rpc) ? "devnet" : /testnet/.test(rpc) ? "testnet" : "mainnet";
  return {
    connection,
    payer,
    provider,
    program,
    account: program.account as any,
    programId: program.programId,
    explorer: (sig: string) =>
      `https://solscan.io/tx/${sig}${cluster === "mainnet" ? "" : `?cluster=${cluster}`}`,
  };
}

export function pdaFor(programId: PublicKey) {
  return (seed: string, extra?: Buffer) =>
    PublicKey.findProgramAddressSync(
      extra ? [Buffer.from(seed), extra] : [Buffer.from(seed)],
      programId
    )[0];
}

/** Fund a set of throwaway wallets so they can pay their own fees. */
export async function fundWallets(
  ctx: Ctx,
  wallets: PublicKey[],
  sol = 0.03
): Promise<void> {
  // Batch into a few transactions rather than one per wallet.
  for (let i = 0; i < wallets.length; i += 8) {
    const tx = new Transaction();
    for (const w of wallets.slice(i, i + 8)) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: ctx.payer.publicKey,
          toPubkey: w,
          lamports: Math.round(sol * LAMPORTS_PER_SOL),
        })
      );
    }
    await ctx.provider.sendAndConfirm(tx);
  }
}

export async function createMint(ctx: Ctx): Promise<Keypair> {
  const mint = Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, DECIMALS, ctx.payer.publicKey, null)
  );
  await ctx.provider.sendAndConfirm(tx, [mint]);
  return mint;
}

/** Plain (non-associated) token account owned by `owner`. */
export async function createTokenAccount(
  ctx: Ctx,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const account = Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: account.publicKey,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(account.publicKey, mint, owner)
  );
  await ctx.provider.sendAndConfirm(tx, [account]);
  return account.publicKey;
}

/** Idempotent ATA creation; returns the address. */
export async function ensureAta(
  ctx: Ctx,
  mint: PublicKey,
  owner: PublicKey,
  offCurve = false
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, offCurve);
  const info = await ctx.connection.getAccountInfo(ata);
  if (!info) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(ctx.payer.publicKey, ata, owner, mint)
    );
    await ctx.provider.sendAndConfirm(tx);
  }
  return ata;
}

export async function mintTo(
  ctx: Ctx,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(mint, destination, ctx.payer.publicKey, amount)
  );
  await ctx.provider.sendAndConfirm(tx);
}

export async function tokenBalance(ctx: Ctx, account: PublicKey): Promise<bigint> {
  const b = await ctx.connection.getTokenAccountBalance(account);
  return BigInt(b.value.amount);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until `predicate` is true or `timeoutMs` elapses. */
export async function waitUntil(
  label: string,
  predicate: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    const left = Math.round((deadline - Date.now()) / 1000);
    process.stdout.write(`\r     waiting: ${label} (${left}s left)   `);
    await sleep(intervalMs);
  }
  process.stdout.write("\n");
  throw new Error(`timed out waiting for: ${label}`);
}

/** Wall-clock sleep with a live countdown, for time-gated phases. */
export async function waitSeconds(label: string, seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / 1000);
    process.stdout.write(`\r     ${label}: ${left}s   `);
    await sleep(Math.min(2000, end - Date.now()));
  }
  process.stdout.write("\n");
}

export { BN, Keypair, PublicKey, SystemProgram, Transaction, TOKEN_PROGRAM_ID, LAMPORTS_PER_SOL, getAssociatedTokenAddressSync };
