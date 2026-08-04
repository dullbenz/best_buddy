# Deployment runbook

Everything you have to do, in order, to get this live. Read the whole thing once
before starting step 1 — several steps are irreversible and a couple of them
have to happen within minutes of each other.

Times are rough estimates for one person who has done the devnet rehearsal.

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

You should see 7 Rust unit tests and 28 integration tests pass. **Do not
continue if anything fails.** These cover the claim-then-exit attack, every
expiry sweep, and the secp256k1 verification — they are the reason to trust the
contract.

### 0.3 Get a real program ID

```bash
solana-keygen new --no-bip39-passphrase -o target/deploy/buddy_distributor-keypair.json
```

Put the printed address into `Anchor.toml` (both `[programs.*]` entries) and
into `declare_id!` in `programs/buddy-distributor/src/lib.rs`, then rebuild.
**Back this keypair up offline.** Losing it means you can never upgrade the
program; leaking it means someone else can.

### 0.4 Decide who holds the two authorities

There are two separate powers, and they deserve separate decisions.

**The config authority** runs `initialize`, `fund_vault` and `lock_config`. In a
solo launch that is one script, roughly thirty seconds, moving your own
dev-bought tokens into a contract. No community money exists in the vault yet,
so a multisig here protects nobody from anything — **your own wallet is fine.**

**The upgrade authority** can replace the program's code and bypass the config
lock entirely. By the time it matters the vault holds tokens that old holders
and influencers have a claim on, so this one is real. Two workable answers:

- **Solo (recommended if you have no multisig):** keep it on your wallet for a
  short, publicly stated window — **7 days** — then burn it permanently. Short,
  because during that week people genuinely are trusting you.
- **With a multisig:** transfer it to a [Squads](https://squads.so) vault at
  deploy and burn it after ~90 days. Longer window is defensible because no
  single person can push an upgrade.

Either way the burn date goes in the pre-commitment document, and anyone can
check you kept your word with `solana program show`.

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

---

## Phase 1 — Snapshot (day −1)

### 1.1 Pick a slot that is already in the past

Do **not** announce a future snapshot time. Telling the internet "old Buddy
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
`verify-snapshot.ts` themselves. Note the `merkleRoot`; it goes on chain next.

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

### 2.1a Deal with the upgrade authority

Solana programs are upgradeable by default. Until this is resolved, the keypair
on your laptop can replace the contract's code with anything — which means
`lock_config` is a promise rather than a guarantee, and anyone who checks will
correctly say so. The `Authority` line printed above is the first thing a
sophisticated holder looks at.

**If you have a multisig,** transfer it now, in the same session as the deploy:

```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_MULTISIG_VAULT>
```

**If you are solo,** there is nothing to transfer — you keep it for the short
window you published, and step 2.1b is the whole plan. Say so plainly in the
announcement rather than leaving people to discover it: *"I hold the upgrade
authority until [date], then it is burned. Verify with `solana program show`."*

Either way, re-run `solana program show` and confirm the `Authority` line says
what you told people it says.

### 2.1b Burn it on the date you promised

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
```

This is irreversible. Afterwards `solana program show` reports `Authority: none`
and the code can never change again — including by you, including to fix a bug.
That is the point.

Run it through the multisig on the date published in the pre-commitment
document, post the transaction signature, and let people verify. A promise to
burn that quietly never happens is worse than never having made it.

### 2.2 Create the coin on pump.fun

Use the same icon and the story. Set socials to the real community channels.

### 2.3 Dev-buy in the same transaction as creation

pump.fun's create flow includes an initial buy — use it. Buying later means
paying a higher price on the bonding curve and looking like an outside sniper.

Size it as money you can lose entirely. As a sanity anchor, the old token's
liquidity is around $26k, so a dev-buy in the low tens of SOL is proportionate;
much larger mostly buys your own slippage.

### 2.4 Move the tokens into the distributor

```bash
RPC_URL=<rpc> KEYPAIR=<authority.json> REWARD_MINT=<new-mint> DEV_WALLET=<dev-wallet> OLD_ROOT=<hex> INF_ROOT=<hex> OLD_ALLOC=<n> INF_ALLOC=<n> SIGNER_ALLOC=<n> DEV_ALLOC=<n> SIGNER_PUBKEY=0480ba01...4779 SOURCE_TOKEN_ACCOUNT=<your-ata> npx ts-node scripts/deploy-init.ts
```

That is a **dry run**. It prints the full plan. Read every number against your
published document, then re-run with `EXECUTE=1` to send the three
transactions: `initialize`, `fund_vault`, `lock_config`.

> `lock_config` is irreversible. After it, allocations, Merkle roots, deadlines
> and the signer key can never change — including by you. That is the point.

### 2.5 Create the dev stream

```bash
RPC_URL=<rpc> KEYPAIR=<any-funded-keypair.json> CLIFF_DAYS=30 npx ts-node scripts/create-dev-stream.ts
```

Anyone can call this; it can only produce the terms fixed at init. Do it
immediately so the dev wallet is visibly empty from the first block.

### 2.6 Route creator fees into bucket 1

In the pump.fun creator dashboard, split creator fees so a meaningful share
(recommended: 50% or more) goes to the community. Two options:

- **Simplest:** point the split at a wallet the multisig controls, and have it
  periodically call `notify_token_rewards` / `notify_sol_rewards`.
- **Better if supported:** point it directly at the SOL vault PDA. Lamports sent
  there still need a `notify_sol_rewards` call to be counted, so a small
  cron that reconciles the vault balance is worth writing either way.

Check pump.fun's current fee-split UI at the time — it changed in January 2026
and may have changed again.

### 2.7 Announce

Post the program ID, the config PDA, the snapshot files, the pre-commitment
doc, and the receipts dossier — all at once.

---

## Phase 3 — Claims live

### 3.1 Deploy the app

```bash
cd app && cp -r ../snapshot/proofs.json public/proofs/old-holders.json && npm run build
```

Copy the influencer proofs to `public/proofs/influencers.json`, set
`VITE_RPC_URL` and `VITE_PROGRAM_ID`, and deploy `dist/` to any static host
(Vercel, Netlify, Cloudflare Pages). **Use a paid RPC** — the public endpoint
returns 403 to browsers.

### 3.2 Start the influencer clock

The 72-hour window began at `claims_start`, i.e. when you initialized. Notify
every influencer immediately and publicly, so the countdown is visible to
everyone and nobody can claim they were never told.

### 3.3 Contact the old holders

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
| Dev-buy | your call — money you can lose |
| Security review | varies; budget for it |
| RPC + hosting | ~$50–200/month |

## Pre-launch checklist

- [ ] All 35 tests pass
- [ ] Devnet rehearsal completed end to end
- [ ] Security review done and published
- [ ] Program keypair backed up offline
- [ ] Upgrade-authority holder decided (solo + 7-day burn, or multisig + 90-day burn)
- [ ] Upgrade-authority plan published with a dated burn commitment
- [ ] Upgrade authority transferred to the multisig in the same session as deploy
- [ ] Receipts dossier published
- [ ] Pre-commitment document published **before** launch
- [ ] Snapshot slot chosen retroactively, anchored to a documented event
- [ ] Snapshot taken from an archival RPC, published, independently verified
- [ ] Exclusions list includes both AMM pool vaults and the old dev wallets
- [ ] Influencer list published with amounts
- [ ] Dev-buy sized as losable money
- [ ] No public material promises returns, profit, or price
