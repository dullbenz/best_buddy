import { PublicKey } from "@solana/web3.js";
import influencerTerms from "./generated/influencer-terms.txt?raw";

/**
 * Everything the UI needs to talk to the deployed distributor. All of it is
 * public information by design; the dashboard is meant to be verifiable by
 * anyone, including people who never open this app.
 */
/**
 * Which RPC this page talks to, decided at runtime from the hostname.
 *
 * A keyed endpoint has to be locked to an Origin or the key is free for anyone
 * to spend, and Helius will not accept "localhost" as an allowlist entry, so
 * a keyed URL simply cannot work from a dev server on localhost. Build-time
 * env cannot resolve this either: one `npm run dev` is reachable *both* at
 * localhost and through the tunnel, from the same bundle.
 *
 * So the choice is made per request, by where the page was actually served
 * from. Real hostname (staging, the tunnel, production) uses the keyed
 * endpoint. localhost falls back to the public one, which needs no key and
 * enforces no Origin. Both must point at the same cluster; nothing here
 * guesses.
 */
const KEYED_RPC = import.meta.env.VITE_RPC_URL as string | undefined;
const LOCAL_RPC = import.meta.env.VITE_LOCAL_RPC_URL as string | undefined;

const servedFromLocalhost =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

export const RPC_URL =
  (servedFromLocalhost
    ? LOCAL_RPC ?? KEYED_RPC
    : KEYED_RPC ?? LOCAL_RPC) ?? "https://api.mainnet-beta.solana.com";

/** Host only: the API key never belongs in anything rendered. */
export const RPC_HOST = (() => {
  try {
    return new URL(RPC_URL).host;
  } catch {
    return RPC_URL;
  }
})();

/** True when this page is going through our own keyed endpoint. */
export const RPC_IS_KEYED = !servedFromLocalhost && !!KEYED_RPC;

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ??
    "7h8fAnCmpeLaAo2Y9j43wrdERexUycMH5CV484v5wtrP",
);

/** Decimals of the new token; pump.fun mints use 6. */
export const TOKEN_DECIMALS = 6;

/**
 * Ticker, appended to token amounts everywhere.
 *
 * A bare number on a page that also quotes SOL is ambiguous, and the ambiguity
 * lands exactly where it matters most: on the figure telling somebody what
 * they are owed.
 */
export const TOKEN_SYMBOL = "$BUDDY";

/**
 * The public source. Everything the project runs on is in here: the program,
 * this website, the snapshot scripts and the runbooks.
 */
export const REPO_URL = "https://github.com/dullbenz/best_buddy";
export const repoPath = (path: string) => `${REPO_URL}/blob/main/${path}`;
export const REPO_ACTIONS_URL = `${REPO_URL}/actions`;

/**
 * Which chain this build talks to, inferred from the RPC URL rather than set
 * separately. One source of truth means a devnet build cannot accidentally
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
 * Always mainnet, whatever cluster this build points at. It is a real thing
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
 * Legacy is historical and settled: its mint, name and links are facts that
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
  links: linkOrder.map(
    (label) => LEGACY_TOKEN.links.find((l) => l.label === label)!,
  ),
};

export const NEW_TOKEN_INFO = {
  name: "Best Buddy",
  ticker: "$BUDDY",
  image: "/tokens/new/logo.png",
  /** Set on launch day. Until then every link below stays null. */
  mint: null as string | null,
  links: [
    { label: "pump.fun", note: "the launch page", url: null as string | null },
    {
      label: "DexScreener",
      note: "the price chart",
      url: null as string | null,
    },
    {
      label: "Solscan",
      note: "holders and transfers",
      url: null as string | null,
    },
  ],
};

/**
 * Where the community actually talks. The X group is live now; the market
 * links only appear once there is a token behind them, because a dead link on
 * a memecoin site reads as abandonment, the exact thing this project exists
 * to answer.
 */
export const SOCIAL_LINKS = [
  {
    id: "x",
    label: "X Profile",
    title: "Buddy on X",
    url: "https://x.com/iam_d_bestbuddy",
  },
  {
    id: "pumpfun",
    label: "pump.fun",
    title: "Trade on pump.fun",
    url: null as string | null,
  },
  {
    id: "dexscreener",
    label: "DexScreener",
    title: "Price chart",
    url: null as string | null,
  },
  {
    id: "solscan",
    label: "Solscan",
    title: "Holders and transfers",
    url: null as string | null,
  },
];

