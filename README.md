# Buddy Distributor

A four-bucket community distributor for the Buddy relaunch on Solana.

The token launches on pump.fun as an ordinary fair launch — no custom mint, no
LP custody, no admin control over supply. Everything bespoke lives in one Anchor
program instead, and every parameter it uses is frozen on chain before the first
claim opens.

```
                      ┌─────────────────────────────┐
   creator fees ──┐   │                             │
   donations    ──┼──►│   Bucket 1: staking pool    │◄──── every forfeiture
                  │   │   (starts empty, perpetual) │      in the system
   anyone can     │   └──────────────▲──────────────┘
   push these ────┘                  │
                                     │
        ┌────────────────┬───────────┴────────┬──────────────────┐
        │                │                    │                  │
  Bucket 2         Bucket 3             Bucket 4a          Bucket 4b
  Legacy Buddy holders      influencers          2014 signer        new dev
  30 days          72 hours             until 2030         automatic
  instant          30-day stream        12-mo stream       12-mo + cliff
```

**One rule: whatever goes unclaimed becomes community staking rewards.**

## Layout

| Path | What |
|---|---|
| `programs/buddy-distributor/` | the Anchor program |
| `tests/` | 37 integration tests (bankrun, with time travel) |
| `scripts/snapshot.ts` | snapshot old-token holders → Merkle tree |
| `scripts/verify-snapshot.ts` | independent verification anyone can run |
| `scripts/build-tree.ts` | build the influencer tree from CSV |
| `scripts/deploy-init.ts` | initialize → fund → lock, with a dry-run default |
| `scripts/sign-claim.ts` | helper for the 2014 signer's Bitcoin signature |
| `scripts/devnet-rehearsal.ts` | end-to-end dress run against devnet |
| `app/` | landing page, claim dApp, dashboard, fee crank, live Verify page and explainer |
| `app/src/pumpfun.ts` | the only pump.fun-coupled code — deliberately in the frontend |
| `functions/` | basic-auth gate fronting the staging site |
| `TO-THE-MOON.md` | **the complete checklist — start here** |
| `docs/DEVNET-REHEARSAL.md` | scripted dress run on devnet |
| `docs/DEPLOY.md` | **the step-by-step runbook** |
| `docs/PRE-COMMITMENT.md` | public tokenomics, to publish before launch |
| `docs/FEES.md` | how creator fees reach the pool, and the one-shot split |
| `docs/VERIFY.md` | how anyone can independently verify every claim |
| `docs/CONTENT.md` | TikTok scripts, X thread, the ask for independent review |
| `docs/RECEIPTS.md` | evidence dossier template |
| `docs/CICD.md` | GitHub Actions + Firebase Hosting setup |
| `docs/ENVIRONMENTS.md` | staging vs production, branching, the auth gate |

## Start here

**[TO-THE-MOON.md](TO-THE-MOON.md) — the complete step-by-step checklist.**
Everything from first backup to post-launch sweeps, in order. Every other doc
goes deeper on one part of it.

## Quick start

```bash
npm install --legacy-peer-deps && ~/.avm/bin/anchor-0.31.1 build
```

```bash
cargo test -p buddy-distributor --lib && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for everything else, including the
toolchain snag where `anchor` re-pins an old Solana version.

## Upgrade authority

Solana programs are upgradeable by default, so `lock_config` freezing every
claim parameter is only half of what matters. Whoever holds the upgrade
authority can replace the code and bypass the lock entirely.

Check it — for this program or any other — with:

```bash
solana program show <PROGRAM_ID>
```

`Authority: none` means the code is immutable. Anything else names who can still
change it.

**This project burns the upgrade authority on launch day, before announcing** —
so the deployed program can never be altered, including by its author. The
trade-off is real and accepted: no bug can ever be patched, and the contract has
to keep working until the 2030 signer deadline. The devnet rehearsal and the
security review are the only safety net. See [docs/DEPLOY.md](docs/DEPLOY.md)
step 2.6.

## The two mechanisms worth understanding

### Base/boost split

Staking tiers multiply your rewards (up to 3.0x for a 12-month lock), but only
the base `amount × 1.0` portion is claimable while the lock runs. The rest is
escrowed until maturity and forfeited on early exit.

Without this, a staker could take the 3.0x rate, claim continuously, exit after
a few weeks, and have captured the full multiplier while honouring almost none
of the commitment it paid for. `settle()` in `state.rs` splits every accrual at
source; `emergency_exit` in `staking.rs` redistributes what a quitter forfeits —
after removing their weight from the pool, so they cannot receive a share of
their own forfeit.

### On-chain Bitcoin signature verification

The 2014 spend that started this story revealed an uncompressed secp256k1 public
key. `claim_original_signer` rebuilds the Bitcoin signed-message envelope on
chain, recovers the key from the signature with the `secp256k1_recover` syscall,
and compares it to the one committed at initialization. The signed message
embeds the destination Solana address, so an intercepted signature cannot be
redirected.

No oracle, no attestation, no trusted party.

## Test coverage

Rust unit tests cover the Merkle verifier and the Bitcoin message envelope
against fixed digests. The integration suite covers the full lifecycle: Merkle
claims and their rejections, all three expiry sweeps, stream vesting and cliffs,
tier weighting, the buffered-rewards path, SOL and token reward accounting, and
specifically the **claim-then-exit attack** — proving that draining claimable
rewards immediately before breaking a lock still forfeits the entire escrow.
