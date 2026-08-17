# Deployment runbook

The detailed reference for launch mechanics.

> **Looking for the full picture?** [TO-THE-MOON.md](../TO-THE-MOON.md) is the
> master checklist covering setup, rehearsal, preparation, launch and the first
> month. This file expands on the launch steps within it; the two agree, and if
> they ever disagree the master checklist is correct.

Read the whole thing once before starting — several steps are irreversible and a
couple of them happen minutes apart.

---

## Phase 0 — Before you touch mainnet

### 0.1 Install the toolchain (once)

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && avm install 0.31.1 && avm use 0.31.1
```

Add Solana to your PATH permanently (`~/.zshrc`):

```bash
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
```

> **Known snag.** The `anchor` wrapper installed by `avm` re-pins Solana to the
> version it prefers (2.1.0), whose bundled cargo is too old to parse some
> current crates. If `anchor build` fails with `feature edition2024 is required`,
> run `agave-install init stable` and then invoke the binary directly as
> `~/.avm/bin/anchor-0.31.1 build`. Every `anchor` command below works that way.

### 0.2 Build and test

```bash
cd best_buddy && npm install --legacy-peer-deps && ~/.avm/bin/anchor-0.31.1 build
```

```bash
cargo test -p buddy-distributor --lib && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

You should see 7 Rust unit tests and 37 integration tests pass. **Do not
continue if anything fails.** These cover the claim-then-exit attack, every
expiry sweep, and the secp256k1 verification — they are the reason to trust the
contract.

### 0.3 Get a real program ID

```bash
solana-keygen new --no-bip39-passphrase -o target/deploy/buddy_distributor-keypair.json
```

Put the printed address into `Anchor.toml` (both `[programs.*]` entries) and
into `declare_id!` in `programs/buddy-distributor/src/lib.rs`, then rebuild.

**Back this keypair up offline — but understand what it does and does not
do.** The program's address *is* this key's public key, and the CLI is precise
about when it is needed: `--program-id` "must be a signer for initial deploys,
can be an address for upgrades". So it signs exactly one transaction ever, the
one that creates the program account.

| | before the first deploy | after it |
|---|---|---|
| lose it | you lose that address; generate another and start over | nothing — upgrades and closes need the upgrade authority, not this |
| leak it | someone can deploy *their* program at your address first | nothing — the account exists and cannot be created twice |

The window where it matters is between generating it and deploying it, so back
it up **before** the deploy, not after. Once deployed it is largely spent.

The key that actually carries risk is the **upgrade authority** in §0.4, which
can replace the whole program regardless of what the config says — right up
until you burn it at launch.

### 0.4 The two authorities

There are two separate powers, and they deserve separate decisions.

**The config authority** runs `initialize`, `fund_vault` and `lock_config`. In a
solo launch that is one script, roughly thirty seconds, moving your own
dev-bought tokens into a contract. No community money exists in the vault yet,
so a multisig here protects nobody from anything — **your own wallet is fine.**

**The upgrade authority** can replace the program's code and bypass the config
lock entirely. By the time it matters the vault holds tokens that Legacy Buddy holders
and influencers have a claim on, so this one is real.

**This project burns it on launch day, before announcing.** No multisig, no
window, no "we'll burn it later" — `solana program show` reads
`Authority: none` from the moment anybody hears about the token.

That is the strongest available signal and there is no promise to keep track of.
It also means **the code can never be fixed**, and it has to keep working until
the 2030 signer deadline. Two consequences you are accepting:

- The security review (0.6) stops being best practice and becomes the only
  safety net you have.
- The devnet rehearsal (0.5) is the last moment a bug is cheap.

Do both properly. After the burn there is no version two.

### 0.5 Rehearse on devnet

Follow [DEVNET-REHEARSAL.md](./DEVNET-REHEARSAL.md) — a scripted dress run on
the free practice network with fake money.

**Do not skip this.** The first time you run these commands should not be the
time real money is involved, and if you are burning the upgrade authority it is
the last point at which a bug is still fixable.

### 0.6 Get a security review