/**
 * Published proof and snapshot files, served as static assets next to the app.
 *
 * Everything is namespaced by cluster off mainnet. A devnet build has to be
 * loaded with fabricated allocations to be testable at all, and those files
 * must never be reachable at the paths the real ones will occupy. A test
 * fixture served as the published snapshot would be indistinguishable from
 * quietly rewriting who is owed what. Mainnet keeps the bare paths.
 */
const publishedDir = IS_MAINNET ? "" : `/${CLUSTER}`;

export const OLD_HOLDER_PROOFS_URL = `/proofs${publishedDir}/old-holders.json`;
export const INFLUENCER_PROOFS_URL = `/proofs${publishedDir}/influencers.json`;

/**
 * The snapshot, published so the claim list can be audited rather than trusted.
 *
 * "Published" means these exact files are served from this domain and are in
 * the public repository: two independent copies of the same bytes, so a
 * quietly edited list here would not match the one on GitHub.
 *
 * `excluded.csv` is published for the same reason the holder list is. A project
 * that publishes only the winners can drop anyone it likes and nobody can tell,
 * so every exclusion is listed with its reason and can be argued with. The
 * exclusions themselves exist because pool vaults and burn addresses are not
 * people. Left in, an AMM vault would take a pro-rata slice of restitution
 * meant for the holders it was trading against.
 *
 * The influencer list gets the same treatment as the holder list. It is
 * hand-picked rather than derived from chain, which makes publishing it more
 * important, not less: there is no way to re-derive it, so the only check
 * available is that the names are stated openly and the Merkle root matches.
 */
/**
 * The real mainnet snapshot, filled in on launch day. Both must be set
 * together: a date without a slot is unverifiable, and a slot without a date
 * is unreadable.
 */
const MAINNET_SNAPSHOT_TAKEN_AT: string | null = null;
const MAINNET_SNAPSHOT_SLOT: number | null = null;

export const SNAPSHOT = {
  /**
   * The moment the holder list was frozen.
   *
   * Cluster-aware, and it has to be. Off mainnet these hold the devnet
   * fixture's real values so the sentence reads the way it will on launch day
   * instead of as two dashed blanks. On mainnet they stay null until the real
   * snapshot is taken, because this is the one claim on the page a reader can
   * check against the chain in ten seconds, and a devnet slot is not merely
   * wrong there, it is a block number tens of millions of slots in mainnet's
   * future. A site whose whole argument is "go and check" cannot afford its
   * most checkable sentence to be impossible.
   *
   * Fill the two constants above on launch day. Until then production says
   * plainly that the snapshot has not happened yet, which is true.
   */
  takenAt: (IS_MAINNET ? MAINNET_SNAPSHOT_TAKEN_AT : "2026-08-14T00:52:17Z") as
    | string
    | null,
  slot: (IS_MAINNET ? MAINNET_SNAPSHOT_SLOT : 483_637_296) as number | null,

  legacy: [
    {
      name: "holders.csv",
      url: `/snapshot${publishedDir}/holders.csv`,
      description: "Every wallet in the snapshot and its allocation",
    },
    {
      name: "excluded.csv",
      url: `/snapshot${publishedDir}/excluded.csv`,
      description: "Every address left out, with the reason for each one",
    },
    {
      name: "manifest.json",
      url: `/snapshot${publishedDir}/manifest.json`,
      description: "The slot, the totals and the Merkle root, for re-derivation",
    },
  ],

  influencers: [
    {
      name: "influencers.csv",
      url: `/snapshot${publishedDir}/influencers.csv`,
      description: "Everyone on the influencer list and their allocation",
    },
    {
      name: "influencers-manifest.json",
      url: `/snapshot${publishedDir}/influencers-manifest.json`,
      description: "The totals and the Merkle root for that list",
    },
  ],
};

/**
 * The exact text the 2014 keyholder must sign, followed by the Solana address
 * the tokens should go to.
 *
 * Mirrors `SIGNER_CLAIM_MESSAGE_PREFIX` in the program, which reconstructs the
 * message on chain and recovers the public key from the signature. A character
 * out of place here produces a signature that verifies against nothing, so the
 * two must be changed together: the program is the authority, this is a copy
 * for display and for building the claim.
 */
