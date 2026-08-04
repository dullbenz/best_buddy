import { PublicKey } from "@solana/web3.js";

/**
 * Everything the UI needs to talk to the deployed distributor. All of it is
 * public information by design — the dashboard is meant to be verifiable by
 * anyone, including people who never open this app.
 */
export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ??
    "GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11"
);

/** Decimals of the new token; pump.fun mints use 6. */
export const TOKEN_DECIMALS = 6;

/** Published proof files, served as static assets next to the app. */
export const OLD_HOLDER_PROOFS_URL = "/proofs/old-holders.json";
export const INFLUENCER_PROOFS_URL = "/proofs/influencers.json";

/** 2030-12-31T23:59:59Z — the original signer's deadline. */
export const ORIGINAL_SIGNER_DEADLINE = 1_924_991_999;

export const SEEDS = {
  config: Buffer.from("config"),
  pool: Buffer.from("pool"),
  vault: Buffer.from("vault"),
  solVault: Buffer.from("sol_vault"),
  stake: Buffer.from("stake"),
  oldClaim: Buffer.from("old_claim"),
  influencerClaim: Buffer.from("inf_claim"),
  stream: Buffer.from("stream"),
};

export const TIERS = [
  { id: 0, name: "Flexible", multiplier: "1.0x", lock: "no lock, 3-day cooldown" },
  { id: 1, name: "1 month", multiplier: "1.5x", lock: "30 days" },
  { id: 2, name: "3 months", multiplier: "2.0x", lock: "90 days" },
  { id: 3, name: "12 months", multiplier: "3.0x", lock: "365 days" },
];

export function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
