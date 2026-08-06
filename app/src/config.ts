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
 * Signed with the wallet before the claim button unlocks. The signature is
 * off-chain evidence, not an on-chain condition — the program cannot read the
 * contents of a promise, and pretending otherwise would be the same kind of
 * overclaiming this project exists to avoid. What it does give: a
 * cryptographic record, tied to the same key that received the tokens, that
 * these terms were shown and accepted at claim time.
 *
 * The terms themselves are not decoration. Paid promotion without disclosure
 * breaks FTC rules in the US and equivalents elsewhere, and a promise of
 * returns can make an ordinary post a securities problem for the person who
 * made it.
 */
export const INFLUENCER_TERMS = `Buddy — influencer allocation terms

By signing this message and claiming, I agree that:

1. I will disclose that I was compensated in tokens, clearly and in the post
   itself — not in a reply, a bio, or a link. #ad or "paid promotion" is
   enough; burying it is not.
2. I will not promise, predict or imply any financial return. No price
   targets, no "this will 100x", no "guaranteed", no "you can't lose".
3. I will not present this as investment advice, and I will not tell anyone
   how much of their money to put in.
4. I will describe the project as it actually is: a memecoin whose rules are
   enforced by an immutable contract, which can go to zero like any other.
5. I will not claim the team guarantees anything, because it does not.
6. I understand my tokens are released gradually over 30 days and that
   claiming pays me nothing up front.
7. I am not being paid to say anything untrue, and nobody has asked me to.

I understand these terms are published, that this signature is a public
record, and that misrepresenting the project is my own legal liability.`;

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
    lock: "no lock",
    tagline: "Leave whenever you like",
    perks: [
      "Earn a share of every reward, from day one",
      "Claim your rewards at any time",
      "No penalty, ever — nothing to forfeit",
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
      "Leaving early forfeits the entire bonus plus 10% of your stake",
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
      "Leaving early forfeits the entire bonus plus 10% of your stake",
    ],
  },
  {
    id: 3,
    name: "12 months",
    multiplier: "3.0x",
    lock: "365 days",
    tagline: "The largest share available",
    popular: true,
    perks: [
      "Counts as 3× your stake when rewards are split",
      "Base rewards still claimable any time",
      "Bonus paid in full at day 365",
      "Earns from everything others forfeit along the way",
    ],
    costs: [
      "Locked for a full year",
      "Leaving early forfeits the entire bonus plus 10% of your stake",
    ],
  },
];

export function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
