/**
 * Create the team's vesting stream.
 *
 * Permissionless on purpose: anyone can run this, and it can only ever produce
 * the terms fixed at initialization. Run it immediately after `lock_config` so
 * it is visible from the first block that no team wallet holds anything.
 *
 * The beneficiary is whatever `DEV_WALLET` was at init — for launch, the
 * team's Squads multisig vault. Withdrawals therefore go through the Squads
 * proposal flow, not through the site.
 *
 *   RPC_URL=<rpc> KEYPAIR=<any-funded-keypair.json> \
 *     npx ts-node scripts/create-dev-stream.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`missing required env var ${name}`);
  return value;
}

async function main() {
  const connection = new Connection(env("RPC_URL"), "confirmed");
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(env("KEYPAIR"), "utf8")))
  );
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = require("../target/idl/buddy_distributor.json");
  const program = new Program(idl, provider) as Program<any>;

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const state = await (program.account as any).config.fetch(config);

  if (state.devStreamCreated) {
    console.log("the team stream already exists, nothing to do");
    return;
  }

  const [stream] = PublicKey.findProgramAddressSync(
    [Buffer.from("stream"), new PublicKey(state.devWallet).toBuffer()],
    program.programId
  );
  // Read, not chosen. The cliff was fixed at initialize and frozen by
  // lock_config, which is what makes it safe for this script to be runnable
  // by anyone: whoever calls it gets the same terms.
  const cliffDays = Number(state.devCliffSeconds) / 86_400;

  const beneficiary = new PublicKey(state.devWallet);
  console.log(`beneficiary (team multisig vault): ${beneficiary.toBase58()}`);
  console.log(
    PublicKey.isOnCurve(beneficiary.toBytes())
      ? "  ⚠ on-curve: an ordinary wallet, not a Squads vault (expected only in rehearsals)"
      : "  off-curve: program-derived, consistent with a Squads vault"
  );
  console.log(`allocation:  ${state.devAllocation.toString()}`);
  console.log(`cliff:       ${cliffDays} days (fixed at init, not by this call)`);
  console.log(`stream PDA:  ${stream.toBase58()}`);

  const sig = await program.methods
    .createDevStream()
    .accountsPartial({
      payer: payer.publicKey,
      config,
      stream,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`\ncreated: ${sig}`);

  const created = await (program.account as any).stream.fetch(stream);
  console.log(`start: ${new Date(Number(created.start) * 1000).toISOString()}`);
  console.log(`cliff: ${new Date(Number(created.cliff) * 1000).toISOString()}`);
  console.log(`end:   ${new Date(Number(created.end) * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