export const SIGNER_CLAIM_MESSAGE_PREFIX =
  "I am the original Signer. Claim to Solana address: ";

export const signerClaimMessage = (destination: string) =>
  `${SIGNER_CLAIM_MESSAGE_PREFIX}${destination}`;

/** 2030-12-31T23:59:59Z, the original signer's deadline. */
export const ORIGINAL_SIGNER_DEADLINE = 1_924_991_999;

/**
 * Provenance of the 2014 Bitcoin message this project is named after.
 *
 * These are display aids only. The contract does not read any of them; it
 * verifies a secp256k1 signature against `original_signer_pubkey`, which is
 * stored on chain and frozen by the config lock. Everything here exists so a
 * visitor can check that the key the contract is waiting for really is the key
 * from that 2014 transaction, without taking our word for it.
 *
 * Every value here was checked against the chain, not transcribed: the txid
 * resolves, it confirmed in block 299825, its only input is the address below,
 * and its OP_RETURN output decodes to exactly the 34 bytes of `message`.
 */
export const ORIGINAL_MESSAGE = {
  /** The Bitcoin address that sent the transaction carrying the message. */
  address: "1GPXXpxtzyzLj2iqqcTFYW2TFC8rWqu92e",
  /**
   * The message, byte for byte, as it sits in the OP_RETURN output.
   *
   * Exactly 34 bytes, no trailing newline, no capitalisation beyond the B.
   * Anyone re-deriving the signature has to hash precisely this, so it is a
   * literal here rather than something reconstructed from a heading.
   */
  message: "Buddy is the best dog in the world",
  /** The 2014 transaction carrying it. */
  txid: "95156dbb48e957754a1fff53ccb9604ee5592dfdd2f117aa37baf635261ef93a",
  /** Height it confirmed at, so the date can be placed without trusting us. */
  block: 299825,
};

/**
 * Where to go and look at it.
 *
 * mempool.space first: it is the explorer Bitcoin developers actually use, it
 * decodes the OP_RETURN to readable text on the page, and it sets no cookies
 * and runs no third-party trackers, which matters when the whole point of the
 * link is "do not take our word for it".
 *
 * blockchain.com second because it is the one most people already recognise,
 * and a familiar name is worth having for a reader who does not know what an
 * OP_RETURN is.
 */
export const btcTxUrl = (txid: string) =>
  `https://www.blockchain.com/explorer/transactions/btc/${txid}`;
export const btcAddressUrl = (address: string) =>
  `https://mempool.space/address/${address}`;

export const BTC_EXPLORERS = [
  {
    label: "mempool.space",
    note: "decodes the message on the page",
    url: (txid: string) => `https://mempool.space/tx/${txid}`,
  },
  {
    label: "blockchain.com",
    note: "the familiar one",
    url: (txid: string) =>
      `https://www.blockchain.com/explorer/transactions/btc/${txid}`,
  },
  {
    label: "blockstream.info",
    note: "a third, independent view",
    url: (txid: string) => `https://blockstream.info/tx/${txid}`,
  },
];

/**
 * What an influencer agrees to by claiming.
 *
 * Imported from the single canonical file at the repo root, never retyped.
 * The Cloud Function that verifies these signatures reads the same bytes, and
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
  communityStream: Buffer.from("community_stream"),
};

/** `CommunityStream.kind` values, which must match the program's constants. */
export const COMMUNITY_STREAM_KINDS = [
  { kind: 0, label: "Forfeited influencer allocations", period: "30 days" },
  { kind: 1, label: "The 2014 signer's unclaimed share", period: "12 months" },
] as const;

/**
 * The staking tiers, written as a pricing table rather than a spec.
 *
 * `perks` is what you get, `costs` is what it costs you, and both are stated
 * plainly, because a lockup with a forfeiture penalty is not something anyone should
 * discover after committing.
 */
export const TIERS = [
  {
    id: 0,
    name: "Flexible",
    multiplier: "1.0x",
    lock: "3 days to exit",
    tagline: "Exit any day you choose, though it takes 3 days to complete",
    perks: [
      "Earn a share of every reward, from day one",
      "Claim your rewards at any time",
      "Keeps earning during the 3-day exit",
      "No penalty, ever. You always get 100% back",
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
