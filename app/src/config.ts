import { PublicKey } from "@solana/web3.js";
import influencerTerms from "./generated/influencer-terms.txt?raw";

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

/**
 * Which chain this build talks to, inferred from the RPC URL rather than set
 * separately — one source of truth means a devnet build cannot accidentally
 * emit mainnet explorer links, which would send people to look at an address
 * that does not exist there and conclude the whole thing is fake.
 */
export const CLUSTER: "mainnet" | "devnet" | "testnet" | "localnet" =
  /devnet/.test(RPC_URL)
    ? "devnet"
    : /testnet/.test(RPC_URL)
    ? "testnet"
    : /localhost|127\.0\.0\.1/.test(RPC_URL)
    ? "localnet"
    : "mainnet";

export const IS_MAINNET = CLUSTER === "mainnet";

/** Solscan needs an explicit cluster for anything that is not mainnet. */
const clusterQuery = IS_MAINNET ? "" : `?cluster=${CLUSTER}`;

export const solscanAccount = (address: string) =>
  `https://solscan.io/account/${address}${clusterQuery}`;
export const solscanTx = (sig: string) =>
  `https://solscan.io/tx/${sig}${clusterQuery}`;
export const solscanToken = (mint: string) =>
  `https://solscan.io/token/${mint}${clusterQuery}`;

/**
 * The abandoned token this project exists because of.
 *
 * Always mainnet, whatever cluster this build points at — it is a real thing
 * that really happened, and the links have to lead to the actual history.
 */
export const LEGACY_TOKEN = {
  mint: "7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump",
  links: [
    {
      label: "Solscan",
      note: "holders, transfers, the creator's sells",
      url: "https://solscan.io/token/7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump",
    },
    {
      label: "pump.fun",
      note: "the original launch page",
      url: "https://pump.fun/coin/7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump",
    },
    {
      label: "DexScreener",
      note: "the price chart, including the collapse",
      url: "https://dexscreener.com/solana/7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump",
    },
  ],
};

/**
 * The two tokens, as the handover strip presents them.
 *
 * Legacy is historical and settled — its mint, name and links are facts that
 * will never change. New is provisional until launch: the mint does not exist
 * yet, so its links are nulls rather than dead URLs, and the UI renders them as
 * pending instead of offering something to click.
 *
 * Artwork lives in two folders under `public/tokens/` precisely so the new
 * mark can be replaced before deploy without touching the legacy one.
 */
const linkOrder = ["pump.fun", "DexScreener", "Solscan"];

export const LEGACY_TOKEN_INFO = {
  name: "The First Crypto Dog",
  ticker: "$Buddy",
  image: "/tokens/legacy/logo.png",
  mint: LEGACY_TOKEN.mint,
  // Same order as the new token's, so the two cards line up column for column
  // and the eye can compare them rather than re-read each one.
  links: linkOrder.map((label) => LEGACY_TOKEN.links.find((l) => l.label === label)!),
};

export const NEW_TOKEN_INFO = {
  name: "Best Buddy",
  ticker: "$BUDDY",
  image: "/tokens/new/logo.png",
  /** Set on launch day. Until then every link below stays null. */
  mint: null as string | null,
  links: [
    { label: "pump.fun", note: "the launch page", url: null as string | null },
    { label: "DexScreener", note: "the price chart", url: null as string | null },
    { label: "Solscan", note: "holders and transfers", url: null as string | null },
  ],
};

/**
 * Where the community actually talks. The X group is live now; the market
 * links only appear once there is a token behind them, because a dead link on
 * a memecoin site reads as abandonment — the exact thing this project exists
 * to answer.
 */
export const SOCIAL_LINKS = [
  {
    id: "x",
    label: "Community",
    title: "Join the community group chat on X",
    url: "https://x.com/i/chat/group_join/g2087233994584654015/39GXoFqY6d",
  },
  {
    id: "pumpfun",
    label: "pump.fun",
    title: "Trade on pump.fun — live at launch",
    url: null as string | null,
  },
  {
    id: "dexscreener",
    label: "DexScreener",
    title: "Price chart — live at launch",
    url: null as string | null,
  },
  {
    id: "solscan",
    label: "Solscan",
    title: "Holders and transfers — live at launch",
    url: null as string | null,
  },
];

/** Published proof files, served as static assets next to the app. */
export const OLD_HOLDER_PROOFS_URL = "/proofs/old-holders.json";
export const INFLUENCER_PROOFS_URL = "/proofs/influencers.json";

/**
 * The snapshot itself, published so the claim list can be audited rather than
 * trusted. `holders.csv` is the list the Merkle root commits to; `excluded.csv`
 * says who was left out and why, which is the half most projects quietly omit.
 */
