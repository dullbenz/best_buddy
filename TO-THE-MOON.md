# To the moon — the complete checklist

Everything to be done for token launch, start to finish, in order.

This is the master list. Other docs go deeper on individual steps and are linked
where relevant, but nothing is required that isn't on this page.

**Read the whole thing once before starting.** Several steps are irreversible,
two of them happen minutes apart, and one of them can never be undone by anyone
including you.

---

## Ground rules

Three things that decide whether this works, before any command:

**Nothing is announced until the contract is immutable.** The order is build →
verify → burn → *then* speak. Reversing it means asking people to trust you
during the window where you could still change everything.

**Never promise a price outcome.** Not in a post, not in a DM, not on a call.
Describe mechanics. Every public word you say also lands on the influencers
repeating it.

**Every claim you make must be checkable in under a minute.** If you can't point
at a command or an address, cut the claim.

---

## Section 0 — Setup (once, ~1 hour)

### 0.1 Back up the program keypair — do this first

```bash
cp /Users/dullbenz/Projects/Personal/best_buddy/target/deploy/buddy_distributor-keypair.json ~/BUDDY-PROGRAM-KEYPAIR-BACKUP.json
```

This file is your contract's identity. It lives in `target/`, a build folder
that `anchor clean` wipes without asking. Put a copy in a password manager or
an encrypted drive. Never in Git, never in Google Drive, never in a chat.

Current program ID: `5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp`

> **This is a devnet identity, not the launch one.** The roots a claim is
> checked against can only be set at `initialize`, and only once, so putting
> test wallets into the claim lists meant a new config account — which means a
> new program id, because the config PDA is derived from it. The previous
> devnet program was closed and its rent reclaimed.
>
> **Generate a fresh keypair for mainnet at §0.1 on launch day** and update
> `declare_id!` and both `Anchor.toml` entries to match, exactly as written
> above. Deploying to mainnet under this id would put the real token behind a
> key that has been sitting in a development `target/` directory.

### 0.2 Confirm the toolchain works

```bash
cd /Users/dullbenz/Projects/Personal/best_buddy && npm test
```

Expect **47 passing**. Then:

```bash
cargo test -p buddy-distributor --lib
```

Expect **14 passed**. If either fails, stop and fix it before anything else.

> **The toolchain snag.** `avm`'s `anchor` wrapper silently re-pins Solana to
> 2.1.0, whose cargo can't parse some of our dependencies. If a build fails with
> `edition2024 is required`, run `agave-install init stable`, then use
> `~/.avm/bin/anchor-0.31.1` directly instead of `anchor`. Every command in
> these docs already does.

### 0.3 Push to GitHub — done

Repo: `github.com/dullbenz/best_buddy`, currently **private**.

Private is sensible while the receipts and numbers are still being assembled.
Two consequences to keep in mind:

**The repo must be public before you announce.** Not after. Two of the six
checks on the Verify page — reproducing the snapshot, and confirming the
deployed bytecode matches the source — require cloning it. `solana-verify`
cannot read a private repo. Announcing while it is private means telling people
to verify and then handing them a 404, which reads worse than never having
offered.

**Actions minutes are metered on private repos.** 2,000/month on the free tier;
public repos are unlimited. The `program` job compiles Rust, so budget roughly
10–25 minutes per push depending on cache hits. Fine at a normal pace, but avoid
pushing in a tight loop.

Flip it when you are ready — this is also step 4.8:

```bash
gh repo edit dullbenz/best_buddy --visibility public --accept-visibility-change-consequences
```

### 0.4 Get both sites live

Two environments, two branches — full detail in
[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md):

| | Staging | Production |
|---|---|---|
| Branch | `develop` | `main` |
| URL | `staging.mybestbuddy.fun` | `mybestbuddy.fun` |
| Chain | devnet | mainnet |
| Access | basic auth | public |

**Work happens on `develop`.** Push there, check `staging.mybestbuddy.fun`, then
PR into `main` when it looks right. Both pipelines refuse to build a site
pointed at the wrong chain.

Staging's basic auth needs a Cloud Function, because Firebase Hosting has no
built-in auth — which means upgrading to the Blaze plan. At staging traffic the
cost rounds to zero and your $300 credit covers it, but you do have to attach
billing.

Then follow [docs/CICD.md](docs/CICD.md) for the Firebase setup, deploy
credential, GitHub secrets, and DNS.