An unaudited program holding the community's restitution fund is a rug of a
different flavour. Budget for a professional review, publish the report, and
fix what it finds before mainnet.

### 0.7 Collect the receipts

Fill in `docs/RECEIPTS.md` with Solscan links to the old dev's dumps, Wayback
Machine captures of the abandoned socials, and dated community screenshots.
This is your defence if the old dev complains, and it is the evidence behind
every wallet you exclude from the snapshot. Do it now, while the links are
live.

### 0.8 Publish the pre-commitment document

Edit `docs/PRE-COMMITMENT.md` with your real numbers and publish it publicly —
site, GitHub, pinned post. **Before launch, not after.** Its entire value is
that it was published while you could still have chosen differently.

### 0.9 Prepare the transparency material

Three things ship with the launch, not after it:

- **[VERIFY.md](./VERIFY.md)** — fill in every address. It is also rendered live
  on the site under the **Verify** tab, which runs the checks it can in the
  visitor's browser and says "could not read" rather than guessing when it
  cannot.
- **The landing page and the How it works tab** —
  `app/src/components/Landing.tsx` and `app/src/components/HowItWorks.tsx`.
  Read both end to end and make sure they match what you actually built. These
  are the only two places the site asserts something in prose instead of
  reading it from chain, so they are the only two that can be wrong silently.
  Both already switch tense on the live upgrade-authority read, so before the
  burn they say so rather than claiming it.
- **[CONTENT.md](./CONTENT.md)** — TikTok scripts, the X thread, and the ask for
  independent verification. Check every placeholder is filled and no post
  promises a price outcome.

The independent-verification ask matters more than any of your own posts. One
developer with no stake saying "I checked, it holds up" outweighs everything you
can say about yourself. Post it where technical people actually are.

---

## Phase 1 — Snapshot

### 1.1 Pick a slot that is already in the past

Do **not** announce a future snapshot time. Telling the internet "Legacy Buddy
holders get an airdrop, snapshot in 24 hours" is an instruction to go buy the
old token: you would pump it, hand restitution to farmers instead of the people
who were actually wronged, and route the extra trading fees straight to the dev
you are trying to strand.

Snapshot retroactively instead, and choose the slot for a reason that has
nothing to do with price — so that "you cherry-picked the moment" has an answer:

> "Snapshot taken at slot 312,845,001 — the block containing the creator's final
> sell transaction, `<solscan link>`."

Other defensible anchors: the block of the last official project communication,
or midnight UTC on the day the socials went dark. Whatever you pick, state the
reasoning next to the number.

This gets you both properties: farming is impossible because the moment has
already passed, and the choice is justified by a documented event rather than by
you. The published CSV lets anyone re-derive the same result.

### 1.2 Fill in the exclusions

Edit `EXCLUSIONS` in `scripts/snapshot.ts`. At minimum:

- the old dev's wallets, with a receipt reference
- the PumpSwap pool vault, and the Meteora pool vault (otherwise the AMM claims
  a large share of restitution meant for people)

### 1.3 Take it

You need an **archival** RPC (Helius, Triton, QuickNode). The public endpoint
only serves current state and will silently give you a different holder set.

```bash
RPC_URL=<archival-rpc> BUCKET_TWO_ALLOCATION=<base-units> npx ts-node scripts/snapshot.ts
```

### 1.4 Verify and publish

```bash
npx ts-node scripts/verify-snapshot.ts
```

Publish the entire `snapshot/` directory — `manifest.json`, `allocations.json`,
`proofs.json`, `holders.csv`, `excluded.csv`. Invite people to re-run
`verify-snapshot.ts` themselves. Publishing only the eligible addresses would
let you drop anyone without it showing, so every exclusion ships with its
reason. Note the `merkleRoot`; it goes on chain next.

### 1.5 Build the influencer tree

Write `influencers.csv` (`address,amount`), then:

```bash
npx ts-node scripts/build-tree.ts influencers.csv snapshot/influencers
```

Publish that too. No hidden allocations — the transparency is the point, and it
also lets each influencer disclose their compensation properly.

---

## Phase 2 — Launch day