export const SNAPSHOT_FILES = [
  {
    name: "holders.csv",
    url: "/snapshot/holders.csv",
    description: "Every wallet in the snapshot and its allocation",
  },
  {
    name: "excluded.csv",
    url: "/snapshot/excluded.csv",
    description: "Addresses deliberately left out, each with a reason",
  },
  {
    name: "manifest.json",
    url: "/snapshot/manifest.json",
    description: "Snapshot slot, totals and the Merkle root, for re-derivation",
  },
];

/** 2030-12-31T23:59:59Z — the original signer's deadline. */
export const ORIGINAL_SIGNER_DEADLINE = 1_924_991_999;

/**
 * Provenance of the 2014 Bitcoin message this project is named after.
 *
 * These are display aids only. The contract does not read any of them — it
 * verifies a secp256k1 signature against `original_signer_pubkey`, which is
 * stored on chain and frozen by the config lock. Everything here exists so a
 * visitor can check that the key the contract is waiting for really is the key
 * from that 2014 transaction, without taking our word for it.
 *
 * Leave a field empty and the UI says so plainly rather than inventing it.
 * Fill all three before launch — the card is far weaker without them.
 */
export const ORIGINAL_MESSAGE = {
  /** The Bitcoin address that signed in 2014. */
  address: import.meta.env.VITE_BTC_ADDRESS ?? "",
  /** The exact message text, byte for byte, that must be signed. */
  message: import.meta.env.VITE_BTC_MESSAGE ?? "",
  /** The 2014 transaction id carrying the message. */
  txid: import.meta.env.VITE_BTC_TXID ?? "",
};

/** Block explorer links. mempool.space needs no account and has no tracking. */
export const btcTxUrl = (txid: string) => `https://mempool.space/tx/${txid}`;
export const btcAddressUrl = (address: string) =>
  `https://mempool.space/address/${address}`;

/**
 * What an influencer agrees to by claiming.
 *
 * Imported from the single canonical file at the repo root, never retyped —
 * the Cloud Function that verifies these signatures reads the same bytes, and
 * a one-character difference between the two would make every signature fail
 * to verify.
 *
 * The signature is evidence, not enforcement: the program cannot read a
 * promise, and claiming succeeds without one. What it gives is a public,
 * self-authenticating record, tied to the key that received the tokens, that
 * these terms were displayed in the wallet and accepted.
 */
export const INFLUENCER_TERMS = influencerTerms;

/** Where accepted signatures are recorded, and served back for auditing. */
export const TERMS_API = "/api/terms";

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

/**
 * The staking tiers, written as a pricing table rather than a spec.
 *
 * `perks` is what you get, `costs` is what it costs you — both stated plainly,
 * because a lockup with a forfeiture penalty is not something anyone should
 * discover after committing.
 */
export const TIERS = [
  {
    id: 0,
    name: "Flexible",
    multiplier: "1.0x",
    lock: "3 days to exit",
    tagline: "Exit any day you choose — it takes 3 days to complete",
    perks: [
      "Earn a share of every reward, from day one",
      "Claim your rewards at any time",
      "Keeps earning during the 3-day exit",
      "No penalty, ever — you always get 100% back",
    ],
    costs: [
      "No bonus: you earn the base rate only",
      "Unstaking takes 3 days: request it, wait, then withdraw",
    ],
  },
  {
    id: 1,
    name: "1 month",
    multiplier: "1.5x",
    lock: "30 days",
    tagline: "A modest bonus for a short commitment",
    perks: [
      "Counts as 1.5× your stake when rewards are split",
      "Base rewards still claimable any time",
      "Bonus paid in full at day 30",
    ],
    costs: [
      "Locked for 30 days",
      "Leaving early forfeits the entire bonus plus 15% of your stake",
    ],
  },
  {
    id: 2,
    name: "3 months",
    multiplier: "2.0x",
    lock: "90 days",
    tagline: "Double weight for a quarter",
    perks: [
      "Counts as 2× your stake when rewards are split",
      "Base rewards still claimable any time",
      "Bonus paid in full at day 90",
    ],
    costs: [
      "Locked for 90 days",
      "Leaving early forfeits the entire bonus plus 15% of your stake",
    ],
  },
  {
    id: 3,
    name: "12 months",
    multiplier: "5.0x",
    lock: "365 days",
    tagline: "Five times the share, for a full year",
    popular: true,
    perks: [
      "Counts as 5× your stake when rewards are split",
      "Base rewards still claimable any time",
      "Bonus paid in full at day 365",
      "Earns from everything others forfeit along the way",
    ],
    costs: [
      "Locked for a full year",
      "Leaving early forfeits the entire bonus plus 15% of your stake",
    ],
  },
];

export function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