> **You already have the project.** A Firebase project *is* a Google Cloud
> project — same thing, two consoles. So you add Firebase to the GCP project
> holding your $300 credits rather than creating anything new:
> `firebase projects:addfirebase <your-gcp-project-id>`. One project, one
> billing account, no question about whether the credits apply.

Set these in **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | the service-account JSON |
| Variable | `FIREBASE_PROJECT_ID` | your Firebase project ID |
| Variable | `VITE_RPC_URL` | your Helius RPC URL |
| Variable | `VITE_PROGRAM_ID` | `5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp` |
| Secret | `STAGING_PASSWORD` | the staging basic-auth password |
| Variable | `STAGING_RPC_URL` | a devnet RPC endpoint |

`.firebaserc` is already filled in: project `influential-bit-411408`, sites
`mybestbuddy` and `mybestbuddy-staging`. CI blocks `main` and `develop` if a
`REPLACE_WITH_YOUR_*` placeholder ever reappears.

> Firebase also serves both sites on `<site-id>.web.app` and cannot be told not
> to. The app redirects those to the custom domain, and staging's auth gate
> covers all hosts — see [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) §3.

The site will show "Could not read the distributor". That's correct: the program
isn't deployed yet, and it proves the site is live and talking to the chain.

### 0.5 Get a paid RPC

Sign up at [helius.dev](https://helius.dev). You need it for two different
things:

- **archival access** — to read who held the old token at a past slot
- **a browser key** — the public endpoint returns 403 to web pages

Use **two separate keys.** Restrict the browser one to `mybestbuddy.fun` and
rate-limit it, because anything in a frontend build is readable by anyone.

This is your main running cost, roughly $50/month, and the Google credits don't
cover it.

---

## Section 1 — Rehearsal (~1 hour)

Do not skip this section. The contract will be immutable, so this is the last
point where a mistake is free.

### 1.1 Deploy to devnet

```bash
solana config set --url devnet && solana airdrop 5
```

```bash
~/.avm/bin/anchor-0.31.1 build && ~/.avm/bin/anchor-0.31.1 deploy --provider.cluster devnet
```

### 1.2 Run the full dress rehearsal

```bash
RPC_URL=https://api.devnet.solana.com KEYPAIR=~/.config/solana/id.json npx ts-node scripts/devnet-rehearsal.ts
```

It creates a mock token, invents holders and influencers, and walks the entire
sequence. Four lines prove the guarantees rather than assert them:

```
✓ further funding is rejected (ConfigLocked) — the lock holds
✓ the same wallet cannot claim twice
✓ held back N as boost, locked until maturity (per lock-up)
✓ a lock-up cannot be demoted before it matures
```

Full guide, including how to re-run it: [docs/DEVNET-REHEARSAL.md](docs/DEVNET-REHEARSAL.md).

> **Done, and then some.** The full end-to-end campaign in
> [docs/E2E-DEVNET-CAMPAIGN.md](docs/E2E-DEVNET-CAMPAIGN.md) ran every scenario
> above plus every rejection path, sweep, forfeit and maturity on devnet —
> 69 pass, 2 documented notes, 0 fail — with a transaction signature for each.
> Time-gated paths used the `fast-clock` build (test-only cargo feature; the
> mainnet build provably excludes it). What remains untestable before launch
> is exactly the pump.fun fee chain (§1.5) and your own Phantom click-through.

### 1.3 Click through the real app against devnet

Locally:

```bash
cd app && VITE_RPC_URL=https://api.devnet.solana.com VITE_PROGRAM_ID=5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp npm run dev
```

Or push to `develop` and use `staging.mybestbuddy.fun`, which is the same build
against the same chain — better, because it also exercises the real hosting,
headers and domain.

Open every tab. Try a claim. Try staking. **Do it on your phone too** — most of
your community will be on one, and staging is reachable from one.

### 1.4 Practise the deploy script's dry run

Run `scripts/deploy-init.ts` without `EXECUTE=1` (command in
[docs/DEVNET-REHEARSAL.md](docs/DEVNET-REHEARSAL.md) §5). Get used to reading
its output carefully now, so that reading it under pressure on launch night is
routine.

### 1.5 Rehearse the fee path — devnet dry-run first, then a mainnet throwaway coin

**This one is not optional.** pump.fun's programs (`pump`, `pump_amm`,
`pump_fees`) are live on devnet, so the fee chain gets rehearsed twice: a
devnet dry-run first, then the mainnet throwaway coin, which remains the
definitive final rehearsal because devnet is not guaranteed to match mainnet's
program version or configuration.

