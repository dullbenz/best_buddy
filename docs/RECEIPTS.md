# Receipts — the case for the relaunch

> **On-chain rows machine-gathered and link-verified on 2026-08-17. Social rows
> captured live the same day as dated screenshots on file. Wayback archival of
> the Solscan and pump.fun pages was attempted from a logged-in session but
> their bot-protection blocks the Internet Archive crawler ("Job failed"); the
> on-chain rows need no archiving — every transaction is permanent on Solana
> and viewable on any explorer — and the off-chain pages are preserved by the
> dated screenshots.**

> Fill this in **now**, before launch. Links rot, socials get deleted, and
> screenshots without dates convince nobody. This file is both your defence if
> the old dev objects and the justification for every wallet excluded from the
> snapshot.

Old token: `7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump`
([Solscan](https://solscan.io/token/7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump))

**The coin, verified on-chain (public mainnet RPC, 2026-08-17):** "The First
Crypto Dog" (symbol `Buddy`), a Token-2022 mint created through pump.fun's
`CreateV2` on **2026-08-01 09:41:37 UTC** — creation tx
[`4XPLmFQ4…Zt5M`](https://solscan.io/tx/4XPLmFQ4JhjmnvPAXKxChBReWwfYrf4WZ4oU8cWAbijucukR4JZgwfUPoFsasHmQpVtz93BszLUuLMn6VWuKZt5M).
Mint and freeze authority are revoked. 1,000,000,000 minted; current supply is
967,461,234.485668 — 32,538,765.51 have been burned outright (supply reduction
via Token-2022 `Burn`; there is **no** burn-address holder, see §5). The
bonding curve completed and the coin migrated to PumpSwap.

---

## 1. Creator wallets

Every wallet believed to belong to the original creator, with how it was
identified. Anyone should be able to follow the reasoning, not just take it on
faith.

| Wallet | How identified | Excluded from snapshot |
|---|---|---|
| [`D3us8ZjT9eAZDBYYsowmfcDE87VvPbHRN1YaQckQQwnJ`](https://solscan.io/account/D3us8ZjT9eAZDBYYsowmfcDE87VvPbHRN1YaQckQQwnJ) | creator of the pump.fun coin — the `creator` field of the bonding-curve PDA [`34ka73uP…Edz6`](https://solscan.io/account/34ka73uP5Ukr2ZdCXsP34BG3yPfSAu32nHUxzrE8Edz6) (owned by the pump.fun program `6EF8rrec…F6P`, decoded from raw account data 2026-08-17) is this address, and it signed and paid for the creation tx [`4XPLmFQ4…Zt5M`](https://solscan.io/tx/4XPLmFQ4JhjmnvPAXKxChBReWwfYrf4WZ4oU8cWAbijucukR4JZgwfUPoFsasHmQpVtz93BszLUuLMn6VWuKZt5M) | yes |
| [`H9XXSb8jwVsDWvj577KP3w9i9hRvhz78kSftQqQw3jwv`](https://solscan.io/account/H9XXSb8jwVsDWvj577KP3w9i9hRvhz78kSftQqQw3jwv) | received 3.98115 SOL of the dump proceeds from the creator on 2026-08-02 12:25:55 UTC — [`3fbxATc3…HomDP`](https://solscan.io/tx/3fbxATc3X8mjiTBxPfpBbMfXwae4mshGio7P9ksGHBEANa1iodLfpWidVpjtC9PN6EuU5MsPqLixWFzgbPxHomDP) — a one-use pass-through wallet (2 transactions ever) that forwarded the full amount 3 seconds later to `8zHcWujH…PGvS` (a 1000+-tx/day wallet consistent with exchange infrastructure) — [`2PECfpTS…4xer`](https://solscan.io/tx/2PECfpTSuFAfeyybKkN3hwZrKBNS9kwSMAo5FMFbzv2qLNUMXECi4Bi6zkgSjMTf8NKD8CqGbfJKi9gxjd4w4xer) | yes |
| [`BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6`](https://solscan.io/account/BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6) | funded the creator wallet with 4.949575 SOL 32 minutes before launch (2026-08-01 09:09:27 UTC) — [`egUGiQWc…GVX1`](https://solscan.io/tx/egUGiQWcz8HvMUPXFPLvU6km4PTRc3DBPy2bDLXLZPNG66tZXxoo9mtQwj2gPW1DGWpzoAyGY94DUAd1NnSGVX1). Solscan labels it "KuCoin Hot Wallet" — consistent with the creator funding the launch via a CEX withdrawal, which keeps the person behind it anonymous. Ownership by the creator is not proven, but it **holds 0 Buddy** (checked 2026-08-17), so excluding it denies restitution to no real holder — it is not custodying this token for exchange users. | yes |
| [`E6VD9jaLaSdQkXRc5Sv8ZwnYtNX2b6WyvrSejyKYCnuX`](https://solscan.io/account/E6VD9jaLaSdQkXRc5Sv8ZwnYtNX2b6WyvrSejyKYCnuX) | round-tripped SOL with the creator on 2026-08-06: sent 8.794 SOL in ([`2PKydzs4…ubKn`](https://solscan.io/tx/2PKydzs4pXU7yMgToGDdDxCbiWhmW7TTa4JDQm92qLge1Wg9F4UoDBS7X757fRh9LbUvXZuU7rmFT9Je55DwubKn)) minutes before the creator's *second* coin launch, and received 10.550 SOL back ([`5dSJjUs7…diBjy`](https://solscan.io/tx/5dSJjUs7UdKCUawhQkVrBUSAMaDSp3hPQXecwH4tJag2JJMBRHvH1JrsyiJKqvZfVFCjgXta1CSQP9iTmZsdiBjy)) after the position was dumped. High-volume wallet; ownership unproven, but **holds 0 Buddy** (checked 2026-08-17), so its exclusion strips nothing from a real holder. | yes |

## 2. The dumps

Dated, linked, with amounts. This is the core of the case.

All rows are UTC, wallet `D3us8ZjT9eAZDBYYsowmfcDE87VvPbHRN1YaQckQQwnJ`, and
every sell went into the pump.fun **bonding curve** (`34ka73uP…Edz6`) via the
trading router `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9`, confirmed from
each transaction's inner instructions (`pump.fun Instruction: Sell`).

At creation (09:41:37) the creator dev-bought **145,334,293.95 Buddy — 14.5% of
total supply — for ~4.82 SOL** in the creation tx itself
([`4XPLmFQ4…Zt5M`](https://solscan.io/tx/4XPLmFQ4JhjmnvPAXKxChBReWwfYrf4WZ4oU8cWAbijucukR4JZgwfUPoFsasHmQpVtz93BszLUuLMn6VWuKZt5M)).
The dump began 88 seconds later.

| Date | Wallet | Action | Amount | Transaction |
|---|---|---|---|---|
| 2026-08-01 09:43:05 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.311 SOL) | 7,266,714.70 | [`xVUP5ehj…EEFh`](https://solscan.io/tx/xVUP5ehjim3kf1SLBviBQhBXSB3vQMuku25jnPBYTeUxTrfeSfXoSauity6sPDcAxZdLrWdtqNttoeygcUUEEFh) |
| 2026-08-01 09:43:13 | `D3us8Z…QwnJ` | sold into the bonding curve (+1.402 SOL) | 34,516,894.81 | [`2KVXDjR3…hdLK`](https://solscan.io/tx/2KVXDjR3WToouXN3pmErr8DrMjpRegAUFFjsfk8PB7vJd9zs4fWyygWKcL1fs3TekqgkWLYR5qdFv9RToVR6hdLK) |
| 2026-08-01 09:43:28 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.204 SOL) | 5,177,534.22 | [`4nbgoG1t…5zTU`](https://solscan.io/tx/4nbgoG1tw5Yc5LNo38nRpSRnKhhzWqVkLLPSYYJsrckGhATnKdsyBbP6hGmuhWT8iBqmqLRq49cnXMhP3v1s5zTU) |
| 2026-08-01 09:43:32 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.191 SOL) | 4,918,657.51 | [`2CnfBPPQ…BoNJ`](https://solscan.io/tx/2CnfBPPQ2T4yDBSe3khsAw4Te3vkMvXYuFZYwEnkBUSmDb5KUe6Uxo5MpbQbx658fQ4j3uoEde7Gmm3Vos4EBoNJ) |
| 2026-08-01 09:44:09 | `D3us8Z…QwnJ` | sold into the bonding curve (+1.748 SOL) | 46,727,246.35 | [`3usvwTxh…tz7D`](https://solscan.io/tx/3usvwTxhG6S3Yp8vSf8xrUXDzWdgKavDenPz7VdL62byS2xacAsk7mzmp8FGLZvCcpxL7Brk7DjYuBz3sdbwtz7D) |
| 2026-08-01 09:45:17 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.873 SOL) | 23,363,623.18 | [`oW52oSH9…GsXX`](https://solscan.io/tx/oW52oSH9CrX2vFzYKcNd53P8kiD47ehPsz5ZreuJ8BBTgQz5nKVt2h1hKaWwr4n52S2Nyn6wm7etRymXXbZGsXX) |
| 2026-08-01 09:45:20 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.813 SOL) | 23,363,623.18 | [`wdSTTKEn…s1Q6`](https://solscan.io/tx/wdSTTKEnatMCrfZ9v3RhnX4bB29fqkaHa3ZPA3eMeyLPWM7bZsbo4Cyad3E9vRSfFQYS1eP8GzzEfbS2xkFs1Q6) |
| 2026-08-01 09:45:29 | `D3us8Z…QwnJ` | re-bought (−0.959 SOL) | 16,131,846.25 | [`4bkAGv25…y7rN`](https://solscan.io/tx/4bkAGv25Tb9KCf5WKNqTP1ib8Xb7CbhzpL44WovcX5AE2YMhZaDakhnmMn2wJgcS8kLge65X1V4psPc7gZmdy7rN) |
| 2026-08-01 09:45:42 | `D3us8Z…QwnJ` | sold into the bonding curve (+1.091 SOL) | 16,131,846.25 | [`4QB3zYeB…7uPU`](https://solscan.io/tx/4QB3zYeB6A3uQGVTGU8L4YxkBdEEDQ4VaHYRwRpzbWBD5C4fPiKj4AbDRGASHmhTnww1fSQ3843uoS8yUw6z7uPU) |
| 2026-08-01 09:45:52 | `D3us8Z…QwnJ` | re-bought (−0.213 SOL) | 3,078,540.78 | [`45xDVspK…wefh`](https://solscan.io/tx/45xDVspKVbmL9ZyQztMdz6WfZsia3hgH3e6wfhmv4ZvJn9ZVNHL6sxEbrgi4xsdVgEAnkxdJJboy9Vd8BT2Rwefh) |
| 2026-08-01 09:46:00 | `D3us8Z…QwnJ` | sold into the bonding curve (+0.234 SOL) | 3,078,540.78 | [`JESupoqo…8i69`](https://solscan.io/tx/JESupoqoxHLD97L4Q59Xvyxi7CcArG88k9G9hAmpRZwBDXKYiZjFPYaMCdMT55rLpQHErSWUmiYhAfBLTEo8i69) |

Summary: **164,544,680.98 tokens sold — the creator's entire position, worth
roughly $500 at the time (≈6.87 SOL gross at ~$72.88/SOL, CoinGecko
2026-08-01) — over 2 minutes 55 seconds**, starting 88 seconds after launch.
The wallet has held 0 Buddy ever since (and holds 0 SOL today; the proceeds
left via the §1 route on 2026-08-02). Verified against the wallet's complete
signature history (670 transactions, paginated to genesis on the public
mainnet RPC): no other Buddy movement by this wallet exists.

## 3. Abandonment

Evidence that the creator walked away — not a claim about the price. The
community kept showing up; he did not, and his silence is what this section
documents.

On-chain rows (machine-verified):

| Date | What | Evidence |
|---|---|---|
| 2026-08-01 10:20:40 | creator claimed 0.0386 SOL of trading fees from the pump.fun creator vault `7cDDghuU…2WCF`, 39 minutes after launching and 34 minutes after dumping | [`37qgX8eD…1PYg`](https://solscan.io/tx/37qgX8eDZetbTbwWkET8Q4h22BXJZLAmGdV53wwdLJDdnWocTMwX7hoPWsEvJ262M7SzY5uFVmsxu4qizvaf1PYg) |
| 2026-08-04 | two further creator-fee claims (+0.0341 SOL at 07:36:32, +0.0058 SOL at 08:39:27) — the creator's only post-dump interactions with the project | [`4oa6YpRR…8t1d`](https://solscan.io/tx/4oa6YpRRkzrJLDir5DbfdSqxbq7q5ARWfW7WxRCBRyqkZVN1cps5K86DLPnbrMn4bN9ZUXis3uP1BMHcJyXP8t1d), [`5aJ875v2…QsBX`](https://solscan.io/tx/5aJ875v23VTyjnnAiaLYQUR9LqyVkX8qEAvUX2iKnFE9PHKC6NKbfHaczN5zrgw3a1SEoyAyhBciKUqDDMF5QsBX) |
| 2026-08-06 11:11:45 | creator launched a **second** pump.fun coin, "loomination" (`D5jwLARx…pump`), dev-buying 349.6M (35% of its supply) with 14.84 SOL — and sold the position 6 seconds later for +19.34 SOL | create: [`3cRjq94W…vZ83`](https://solscan.io/tx/3cRjq94WzXfkWQ5kompByV84rz68nGW2qQ8dg1SX2gRV3tTtugaWLodP2vfmNTK7qiLQqn4RZXdgQkGZnfmbvZ83), dump: [`3sLtziUU…ENr1`](https://solscan.io/tx/3sLtziUUhFgL4LunLhksjm9fhkanNDzEPVvUu3te6k4q2je4QHvH9JHZCpbTWkvfstuJctXRHQQVuGUKUnYEENr1) |
| 2026-08-06 11:14:06 | creator launched a **third** pump.fun coin (`Ex6gmurP…pump`), dev-buying 225.9M with 8.19 SOL — 2 minutes after the second | [`51bw1xkb…d39h`](https://solscan.io/tx/51bw1xkbV4zm4z5TZbNV6oU3H47HdPVoFnLq9XZAs6hgYqwkMHpaytfMY31qrFoK5UcJiMqRpxUDVRY8xBe1d39h) |
| ongoing | pump.fun creator vault `7cDDghuU…2WCF` still accrues fees (0.0018 SOL sitting unclaimed at check); PumpSwap trades of Buddy continue to reference the creator for fee accrual | [vault](https://solscan.io/account/7cDDghuUtEtQWMg9Z1m2rrXmHtew5uFK1AjK43Gf2WCF) |

Social rows document the **creator's** treatment of the project as disposable —
not the community's absence. The community is active (see §4); the point here is
that the creator gave it no lasting home of its own.

| Observed | What | Evidence |
|---|---|---|
| 2026-08-17 | The coin's on-record "Twitter" (per its pump.fun metadata) is an X community [`x.com/i/communities/1997368140322226485`](https://x.com/i/communities/1997368140322226485) that now carries no project branding — currently generic, with only X's three default community rules. Per the team's own record it was set up and branded at launch (as "Buddy"), then renamed and repurposed as the creator moved through a rapid series of further coin launches (see the second and third coins in the on-chain rows above) rather than being kept as a home for this one. | live capture 2026-08-17, screenshot on file |
| 2026-08-17 | The coin's "website" field points to the **2014 Bitcoin transaction** on blockchain.com (the same provenance tx this project is named after), not a project site — there was never a real website. | pump.fun metadata, machine-read + live-confirmed 2026-08-17, screenshot on file |
| 2026-08-17 | **No Telegram** was ever set (pump.fun metadata `telegram: null`). | pump.fun coin page, screenshot on file |

> **On preservation.** Wayback "Save Page Now" was tried on the Solscan and
> pump.fun pages from a logged-in account and both returned "Job failed" —
> Solscan sits behind Cloudflare and pump.fun is a bot-protected single-page
> app, so the Internet Archive's crawler cannot fetch either. The record
> therefore rests on: (1) the on-chain transactions, which are permanent and
> re-verifiable on any explorer, and (2) dated local screenshots of the
> off-chain pages, on file. If archive.org ever does capture these URLs later,
> add the snapshot links here.

## 4. Community impact

The other side of the coin: the creator left, but the holders did not. This is
the evidence that a real community stayed and kept the project moving — the
premise the relaunch is built on.

| Observed | What | Evidence |
|---|---|---|
| 2026-08-17 | Holders organised independently: the coin's community gathers in a self-run X community ([`x.com/i/communities/1997368140322226485`](https://x.com/i/communities/1997368140322226485), 301 members) that is **actively posting** — a "dev is live on pumpfun" post 43 minutes before capture — with no creator involvement. | live capture 2026-08-17, screenshot on file |
| 2026-08-17 | The market itself shows the community carrying it: ~1,000 holders and a two-sided daily market long after the creator dumped and left (per the coin's pump.fun / Solscan pages). | pump.fun + Solscan coin pages, screenshots on file |

## 5. Pool and infrastructure addresses

Not wrongdoing — these are excluded from restitution because they are contracts,
not people. Left in, an AMM vault would take a pro-rata slice of a bucket meant
for the holders it was trading against, and nothing could ever claim it: a PDA
has no private key, so that share would sit unclaimed until the sweep moved it
to the stakers. Excluding them keeps the restitution with the people it is for.

Every address here is reproduced in `excluded.csv` with the same reason, so the
list can be argued with rather than taken on faith.

Balances are as read on 2026-08-17 (public mainnet RPC); they move with every
trade — re-read them at snapshot time.

| Address | What it is | Excluded |
|---|---|---|
| [`3MePuztv5iB56hyecEaBztjxQQSgAs7m4G7yq7gKLs38`](https://solscan.io/account/3MePuztv5iB56hyecEaBztjxQQSgAs7m4G7yq7gKLs38) | PumpSwap pool vault — token account of pool [`3HmXpoWk…UDy4`](https://solscan.io/account/3HmXpoWkYxUmGT1i66NAFtrxGGM4w7Z9TG8TdZ9YUDy4) (owned by PumpSwap program `pAMMBay6…FXEA`); held 55,985,004.53 Buddy | yes |
| [`9U329jLt17aUrYbb4xD2tdjCtA1yQwZjVDPrnoYagq4k`](https://solscan.io/account/9U329jLt17aUrYbb4xD2tdjCtA1yQwZjVDPrnoYagq4k) | Meteora DAMM v2 pool vault — `token_a_vault` of pool [`BfEsBiC3…qrNn`](https://solscan.io/account/BfEsBiC3VA7J1AqKTevVXVc48TpFutCruo6EJhefqrNn) (program `cpamdpZC…1sGG`, vault authority `HLnpSz9h…TLcC`); held 467,942.39 Buddy | yes |
| [`htjkX4zqELWzeHHEjkwgZcUWBDNbS9LSNWpygTmnRPf`](https://solscan.io/account/htjkX4zqELWzeHHEjkwgZcUWBDNbS9LSNWpygTmnRPf) | Meteora DAMM v2 pool vault — `token_a_vault` of the near-empty second pool [`En3EmZmp…qZUx`](https://solscan.io/account/En3EmZmpmFUauUshZ8rrkNmvvKJfzpB1mRqvWrNeqZUx) (same program); held 1.13 Buddy | yes |
| [`5mbHmspj9ye4eZiBEpy1SoMcE3uPR3WEGFf9DjjmRh6T`](https://solscan.io/account/5mbHmspj9ye4eZiBEpy1SoMcE3uPR3WEGFf9DjjmRh6T) | pump.fun bonding-curve token account (curve [`34ka73uP…Edz6`](https://solscan.io/account/34ka73uP5Ukr2ZdCXsP34BG3yPfSAu32nHUxzrE8Edz6) is complete/migrated; balance 0 — excluded defensively) | yes |
| [`4kPFFQZJ51RZvpqFCtozBquDZqnRd1ehiT9MazewbaPR`](https://solscan.io/account/4kPFFQZJ51RZvpqFCtozBquDZqnRd1ehiT9MazewbaPR) | program-controlled trading vault — an off-curve PDA driven by the upgradeable program [`va1t8sdG…yGdH`](https://solscan.io/account/va1t8sdGkReA6XFgAeZGXmdQoiEtMirwy4ifLv7yGdH), holding transient balances of many pump.fun coins. Its Buddy balance read **14,313,631** in the largest-accounts snapshot and **0** in a by-owner query moments later — a bot cycling positions, not a community holder. Surfaced by the top-20 sweep below | yes |
| — | burn address: **none**. `1nc1nerator…` holds no account for this mint; the 32,538,765.51 missing from supply were destroyed with Token-2022 `Burn` (supply reduction), so there is no burned balance to exclude | n/a |

### Top-20 sweep

Done with the archival RPC (2026-08-17). `getTokenLargestAccounts` returned the
20 largest token accounts (each above 13M Buddy); classifying every account's
authority as on-curve (a keypair wallet) versus off-curve (a program-derived
account) found exactly **two non-person holders** in the top 20:

- **rank 1** — the PumpSwap pool vault above (`3MePuztv…`, authority `3HmXpoWk…`);
- **rank 18** — the trading vault `4kPFFQZJ…` just added.

The other eighteen are individual, on-curve wallets. Both non-person holders are
excluded, so the exclusion set is complete for the current holder distribution:
the four pool/infrastructure accounts plus this trading vault are the only
contracts among the largest holders.

**This is a rehearsal, not the binding list.** The snapshot is read at a slot
chosen at launch prep, and holder balances — a trading bot's especially — differ
slot to slot. Whatever slot is chosen, this sweep must be re-run against it and
every non-person holder it surfaces excluded. `scripts/snapshot.ts` excludes by a
static list, seeded from this section (§1 + §5); that list is what has to be
confirmed against the snapshot slot before the root is published.

---

## How to use this

Link it from the pre-commitment document and from the claim site. When someone
asks "why does this new token deserve the old one's story", the answer should be
a link, not an argument.

Two things to keep in mind while writing it:

**Stick to what is documented.** Transactions, timestamps, archived pages. Skip
speculation about motives — the transaction history is more damning than any
adjective, and speculation is what gives someone grounds to complain.

**Exclusions need reasons, not just addresses.** Every wallet you leave out of
the snapshot is someone you are denying restitution to. Publish the reason next
to each one so the decision can be argued with.