This is the tight sequence. Have every command ready in a terminal first.

### 2.1 Deploy the program

```bash
solana config set --url mainnet-beta && ~/.avm/bin/anchor-0.31.1 deploy --provider.cluster mainnet
```

Costs roughly 3–5 SOL. Verify:

```bash
solana program show <PROGRAM_ID>
```

### 2.1.1 Do NOT burn yet — verify first

You are burning the upgrade authority today, but **not on this line.**

It is tempting to pass `--final` straight to the deploy. Don't. Between
deploying and finishing `lock_config` there are three transactions and a dozen
parameters, and if any of them is wrong you want the option to fix the code
rather than abandoning a program that already holds your tokens.

The window between deploy and burn costs you nothing in trust, because **nobody
knows the token exists yet.** You announce in 2.7, after the burn. Keep this gap
to minutes, and do not post anything until 2.1b is done.

If you find a problem before announcing: deploy a fresh program at a new
address, eat the ~4 SOL, and carry on. That escape hatch closes at 2.1b.

### 2.2 Create the coin on pump.fun

Use the same icon and the story. Set socials to the real community channels.

### 2.3 The launch buy, in the same transaction as creation

pump.fun's create flow includes an initial buy (their "dev-buy" field) — use
it. Buying later means paying a higher price on the bonding curve and looking
like an outside sniper.

Size it as money you can lose entirely. As a sanity anchor, the old token's
liquidity is around $26k, so a launch buy in the low tens of SOL is
proportionate; much larger mostly buys your own slippage.

**Whatever this buy acquires is the distributor total.** All of it goes into
the contract in §2.4, split 15 / 50 / 10 / 25 across legacy holders,
influencers, the 2014 signer and the team. Compute the four base-unit amounts
from the real balance the buy produced, not from an estimate, and publish them
in the pre-commitment document before going further.

### 2.4 Move the tokens into the distributor

```bash
RPC_URL=<rpc> KEYPAIR=<authority.json> REWARD_MINT=<new-mint> DEV_WALLET=<team-multisig-vault> OLD_ROOT=<hex> INF_ROOT=<hex> OLD_ALLOC=<n> INF_ALLOC=<n> SIGNER_ALLOC=<n> DEV_ALLOC=<n> SIGNER_PUBKEY=0480ba01...4779 SOURCE_TOKEN_ACCOUNT=<your-ata> npx ts-node scripts/deploy-init.ts
```

`DEV_WALLET` is the team's **Squads vault address** (TO-THE-MOON §2.3a), not
any member's wallet. It becomes the team stream's beneficiary and is frozen by
the lock, so verify it against the recorded vault address before `EXECUTE=1`.

That is a **dry run**. It prints the full plan. Read every number against your
published document, then re-run with `EXECUTE=1` to send the three
transactions: `initialize`, `fund_vault`, `lock_config`.

> `lock_config` is irreversible. After it, allocations, Merkle roots, deadlines
> and the signer key can never change, including by you. That is the point.

> **Fund only through `fund_vault`.** `lock_config` checks the pool's
> `reserved_token` counter, which rises only inside `fund_vault`, and not the
> vault's raw token balance. Tokens sent to the vault address with an ordinary
> wallet transfer, or donated before launch, do not count towards the
> committed total and the lock will refuse. That refusal is protecting you:
> anything the vault holds above `reserved_token` is untracked and belongs to
> the staking pool the moment anyone calls `sync_token_rewards`, so counting it
> as bucket backing would promise the same tokens twice. `fund_vault` stops
> working the instant the config locks, so there is no second chance to top up.

### 2.5 Create the team stream

```bash
RPC_URL=<rpc> KEYPAIR=<any-funded-keypair.json> npx ts-node scripts/create-dev-stream.ts
```

Anyone can call this, and it can only produce the terms fixed at init: the
beneficiary (the team multisig vault), the allocation, the 12-month duration
and the cliff all come from the config, which `lock_config` already froze.
There is no cliff argument, so the caller cannot choose the team's vesting
schedule by getting here first. Set the cliff with `DEV_CLIFF_DAYS` on
`deploy-init.ts` in §2.4, where it is still open to inspection against your
published document.

