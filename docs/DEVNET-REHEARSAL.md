# Devnet rehearsal

A full dress run on Solana's free practice network, with fake money, before you
touch mainnet.

**Why bother:** launch day is a tight sequence where several steps are
irreversible and two of them have to happen within minutes of each other. This
is where you find out that a command has a typo, or an environment variable is
wrong, or you misread which wallet signs what — while it costs nothing.

It matters even more if you're burning the upgrade authority, because after that
a bug is permanent.

**Time:** about 20 minutes the first time.

---

## What it does and does not prove

**Proves:** the program deploys, accounts initialize, the Merkle proofs our
tooling generates are accepted by the on-chain verifier, claims pay out
instantly, influencer claims open streams instead of transferring, staking
splits base from boost correctly, the config lock actually bites, the boost
escrow refuses early withdrawal, and — the mechanism that makes trustless fee
routing possible — funds sent straight to a vault stay invisible to the reward
ledger until somebody syncs them, then become claimable.

**Does not prove:** anything time-dependent. The 30-day and 72-hour windows, the
three sweeps, emergency exit, and the 2030 deadline can't be exercised on a live
chain without waiting years. Those are covered by the integration tests, which
fake the clock:

```bash
npm test
```

Run both. They cover different things.

---

## 1. Point your CLI at devnet

```bash
solana config set --url devnet
```

Check who you are and top up. Devnet SOL is free and worthless:

```bash
solana address && solana balance && solana airdrop 5
```

If the faucet rate-limits you, use [faucet.solana.com](https://faucet.solana.com).

---

## 2. Build and deploy

```bash
~/.avm/bin/anchor-0.31.1 build && ~/.avm/bin/anchor-0.31.1 deploy --provider.cluster devnet
```

Remember the toolchain snag: if the build fails with `edition2024 is required`,
run `agave-install init stable` first. The direct `~/.avm/bin/anchor-0.31.1`
path exists to stop avm re-pinning Solana behind your back.

Confirm it landed, and note the `Authority` line — this is exactly what you'll
be checking and changing on mainnet:

```bash
solana program show GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11
```

---

## 3. Run the rehearsal

```bash
RPC_URL=https://api.devnet.solana.com KEYPAIR=~/.config/solana/id.json npx ts-node scripts/devnet-rehearsal.ts
```

It creates a mock token, invents three old holders and two influencers, builds
real Merkle trees from them, then walks the whole sequence printing what
happened at each step.

Watch for these four lines in particular — each one is a claim from the
pre-commitment document being demonstrated rather than asserted:

```
✓ further funding is rejected (ConfigLocked) — the lock holds
✓ the same wallet cannot claim twice
✓ held back N as boost, locked until maturity
✓ the boost cannot be withdrawn before the lock matures
```

If it stops early it prints why and what to do. The common ones:

| Message | Fix |
|---|---|
| `Program not found on this cluster` | run step 2 |
| `A distributor is already initialized` | see "Running it twice" below |
| `Airdrop failed` | use the web faucet |

---

## 4. Look at it in a browser

The script prints the config address. Open it on
[explorer.solana.com](https://explorer.solana.com) with `?cluster=devnet` and
click through the accounts — this is what your community will do on mainnet, so
it's worth seeing what they'll see.

Then run the real app against it:

```bash
cd app && VITE_RPC_URL=https://api.devnet.solana.com VITE_PROGRAM_ID=GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11 npm run dev
```

Open http://localhost:5173. The dashboard should show live bucket balances and
the 2030 countdown. Connect a wallet set to devnet to try the claim and staking
tabs.

**This is the step people skip and regret.** Actually click through the flow the
way a nervous holder will, on a phone as well as a laptop.

---

## 5. Rehearse the real deploy script

The rehearsal script calls the program directly. On mainnet you'll use
`deploy-init.ts`, so practise that too — its dry run prints the full plan and
sends nothing:

```bash
RPC_URL=https://api.devnet.solana.com KEYPAIR=~/.config/solana/id.json REWARD_MINT=<mock-mint-from-step-3> DEV_WALLET=$(solana address) OLD_ROOT=$(printf '00%.0s' {1..32}) INF_ROOT=$(printf '00%.0s' {1..32}) OLD_ALLOC=1 INF_ALLOC=1 SIGNER_ALLOC=1 DEV_ALLOC=1 SIGNER_PUBKEY=0480ba015ac8c00c8a0c6f4913d8a63364272a5472148ac19159932e36ffdffd2355a7358601b556af702d4ae5641e7d59bbda795894121d8bbc8412ae70744779 SOURCE_TOKEN_ACCOUNT=<your-token-account> npx ts-node scripts/deploy-init.ts
```

Read every number it prints. On mainnet this is your last checkpoint before
`lock_config` becomes irreversible — get used to actually reading it now, rather
than skimming it under pressure on launch night.

---

## 6. Rehearse the signature flow

Even though the real 2014 key isn't yours, practise the mechanics:

```bash
npx ts-node scripts/sign-claim.ts message $(solana address)
```

That prints the exact message a claimant must sign. If someone ever turns up
claiming to be the original signer, this is the conversation you'll be having,
and you don't want to be improvising it.

---

## Running it twice

PDAs are derived from fixed seeds, so a devnet deployment can only be
initialized once — and its config is locked afterwards. To rehearse again from
scratch, mint a new program identity:

```bash
solana-keygen new --no-bip39-passphrase -o target/deploy/buddy_distributor-keypair.json --force
```

Then put the new address into `declare_id!` in
`programs/buddy-distributor/src/lib.rs` and both `[programs.*]` entries in
`Anchor.toml`, rebuild, and redeploy.

> Do this on **devnet only**. Running `--force` against your mainnet program
> keypair destroys it. Back that file up somewhere this command cannot reach.

---

## The one part that cannot be rehearsed here: fees

pump.fun publishes **no devnet deployment** — every example in their docs is a
mainnet Solscan link. So the fee path has to be proved on mainnet, with a
throwaway coin, before you touch the real one.

This is not optional. Setting the real coin's fee split is a one-shot that
pump.fun's program makes permanent the moment it runs, and a share pointing
somewhere unpayable can block every future distribution forever.

1. Create a junk coin with a minimal buy.
2. `create_fee_sharing_config`, then set 90/10 with a **test PDA of the same
   shape** as the real SOL vault.
3. Trade it a little so fees actually accrue.
4. Run the chain from the Fund pool tab: collect → distribute → unwrap → sync.
5. Confirm lamports land in the test PDA and get credited to a staker.
6. **Write down which form the payout took** — native lamports or wrapped SOL.
   That decides whether `unwrap_wsol` is load-bearing.

Budget a few tens of dollars. Full mechanism in [FEES.md](./FEES.md).

## When to move on

You're ready for mainnet when you can run the whole sequence without consulting
this file, you've clicked through the app on a phone, and the audit is back.

Then read [DEPLOY.md](./DEPLOY.md) — same steps, real money, no undo.
