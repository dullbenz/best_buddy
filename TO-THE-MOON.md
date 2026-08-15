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

Current program ID: `6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b`

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

Expect **37 passing**. Then:

```bash
cargo test -p buddy-distributor --lib
```

Expect **7 passed**. If either fails, stop and fix it before anything else.

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
| Variable | `VITE_PROGRAM_ID` | `6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b` |
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
✓ held back N as boost, locked until maturity
✓ the boost cannot be withdrawn before the lock matures
```

Full guide, including how to re-run it: [docs/DEVNET-REHEARSAL.md](docs/DEVNET-REHEARSAL.md).

### 1.3 Click through the real app against devnet

Locally:

```bash
cd app && VITE_RPC_URL=https://api.devnet.solana.com VITE_PROGRAM_ID=6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b npm run dev
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

### 1.5 Rehearse the fee path — on mainnet, with a throwaway coin

**This one is not optional, and it cannot be done on devnet.** pump.fun's docs
show no devnet deployment; every example they publish is a mainnet link.

Setting the real coin's fee split is a one-shot that can never be corrected
(§4.6). The only way to know the configuration works is to have already watched
it work.

1. Create a junk coin on pump.fun with a minimal buy.
2. `create_fee_sharing_config`, then set a 90/10 split with a test PDA of the
   same shape as the real SOL vault.
3. Trade it a little so fees actually accrue.
4. Run the whole chain from the Fund pool tab and confirm value lands and gets
   credited.
5. **Note which form the payout arrived in** — native lamports or wrapped SOL.
   That tells you whether `unwrap_wsol` is on the critical path.

Budget a few tens of dollars. Cheap, against a mistake that would freeze the
community's fee stream permanently.

---

## Section 2 — Preparation (the slow part, days to weeks)

Steps 2.1–2.4 can all run in parallel. This section, not the launch, is where
the real work is.

### 2.1 Book the security review

**Start this first — auditors have lead times.**

Because the contract will be immutable, this is not best practice, it's the only
safety net you have. Budget for it, publish the report, and fix what it finds.

### 2.2 Build the receipts dossier

Fill in [docs/RECEIPTS.md](docs/RECEIPTS.md): Solscan links to every dump,
Wayback captures of the dead socials, dated screenshots.

**Do this now, while the links still work.** A deleted tweet you didn't archive
is worth nothing later. This is both your defence if the old dev objects and the
justification for every wallet you exclude from the snapshot.

Optional but strong: file pump.fun's official CTO fee-redirect application for
the *old* token. An approval is third-party confirmation of abandonment.

### 2.3 Decide the numbers

Fill these into [docs/PRE-COMMITMENT.md](docs/PRE-COMMITMENT.md):

| Decision | Guidance |
|---|---|
| Dev-buy size | Money you can lose entirely. Old token liquidity is ~$26k, so low tens of SOL is proportionate; larger mostly buys your own slippage. |
| Bucket split | Suggested 55 / 15 / 20 / 10 across Legacy Buddy holders, influencers, 2014 signer, dev. |
| Dev cliff | 30 days is the default. |
| Creator fee split | 90% to the community vault, 10% to you. Set **once, irreversibly** — see [docs/FEES.md](docs/FEES.md). |
| Influencer list | Addresses and amounts. All published — no hidden deals. |

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

Dry run first — it prints the whole plan and sends nothing:

```bash
RPC_URL=<rpc> KEYPAIR=<your-keypair.json> REWARD_MINT=<new-mint> DEV_WALLET=<dev-wallet> OLD_ROOT=<hex> INF_ROOT=<hex> OLD_ALLOC=<n> INF_ALLOC=<n> SIGNER_ALLOC=<n> DEV_ALLOC=<n> SIGNER_PUBKEY=0480ba015ac8c00c8a0c6f4913d8a63364272a5472148ac19159932e36ffdffd2355a7358601b556af702d4ae5641e7d59bbda795894121d8bbc8412ae70744779 SOURCE_TOKEN_ACCOUNT=<your-ata> npx ts-node scripts/deploy-init.ts
```

Read every number against your published document. Then re-run with `EXECUTE=1`.

> `lock_config` is irreversible. Allocations, roots, deadlines and the signer key
> can never change afterwards, including by you.

### 4.5 Create the dev stream

```bash
RPC_URL=<rpc> KEYPAIR=<your-keypair.json> CLIFF_DAYS=30 npx ts-node scripts/create-dev-stream.ts
```

Your wallet is now visibly empty of allocation.

### 4.6 Set the fee split — the other irreversible step

**This happens BEFORE the burn**, so that if anything about it misbehaves you
can still redeploy the program and start over.

Full detail in [docs/FEES.md](docs/FEES.md). Two transactions, both signed by
you as the coin creator — no application to pump.fun, no waiting on anyone:

1. `create_fee_sharing_config` — opts the coin into shared fees. Shareholders
   default to `[(you, 100%)]`.
2. `update_fee_shares_v2` — set **90% → the SOL vault PDA, 10% → your wallet**.

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

```bash
solana program show 6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b
```

Confirm, one by one:

- the vault holds the full committed total
- `locked` reads true
- both Merkle roots match your published files
- both deadlines are the dates you published
- the dev stream exists with the right total and cliff
- the signer key matches the 2014 transaction
- the fee split from 4.6 reads 90/10 with the admin revoked

Anything wrong? Fix it now — you can still redeploy for ~4 SOL. After the next
command you cannot.

```bash
solana program set-upgrade-authority 6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b --final
```

```bash
solana program show 6CajKQsknNZKf7DDrXUfuKMajaRC59LJd9R3g9CxCz2b
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
- [ ] App clicked through on desktop and phone
- [ ] `deploy-init.ts` dry run read line by line

**Preparation**
- [ ] Security review done and published
- [ ] Receipts dossier complete and archived
- [ ] All numbers decided; dev-buy is money you can lose
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
- [ ] Coin created, dev-buy in the same transaction
- [ ] `initialize` → `fund_vault` → `lock_config`
- [ ] Dev stream created
- [ ] Every parameter verified against the published doc
- [ ] Upgrade authority burned; `Authority: none` confirmed
- [ ] Throwaway-coin rehearsal proved the fee chain end to end (§1.5)
- [ ] Fee split set to 90/10 via `update_fee_shares_v2` — **one shot**
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

**Which form pump.fun pays in, post-graduation.** Their docs confirm native
lamports on the bonding curve and wrapped SOL on the AMM, but not with certainty
which one a *sharing-config* distribution produces. `unwrap_wsol` exists to
cover either. §1.5 is where you find out for real.

**The security review.** The 35 tests prove the mechanisms work as designed.
They do not prove there's no exploit nobody thought of. With an immutable
contract, that difference is permanent.

**Whether any of this works commercially.** Everything here is about mechanics
and custody. It's a memecoin. It can go to zero regardless of how good the
contract is.