Setting the real coin's fee split is a one-shot we can never correct (§4.6).
The only way to know the configuration works is to have already watched it
work.

**The devnet dry-run:** create a coin on devnet pump.fun with a minimal buy,
`create_fee_sharing_config`, set the 90/10 split onto the devnet SOL vault PDA
and a devnet team multisig vault, trade a little, then run the crank and sync
from the Fund pool tab and watch both sides of the split get credited. The
whole chain, for pocket change.

**Then the mainnet throwaway coin:**

1. Create a junk coin on pump.fun with a minimal buy.
2. `create_fee_sharing_config`, then set a 90/10 split with a test PDA of the
   same shape as the real SOL vault, and the 10% pointing at a **test Squads
   vault** — the real 10% goes to the team multisig (§2.3a), and both
   recipients are program-owned accounts, so this rehearsal must prove that
   *both* kinds can actually be paid.
3. Trade it a little so fees actually accrue.
4. Run the whole chain from the Fund pool tab and confirm value lands and gets
   credited on both sides of the split.
5. **Note which form the payout arrived in.** The docs say a SOL-quoted
   sharing distribution pays native lamports, wSOL unwrapped internally, which
   leaves `unwrap_wsol` as a safety net rather than a step on the critical
   path. Confirm it here, where surprises are cheap.

Budget a few tens of dollars. Cheap, against a mistake that would freeze the
community's fee stream permanently.

---

## Section 2 — Preparation (the slow part, days to weeks)

Steps 2.1–2.4 can all run in parallel. This section, not the launch, is where
the real work is.

### 2.1 Review the contract

The contract is immutable, so it has to be right before the burn — there is no
patch afterwards. The review standing behind it is a full devnet rehearsal (the
85-scenario campaign in [docs/E2E-DEVNET-CAMPAIGN.md](docs/E2E-DEVNET-CAMPAIGN.md),
with [docs/E2E-RETEST-PLAN.md](docs/E2E-RETEST-PLAN.md)) plus the contract's own
test suite, read alongside [docs/AUDIT-BRIEF.md](docs/AUDIT-BRIEF.md). The source
is public, so anyone can read it and report what they find.

### 2.2 Build the receipts dossier

Fill in [docs/RECEIPTS.md](docs/RECEIPTS.md): Solscan links to every dump,
Wayback captures of the creator's abandoned socials, dated screenshots.

**Do this now, while the links still work.** A deleted tweet you didn't archive
is worth nothing later. This is both your defence if the old dev objects and the
justification for every wallet you exclude from the snapshot.

### 2.3 Decide the numbers

Fill these into [docs/PRE-COMMITMENT.md](docs/PRE-COMMITMENT.md):

| Decision | Guidance |
|---|---|
| Launch-buy size | Money you can lose entirely. Size it against the legacy market's live liquidity, checked on DexScreener on launch day — it is an active market and the figure moves, so never work from a stale number. A buy far beyond that depth mostly buys your own slippage. This is pump.fun's "dev-buy" field, sent in the same transaction as creation (§4.3). |
| **Distributor total** | **The number of tokens the launch buy actually acquires, all of which goes into the contract through `fund_vault`.** The rehearsal fixture uses 200M as a stand-in; the real figure is only known after the buy executes, and every allocation below is a slice of it. Decide the percentages now, compute the base-unit amounts on launch day, publish both. |
| Bucket split | **Decided: 15 / 50 / 10 / 25** across Legacy Buddy holders, influencers, 2014 signer, the team. The four `*_ALLOC` amounts passed to `initialize` must sum to exactly the distributor total. |
| Team cliff | 30 days is the default (`DEV_CLIFF_DAYS`, frozen at init). |
| Creator fee split | 90% to the community vault, 10% to the team multisig. Set **once, irreversibly** — see [docs/FEES.md](docs/FEES.md). |
| Influencer list | Addresses and amounts. All published — no hidden deals. |

### 2.3a Create the team multisig (Squads)

The team's two revenue destinations — the 25% allocation stream and the 10%
creator-fee share — both point at a **multisig vault**, not any one member's
wallet. Two reasons, and they are the same reasons any team should:

- **No single member holds all the rights.** One compromised or rogue key
  cannot move the team's funds.
- **No single member can hold them up.** With a 2-of-3 threshold, any two
  signers can act when the third is unavailable.