Run it immediately so it is visible from the first block that no team wallet
holds anything.

> Withdrawing vested tokens later is a `stream_withdraw` executed through
> Squads — the vault must sign as beneficiary, and the destination token
> account must be owned by the vault, so a withdrawal cannot land anywhere
> but the multisig's own account. The site cannot do this for the team, and
> that is a feature: it is the multisig threshold doing its job.
>
> `scripts/team-withdraw.ts` does the work: with no arguments it reports what
> has vested and prints the instructions for the Squads transaction builder;
> `ACTION=propose MULTISIG=<msig> KEYPAIR=<member.json>` creates the proposal
> on chain and approves it as that member, `ACTION=approve` / `ACTION=execute`
> finish it from the command line if you prefer that to the app. It refuses
> to propose against the wrong multisig: the derived vault must equal the
> stream's beneficiary.

### 2.5a Set the pump.fun fee split — irreversible, so do it before the burn

Full mechanism: [FEES.md](./FEES.md). Two self-service transactions signed by
you as coin creator; pump.fun approval is not involved.

```
create_fee_sharing_config        # shareholders default to [(you, 100%)]
update_fee_shares_v2             # 90% -> SOL vault PDA, 10% -> team multisig vault
```

> **`update_fee_shares_v2` runs exactly once.** pump.fun's program revokes its
> own admin straight afterwards and freezes the shareholder list forever. A
> share pointing somewhere unpayable can block every future distribution
> permanently, with no way to edit it.
>
> Never run this on the real coin before the throwaway-coin rehearsal has proved
> the identical configuration works. It cannot be rehearsed on devnet —
> pump.fun has no devnet deployment.

Doing this *before* the burn is deliberate: if the split misbehaves, the program
is still upgradeable and you can redeploy. Afterwards you cannot.

### 2.6 Verify everything, then burn the upgrade authority

**This is the point of no return. Read the checks before running the command.**

Confirm the on-chain state matches your published document exactly:

```bash
solana program show <PROGRAM_ID> && spl-token balance --address <VAULT_PDA>
```

Then walk the dashboard locally against mainnet and check, line by line:

- the vault holds the full committed total, and the four allocations are the
  published 15 / 50 / 10 / 25 of it
- `locked` reads true
- both Merkle roots match the published snapshot files
- both deadlines are the dates you published
- the team stream exists, with the right total and cliff, and its beneficiary
  is the team multisig vault
- the original-signer key matches the 2014 transaction
- the fee split reads 90% SOL vault / 10% team multisig and the sharing-config
  admin is revoked

Anything wrong? Fix it now. You can still redeploy at a new address for ~4 SOL.
After the next command you cannot.

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

Confirm it took:

```bash
solana program show <PROGRAM_ID>
```

`Authority` must now read `none`. The code can never change again — not by you,
not by anyone, not to fix a bug. Save that transaction signature; it goes in the
announcement.

### 2.7 Announce

Post all at once: program ID, config PDA, snapshot files, pre-commitment doc,
receipts dossier, and the burn transaction signature.

Lead with the burn. `Authority: none` is the single most checkable claim you
have, it takes someone ten seconds to confirm, and it is the exact thing the
last dev could never have said.

Then, in order:

1. Point people at `mybestbuddy.fun/verify` — the live checks, not your word.
2. Post the independent-verification ask from [CONTENT.md](./CONTENT.md) where
   developers and auditors will see it.
3. Run the TikTok and thread scripts from the same file.

Do not let the announcement be only your own voice. The goal for week one is
somebody unconnected to you posting "I ran the checks, they hold up." Nothing
you write yourself substitutes for that.

---

## Phase 3 — Claims live

### 3.1 Deploy the app

```bash
cd app && cp ../snapshot/proofs.json public/proofs/old-holders.json && cp ../snapshot/holders.csv ../snapshot/excluded.csv ../snapshot/manifest.json ../snapshot/influencers.csv ../snapshot/influencers-manifest.json public/snapshot/ && npm run build
```

