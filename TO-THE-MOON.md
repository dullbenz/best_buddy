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

Current program ID: `GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11`

### 0.2 Confirm the toolchain works

```bash
cd /Users/dullbenz/Projects/Personal/best_buddy && npm test
```

Expect **28 passing**. Then:

```bash
cargo test -p buddy-distributor --lib
```

Expect **7 passed**. If either fails, stop and fix it before anything else.

> **The toolchain snag.** `avm`'s `anchor` wrapper silently re-pins Solana to
> 2.1.0, whose cargo can't parse some of our dependencies. If a build fails with
> `edition2024 is required`, run `agave-install init stable`, then use
> `~/.avm/bin/anchor-0.31.1` directly instead of `anchor`. Every command in
> these docs already does.

### 0.3 Push to GitHub

```bash
cd /Users/dullbenz/Projects/Personal/best_buddy && gh repo create buddy-distributor --public --source=. --remote=origin && git push -u origin main
```

Public is the right call — the whole pitch is that anyone can verify the
contract. If you'd rather stay quiet until launch, use `--private` and flip it
public **before** you announce.

### 0.4 Get the site live at mybestbuddy.fun

Follow [docs/CICD.md](docs/CICD.md). Roughly: create the Firebase project, run
`firebase init hosting:github` to generate the deploy credential, set four
values in GitHub settings, add the DNS records.

Set these in **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | the service-account JSON |
| Variable | `FIREBASE_PROJECT_ID` | your Firebase project ID |
| Variable | `VITE_RPC_URL` | your Helius RPC URL |
| Variable | `VITE_PROGRAM_ID` | `GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11` |

Also replace the placeholder in `.firebaserc` — CI refuses to build `main` while
it's still there.

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

```bash
cd app && VITE_RPC_URL=https://api.devnet.solana.com VITE_PROGRAM_ID=GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11 npm run dev
```

Open every tab. Try a claim. Try staking. **Do it on your phone too** — most of
your community will be on one.

### 1.4 Practise the deploy script's dry run

Run `scripts/deploy-init.ts` without `EXECUTE=1` (command in
[docs/DEVNET-REHEARSAL.md](docs/DEVNET-REHEARSAL.md) §5). Get used to reading
its output carefully now, so that reading it under pressure on launch night is
routine.

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
| Bucket split | Suggested 55 / 15 / 20 / 10 across old holders, influencers, 2014 signer, dev. |
| Dev cliff | 30 days is the default. |
| Creator fee split | 50%+ to bucket 1 is the recommendation. This is what keeps staking rewards alive. |
| Influencer list | Addresses and amounts. All published — no hidden deals. |

### 2.4 Write the launch content

Everything is drafted in [docs/CONTENT.md](docs/CONTENT.md) — 60s and 30s TikTok
scripts, an 11-post X thread, FAQ answers, and the ask for independent
verification. Fill in the placeholders and record.

Also read `app/src/components/HowItWorks.tsx` end to end and confirm it matches
what you actually built.

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
cp snapshot/proofs.json app/public/proofs/old-holders.json && cp snapshot/influencers-proofs.json app/public/proofs/influencers.json && git add -A && git commit -m "publish snapshot" && git push
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
> yet — see 4.6. Between now and then there are three transactions and a dozen
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

### 4.6 Verify everything, then burn

**Point of no return. Do the checks first.**

```bash
solana program show GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11
```

Confirm, one by one:

- the vault holds the full committed total
- `locked` reads true
- both Merkle roots match your published files
- both deadlines are the dates you published
- the dev stream exists with the right total and cliff
- the signer key matches the 2014 transaction

Anything wrong? Fix it now — you can still redeploy for ~4 SOL. After the next
command you cannot.

```bash
solana program set-upgrade-authority GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11 --final
```

```bash
solana program show GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11
```

`Authority` must read **`none`**. Save that transaction signature — it leads the
announcement.

### 4.7 Route creator fees to bucket 1

In the pump.fun creator dashboard, split fees so 50%+ reaches the community.

> I could not verify this step — it's a UI action on their platform and their
> fee structure changed in January 2026. Check what's actually there on the day
> rather than trusting a screenshot in these docs.

### 4.8 Announce

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
| +30 days | Old-holder window closes | `sweep_old_holders` |
| 2030-12-31 | Signer deadline | `sweep_original_signer` |

The sweeps are permissionless — anyone can run them — but run them yourself
promptly and **announce each one as a community win.** The 72-hour sweep is your
first proof that the dead-man rule is real, so make noise about it.

### 5.2 Chase the old holders

You can't DM them. Post everywhere the old community gathered and ask people to
spread it. This is why that window is 30 days and not 72 hours.

### 5.3 Keep feeding bucket 1

Route fees regularly. If the pool stops growing, the reason to stay disappears.

### 5.4 Weekly transparency posts

Generate them from chain data, not your own bookkeeping. The dashboard already
has the numbers; the post is a summary and a link.

---

## The one-page checklist

**Setup**
- [ ] Program keypair backed up outside `target/`
- [ ] `npm test` → 28 passing, `cargo test` → 7 passed
- [ ] Pushed to GitHub, CI green
- [ ] `mybestbuddy.fun` live
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
- [ ] Both AMM pool vaults and the dev's wallets excluded
- [ ] Snapshot verified and published
- [ ] Proof files committed and deployed to the site

**Launch**
- [ ] Program deployed (no `--final` yet)
- [ ] Coin created, dev-buy in the same transaction
- [ ] `initialize` → `fund_vault` → `lock_config`
- [ ] Dev stream created
- [ ] Every parameter verified against the published doc
- [ ] Upgrade authority burned; `Authority: none` confirmed
- [ ] Creator fees routed to bucket 1
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
| Wrong parameter, spotted before 4.6 | Redeploy at a new address, ~4 SOL. Cheap. |
| Wrong parameter, spotted after 4.6 | Unfixable. This is why 4.6 has a checklist. |
| Old dev complains | Publish the receipts. Everything in them is public chain data. |
| Influencers don't claim | Working as designed — it feeds the stakers. Announce it. |
| The 2014 signer appears | Send them `scripts/sign-claim.ts`. Their tokens are theirs, including the right to sell. You committed to that publicly. |
| Nobody engages | Your investment is gone. You accepted that. The contract keeps running regardless — the sweeps are permissionless. |

---

## What I could not verify for you

Stated plainly, because you should know where the docs stop being tested:

**The pump.fun fee-split UI.** Their platform, their interface, and their fee
structure changed in January 2026. Check it live.

**The security review.** The 35 tests prove the mechanisms work as designed.
They do not prove there's no exploit nobody thought of. With an immutable
contract, that difference is permanent.

**Whether any of this works commercially.** Everything here is about mechanics
and custody. It's a memecoin. It can go to zero regardless of how good the
contract is.