Create it at [Squads](https://squads.so) (the standard Solana multisig; the
vault signs transactions through its proposal → approve → execute flow, which
is what lets it be the stream's beneficiary):

1. All three members create or designate a personal signing wallet.
2. Create a Squads multisig with those three keys, **threshold 2-of-3**.
3. Record the **vault address** — this is what goes into `DEV_WALLET` at §4.4
   and into the 10% fee share at §4.6. Not the multisig account address, and
   not any member's wallet: the *vault*.
4. Send it a little SOL and practise one full proposal → approve → execute
   round with all three members, so launch week is not the first time anyone
   has signed one.

**The launch wallet is unaffected.** Deploying, creating the coin, the launch
buy, `initialize`, `fund_vault`, `lock_config` — all of that stays on your
ordinary wallet, because pump.fun's creation flow and the deploy scripts need
a plain signer. Only the *destinations* of team money are the multisig.

> **How the team's tokens are claimed and withdrawn.** Both steps work with
> the multisig, and neither needs a program change:
>
> - *Claiming* the allocation is `create_dev_stream` (§4.5): permissionless,
>   run from any ordinary wallet. It opens the stream **to the vault** — the
>   tokens never pass through anyone's personal wallet.
> - *Withdrawing* vested tokens is `stream_withdraw`, which the vault itself
>   must sign — a browser wallet cannot connect *as* a vault, so the site's
>   My Buddy page deliberately cannot do this. Instead:
>
>   ```bash
>   RPC_URL=<rpc> npx ts-node scripts/team-withdraw.ts
>   ```
>
>   prints what has vested and the exact instructions for the Squads app's
>   transaction builder, and `ACTION=propose MULTISIG=<msig> KEYPAIR=<member.json>`
>   creates and part-approves the proposal directly; the other members approve
>   in the Squads app (or `ACTION=approve`), then anyone executes. The
>   program only ever pays a token account **owned by the vault**, so even a
>   compromised proposal cannot redirect the withdrawal. The proposal flow's
>   plumbing (vault signing via propose → approve → execute) is verified on
>   devnet. Everyone else's streams work from the site exactly as before.

### 2.4 Write the launch content

Everything is drafted in [docs/CONTENT.md](docs/CONTENT.md) — 60s and 30s TikTok
scripts, an 11-post X thread, FAQ answers, and the ask for independent
verification. Fill in the placeholders and record.

Also read `app/src/components/Landing.tsx` and
`app/src/components/HowItWorks.tsx` end to end and confirm every sentence
matches what you actually built. These two files are where the site makes
claims in prose rather than reading them from chain, so they are the only place
it can be wrong without the RPC catching it.

Both switch tense on the live upgrade-authority read: before the burn they say
the authority is *not* burned yet and call the commitment an unkept promise.
That is deliberate — the site is live from 0.4, weeks before launch — so do not
"fix" it by hardcoding the post-burn wording.

### 2.5 Publish the pre-commitment document

Site, GitHub, pinned post. **Before launch.** Its entire value is that it went
out while you could still have chosen differently.

---

## Section 3 — Snapshot (~1 hour)

> **State: the holder set is already frozen.** Taken at mainnet finalized slot
> **439869907** (2026-08-17T14:48:36Z): 3,468 token accounts read, 976 holders,
> 3 excluded, **946 wallets** eligible. `verify-snapshot.ts` reproduces it and
> all 946 proofs verify. The slot and date are set in `app/src/config.ts`.
>
> What is *not* fixed yet is the money: each wallet's amount is a share of
> bucket 2, and bucket 2 is 15% of the distributor total, which is only known
> once the launch buy executes. So the **Merkle root is recomputed on launch
> day** from this same slot with the real total — §3.3a below. The influencer
> list (10 wallets, equal split, `influencers.csv`) is final in the same way:
> addresses fixed, amounts computed at launch.
>
> **The old mint is Token-2022.** `snapshot.ts` reads the mint's owning program
> at run time and must not filter on `dataSize: 165`; a classic-SPL-only query
> returns zero holders for this mint and would silently pay nobody.

### 3.1 Choose a slot that has already passed

**Do not announce a future snapshot time.** That tells the market to buy the old
token and farm the airdrop — handing restitution to speculators and paying the
old dev's fees on the way through.

Pick a slot anchored to a documented event instead:

> "Snapshot at slot X — the block of the creator's final sell transaction."

The moment picked itself, so "you cherry-picked it" has an answer.

### 3.2 Set the exclusions

Edit `EXCLUSIONS` in `scripts/snapshot.ts`. At minimum the old dev's wallets
(with a receipt reference each) and **both AMM pool vaults** — PumpSwap and
Meteora. Leave those in and the pools claim a large share of money meant for
people.

### 3.3 Take it and verify it

```bash
RPC_URL=<archival-rpc> BUCKET_TWO_ALLOCATION=<base-units> npx ts-node scripts/snapshot.ts
```

```bash
npx ts-node scripts/verify-snapshot.ts
```

### 3.3a Launch-day recompute — the roots the chain gets

Run this **after** the launch buy, once you know the distributor total. Same
slot, same eligible wallets; only the amounts change.

`FROZEN_SNAPSHOT` rescales the holder set already committed in `snapshot/`
rather than re-reading the chain. That is not an optimisation, it is the only
correct way: `getProgramAccounts` sees present state only — no RPC can replay it
at slot 439869907 — so a fresh query on launch day would silently snapshot a
*different*, later set of holders than the one published here. It needs no RPC.

```bash
TOTAL=<distributor total in base units>
FROZEN_SNAPSHOT=snapshot BUCKET_TWO_ALLOCATION=$(( TOTAL * 15 / 100 )) npx ts-node scripts/snapshot.ts
```

Then rebuild the influencer tree with the real equal amount (bucket 3 is 50% of
the total, split ten ways), replacing the placeholder `1`s in `influencers.csv`:

```bash
npx ts-node scripts/build-tree.ts influencers.csv snapshot/influencers
```

```bash
npx ts-node scripts/verify-snapshot.ts
```

The two `merkleRoot` values that come out are `OLD_ROOT` and `INF_ROOT` for
§4.4. Publish both trees in full before announcing.

### 3.4 Build the influencer tree

```bash
npx ts-node scripts/build-tree.ts influencers.csv snapshot/influencers
```

### 3.5 Publish everything and wire up the site

```bash
cp snapshot/proofs.json app/public/proofs/old-holders.json && cp snapshot/influencers-proofs.json app/public/proofs/influencers.json && cp snapshot/holders.csv snapshot/excluded.csv snapshot/manifest.json snapshot/influencers.csv snapshot/influencers-manifest.json app/public/snapshot/ && git add -A && git commit -m "publish snapshot" && git push
```

Publish the whole `snapshot/` directory too, and invite people to re-run the
verifier. Note the `merkleRoot` — it goes on chain next.

---

## Section 4 — Launch day (~2 hours, no interruptions)

Have every command ready in a terminal before you start. Do not announce
anything until 4.8.

### 4.1 Deploy the program

```bash
solana config set --url mainnet-beta && ~/.avm/bin/anchor-0.31.1 deploy --provider.cluster mainnet
```

Costs ~3–5 SOL.

> **Do not add `--final` here.** You are burning the authority today, but not
> yet — see 4.7. Between now and then there are three transactions and a dozen
> parameters, and if one is wrong you want the option to redeploy at a new
> address. Nobody knows the token exists yet, so this window costs you nothing.

### 4.2 Create the coin on pump.fun

Same icon, the story, real community socials.

### 4.3 Dev-buy in the same transaction as creation

Use pump.fun's initial-buy field. Buying a minute later costs more and looks
like an outsider sniping your own launch.

### 4.4 Initialize, fund, lock

> **`initialize` is now bound to the program's upgrade authority.** Only the
> wallet that deployed the program can run it, which closes the deploy→initialize
> front-run: the config PDA is a singleton with no re-create path, so otherwise
> anyone who saw the freshly-deployed program id could seize it with their own
> Merkle roots before yours landed. Sign this step with the same deploy keypair,
> and note this is why the burn must wait until 4.7 — burning the upgrade
> authority first would make `initialize` impossible.

Dry run first — it prints the whole plan and sends nothing:

```bash
RPC_URL=<rpc> KEYPAIR=<your-keypair.json> REWARD_MINT=<new-mint> DEV_WALLET=<team-multisig-vault> OLD_ROOT=<hex> INF_ROOT=<hex> OLD_ALLOC=<n> INF_ALLOC=<n> SIGNER_ALLOC=<n> DEV_ALLOC=<n> SIGNER_PUBKEY=0480ba015ac8c00c8a0c6f4913d8a63364272a5472148ac19159932e36ffdffd2355a7358601b556af702d4ae5641e7d59bbda795894121d8bbc8412ae70744779 SOURCE_TOKEN_ACCOUNT=<your-ata> npx ts-node scripts/deploy-init.ts
```

`DEV_WALLET` is the **Squads vault address** from §2.3a, and it is frozen by
the lock like everything else, so a typo here strands the team allocation on
whatever address you typed, permanently. Check it twice.

The four `*_ALLOC` amounts are the 15 / 50 / 10 / 25 split of the distributor
total in base units (`OLD_ALLOC` legacy holders, `INF_ALLOC` influencers,
`SIGNER_ALLOC` the 2014 signer, `DEV_ALLOC` the team), and they must sum to
exactly what the launch buy acquired — `lock_config` checks the vault covers
them.

Read every number against your published document. Then re-run with `EXECUTE=1`.

> `lock_config` is irreversible. Allocations, roots, deadlines and the signer key
> can never change afterwards, including by you.

> **Fund only through `fund_vault`.** `lock_config` checks the pool's
> `reserved_token` counter, which rises only inside `fund_vault`, and not the
> vault's raw token balance. Tokens sent to the vault address with an ordinary
> wallet transfer, or donated before launch, do not count towards the
> committed total and the lock will refuse. That refusal is protecting you:
> anything the vault holds above `reserved_token` is untracked and belongs to
> the staking pool the moment anyone calls `sync_token_rewards`, so counting it
> as bucket backing would promise the same tokens twice. `fund_vault` stops
> working the instant the config locks, so there is no second chance to top up.

### 4.5 Create the team stream

```bash
RPC_URL=<rpc> KEYPAIR=<your-keypair.json> npx ts-node scripts/create-dev-stream.ts
```

No cliff argument here: it was fixed at init with `DEV_CLIFF_DAYS` and frozen by
the lock, so anyone can run this and the terms come out the same. The stream's
beneficiary is the team multisig vault from §4.4, and every team wallet is now
visibly empty of allocation.

> When the team later withdraws vested tokens, that is a `stream_withdraw`
> executed through Squads, paying the vault's own token account. The tooling
> for it is `scripts/team-withdraw.ts` — see §2.3a for the full flow.

### 4.6 Set the fee split — the other irreversible step

**This happens BEFORE the burn**, so that if anything about it misbehaves you
can still redeploy the program and start over.

Full detail in [docs/FEES.md](docs/FEES.md). Two transactions, both signed by
you as the coin creator — no application to pump.fun, no waiting on anyone:

1. `create_fee_sharing_config` — opts the coin into shared fees. Shareholders
   default to `[(you, 100%)]`.
2. `update_fee_shares_v2` — set **90% → the SOL vault PDA, 10% → the team
   multisig vault** (§2.3a). Not your wallet: the split is permanent, and the
   team's income should never depend on one person's key.

> **`update_fee_shares_v2` can only ever be called once.** pump.fun's program
> revokes its own admin immediately afterwards and the shareholder list is
> frozen permanently. If a share points somewhere that cannot be paid, and
> payouts are atomic, that single bad entry can block every future distribution
> forever.
>
> Do not run this on the real coin until the throwaway-coin rehearsal (§1.5) has
> proved the exact same configuration works.

Once set, confirm the shareholder list and that the admin reads revoked. This
becomes the eighth check on the Verify page.

### 4.7 Verify everything, then burn

**Point of no return. Do the checks first.**

> `<MAINNET_PROGRAM_ID>` is the **fresh mainnet id from §0.1**, not the devnet
> `5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp`. Burning the wrong id does
> nothing to the mainnet program, and running it against devnet would freeze the
> test deployment — confirm you are on `mainnet-beta` (`solana config get`) and
> using the id you deployed today.

```bash
solana program show <MAINNET_PROGRAM_ID>
```

Confirm, one by one:

- the vault holds the full committed total — the distributor total you
  published, split 15 / 50 / 10 / 25
- `locked` reads true
- both Merkle roots match your published files
- both deadlines are the dates you published
- the team stream exists with the right total and cliff, and its beneficiary
  is the team multisig vault
- the signer key matches the 2014 transaction
- the fee split from 4.6 reads 90% SOL vault / 10% team multisig with the
  admin revoked

Anything wrong? Fix it now — you can still redeploy for ~4 SOL. After the next
command you cannot.

```bash
solana program set-upgrade-authority <MAINNET_PROGRAM_ID> --final
```

```bash
solana program show <MAINNET_PROGRAM_ID>
```

`Authority` must read **`none`**. Save that transaction signature — it leads the
announcement.

### 4.8 Promote to production, then announce

Merge `develop` into `main`. That deploys `mybestbuddy.fun` against mainnet;
staging stays on devnet behind its password.

```bash
gh pr create --base main --head develop --title "Launch" --fill
```

**Then make the repo public** — the Verify page tells people to clone and
build it, and half those checks fail against a private repo:

```bash
gh repo edit dullbenz/best_buddy --visibility public --accept-visibility-change-consequences
```

Now, and not before. All at once: program ID, config PDA, snapshot files,
pre-commitment doc, receipts dossier, and the burn signature.

**Lead with the burn.** `Authority: none` takes ten seconds to confirm and is the
exact thing the last dev could never have said.

Then, in order:

1. Point everyone at `mybestbuddy.fun` → **Verify**
2. Post the independent-verification ask from [docs/CONTENT.md](docs/CONTENT.md)
   where developers and auditors actually are
3. Run the TikTok and thread scripts
4. Notify every influencer directly — their 72 hours started at 4.4

---

## Section 5 — The first month

### 5.1 The clocks

| When | What | Command |
|---|---|---|
| +72 hours | Influencer window closes | `sweep_influencers` |
| +30 days | Legacy Buddy holder window closes | `sweep_old_holders` |
| 2030-12-31 | Signer deadline | `sweep_original_signer` |

The sweeps are permissionless — anyone can run them — but run them yourself
promptly and **announce each one as a community win.** The 72-hour sweep is your
first proof that the dead-man rule is real, so make noise about it.

Two of the three do not pay out instantly. The old-holder bucket paid its
claimants instantly, so its sweep credits the pool instantly. The influencer
and signer buckets streamed, so their sweeps open a *community stream* on the
identical schedule — 30 days and 12 months respectively — and the pool is
credited by `release_community_stream`, a permissionless crank surfaced on the
Fund Pool tab. Crank it now and then (or let anyone else); vested amounts wait
indefinitely, exactly like un-synced creator fees. Announce it accordingly:
the influencer forfeit is a 30-day drip for stakers, not a one-day spike.

### 5.2 Chase the Legacy Buddy holders

You can't DM them. Post everywhere the old community gathered and ask people to
spread it. This is why that window is 30 days and not 72 hours.

### 5.3 Keep feeding bucket 1

Fees accrue safely at pump.fun and never expire, but they only reach stakers
when somebody moves them. **Anyone can** — the Fund pool tab runs the whole
chain from any visitor's wallet.

Run it yourself after the first burst of trading so people see it work, then
point at it in transparency posts: *anyone can press this, including you.* If
the dashboard's "not yet credited" figure is non-zero, someone donated directly
and a sync hands it to the stakers.

### 5.4 Weekly transparency posts

Generate them from chain data, not your own bookkeeping. The dashboard already
has the numbers; the post is a summary and a link.

---

## The one-page checklist

**Setup**
- [ ] Program keypair backed up outside `target/`
- [ ] `npm test` → 37 passing, `cargo test` → 7 passed
- [ ] Pushed to GitHub, CI green (private for now)
- [ ] Working on `develop`, not `main`
- [ ] Blaze plan enabled; `staging.mybestbuddy.fun` returns 401 then 200 with the password
- [ ] `mybestbuddy.fun` live (deploys from `main`)
- [ ] Helius keys — separate archival and browser, browser one domain-locked

**Rehearsal**
- [ ] Devnet deploy + full rehearsal script clean
- [ ] Devnet fee-chain dry-run clean: devnet pump.fun coin, sharing config,
      90/10 split, trade, crank, sync (§1.5)
- [ ] App clicked through on desktop and phone
- [ ] `deploy-init.ts` dry run read line by line

**Preparation**
- [ ] Contract reviewed: devnet campaign clean + full test suite green
- [ ] Receipts dossier complete and archived
- [ ] All numbers decided; the launch buy is money you can lose
- [ ] Distributor total understood: it is whatever the launch buy acquires,
      split 15 / 50 / 10 / 25, published in the pre-commitment doc
- [ ] Team multisig created at Squads, 2-of-3, all three signers have
      practised a proposal round; vault address recorded
- [ ] Content written, no price promises anywhere
- [ ] Pre-commitment doc published **before** launch

**Snapshot**
- [ ] Slot chosen retroactively, anchored to a documented event
- [ ] Both AMM pool vaults and the dev's wallets excluded, each with a published reason
- [ ] `SNAPSHOT.takenAt` and `SNAPSHOT.slot` in `app/src/config.ts` replaced
      with the mainnet snapshot's own date and slot — they currently hold the
      devnet fixture's values
- [ ] Snapshot verified and published
- [ ] Proof files committed and deployed to the site

**Wallet reputation** — start this early, it has a lead time
- [ ] Production actually deployed and publicly reachable. Phantom's scanner
      cannot vouch for a site it cannot fetch, and today `mybestbuddy.fun`
      returns 404 while `staging` returns 401
- [ ] Warning re-checked from a real wallet once the site is live and the
      domain has aged a little. The "this domain is new" notice clears on its
      own; the red "this dApp could be malicious" may not
- [ ] If it persists, appeal to review@phantom.com — manual review, reported
      at 48-72h, so do not leave it until launch day. Vouching from a known
      Solana community member is reported to speed it up

**Program identity** — the repo currently carries a devnet id
- [ ] Fresh mainnet keypair generated at §0.1, `declare_id!` and both
      `Anchor.toml` entries updated to match, then rebuilt
- [ ] `VITE_PROGRAM_ID` repository variable set to the mainnet id — it holds
      the devnet one today, so a production deploy right now would ship a site
      pointing at a program that does not exist on mainnet

**Launch**
- [ ] Program deployed (no `--final` yet)
- [ ] Coin created, launch buy in the same transaction (pump.fun's dev-buy field)
- [ ] `initialize` → `fund_vault` → `lock_config`; `DEV_WALLET` is the
      multisig vault, the four allocations sum to the distributor total
- [ ] Every committed token went in through `fund_vault`, not a wallet transfer
- [ ] Team stream created, beneficiary reads as the multisig vault
- [ ] Every parameter verified against the published doc
- [ ] Upgrade authority burned; `Authority: none` confirmed
- [ ] Fee chain proved end to end twice: the devnet dry-run first, then the
      mainnet throwaway-coin rehearsal, including a Squads vault receiving
      its share (§1.5)
- [ ] Fee split set to 90% SOL vault / 10% team multisig via
      `update_fee_shares_v2` — **one shot**
- [ ] Sharing config confirmed frozen (admin revoked)
- [ ] `develop` merged to `main`, production deploy green
- [ ] **Repo flipped to public** (verification checks need it)
- [ ] Announced, burn signature first
- [ ] Influencers notified — their clock is already running
- [ ] Independent-verification ask posted

**After**
- [ ] 72h sweep run and announced
- [ ] 30-day sweep run and announced
- [ ] Weekly transparency posts from chain data

---

## Things that can go wrong, and what to do

| Problem | What to do |
|---|---|
| Build fails, `edition2024 is required` | `agave-install init stable`, use `~/.avm/bin/anchor-0.31.1` |
| Dashboard shows 403 | You're on the public RPC. Set `VITE_RPC_URL` to Helius. |
| Wrong parameter, spotted before 4.7 | Redeploy at a new address, ~4 SOL. Cheap. |
| Wrong parameter, spotted after 4.7 | Unfixable. This is why 4.7 has a checklist. |
| Fee split set wrong | Unfixable — `update_fee_shares_v2` runs once. This is what §1.5 exists to prevent. |
| Old dev complains | Publish the receipts. Everything in them is public chain data. |
| Influencers don't claim | Working as designed — it feeds the stakers. Announce it. |
| The 2014 signer appears | Send them `scripts/sign-claim.ts`. Their tokens are theirs, including the right to sell. You committed to that publicly. |
| Nobody engages | Your investment is gone. You accepted that. The contract keeps running regardless — the sweeps are permissionless. |

---

## What I could not verify for you

Stated plainly, because you should know where the docs stop being tested:

**Which form pump.fun pays in, post-graduation.** Their docs now say a
SOL-quoted sharing distribution pays native lamports either way, wSOL
unwrapped internally — but a doc is not the deployed program on the day.
`unwrap_wsol` exists to cover either form regardless. §1.5 is where you find
out for real.

**Undiscovered bugs.** The tests and the devnet campaign prove the mechanisms
work as designed. They do not prove there's no exploit nobody thought of. With
an immutable contract, that difference is permanent.

**Whether any of this works commercially.** Everything here is about mechanics
and custody. It's a memecoin. It can go to zero regardless of how good the
contract is.