Copy the influencer proofs to `public/proofs/influencers.json`, set
`VITE_RPC_URL` and `VITE_PROGRAM_ID`, and deploy `dist/` to any static host
(Vercel, Netlify, Cloudflare Pages). **Use a paid RPC** — the public endpoint
returns 403 to browsers.

### 3.2 Start the influencer clock

The 72-hour window began at `claims_start`, i.e. when you initialized. Notify
every influencer immediately and publicly, so the countdown is visible to
everyone and nobody can claim they were never told.

### 3.3 Contact the Legacy Buddy holders

You cannot DM them. Post everywhere the old community gathered, and ask people
to spread it. This is why the window is 30 days rather than 72 hours.

---

## Phase 4 — Ongoing

### 4.1 Run the sweeps

Permissionless, so anyone can run them, but do it yourself promptly and announce
each one as a community win.

- after 72h: `sweep_influencers`
- after 30 days: `sweep_old_holders`
- after 2030-12-31: `sweep_original_signer`

The old-holder sweep credits the pool instantly, because its claims paid
instantly. The other two open a **community stream** on the schedule their
claimants would have had — 30 days for influencers, 12 months for the signer —
and the pool is credited by `release_community_stream`, a permissionless crank
on the Fund Pool tab. A forfeited stream is never a lump sum for anyone.

### 4.2 Keep feeding bucket 1

Route fees regularly. The staking pool is the engine — if it stops being fed,
the reason to stay disappears.

### 4.3 Weekly transparency posts

Generate them from chain data, not from your own bookkeeping. The dashboard
already shows everything; the post is just a summary with the link.

---

## If the 2014 signer shows up

Send them `scripts/sign-claim.ts`:

```bash
npx ts-node scripts/sign-claim.ts message <their-solana-address>
```

They sign that exact string with the Bitcoin key. Verify before submitting:

```bash
npx ts-node scripts/sign-claim.ts verify <address> <base64-sig> <uncompressed-pubkey-hex>
```

Then anyone can submit `claim_original_signer`. The signature is bound to their
chosen address, so relaying it is safe.

Their tokens stream over 12 months and are theirs — including the right to sell
every one of them. You committed to that in writing at launch. Do not
re-litigate it if it happens.

---

## Cost summary

| Item | Cost |
|---|---|
| Program deployment | ~3–5 SOL |
| Account rent (config, pool, vaults) | < 0.1 SOL |
| Launch buy (pump.fun dev-buy) | your call — money you can lose |
| Security review | varies; budget for it |
| RPC + hosting | ~$50–200/month |

## Pre-launch checklist

- [ ] All 44 tests pass
- [ ] Devnet rehearsal completed end to end
- [ ] Security review done and published
- [ ] Program keypair backed up offline
- [ ] Pre-commitment doc states the program will be immutable from launch
- [ ] Pre-commitment doc states the program is immutable from launch
- [ ] Upgrade authority burned (`--final`) after init and before announcing
- [ ] `solana program show` confirmed to read `Authority: none`
- [ ] Receipts dossier published
- [ ] Pre-commitment document published **before** launch
- [ ] Snapshot slot chosen retroactively, anchored to a documented event
- [ ] Snapshot taken from an archival RPC, published, independently verified
- [ ] Exclusions list includes both AMM pool vaults and the old dev wallets
- [ ] Influencer list published with amounts
- [ ] Launch buy sized as losable money
- [ ] Distributor total (what the launch buy acquired) published, with the
      15 / 50 / 10 / 25 split computed from it in base units
- [ ] Team multisig created at Squads, 2-of-3, vault address recorded;
      `DEV_WALLET` set to the vault
- [ ] No public material promises returns, profit, or price
- [ ] Fee chain proved end to end on a throwaway mainnet coin, including a
      Squads vault receiving the 10% share
- [ ] Fee split set 90% vault / 10% team multisig via `update_fee_shares_v2`
      and confirmed frozen
- [ ] VERIFY.md filled in with real addresses and published
- [ ] Verify and How it works tabs live on the site and read end to end
- [ ] Independent-verification ask posted where technical people will see it