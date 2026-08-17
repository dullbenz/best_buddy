# Security review brief

The handover document for the security review of the `buddy-distributor`
Anchor program. Everything the review needs to start — what the program is,
how to build and verify it, the edges we already know about, and the specific
questions we want answered — is here or linked from here.

One sentence of context that shapes everything else: **this program's upgrade
authority is burned on launch day, before announcing.** After that no bug can
ever be patched, by anyone, including its author, and the contract has to keep
working until the 2030 signer deadline. This review is the only safety net.
A finding that surfaces after launch is a finding we get to live with forever,
so please read accordingly.

---

## 1. What you are auditing

A four-bucket community distributor for the Buddy relaunch on Solana. The
token itself launches on pump.fun as an ordinary fair launch — no custom mint,
no LP custody, no admin keys over supply. Everything bespoke lives in this one
program:

| Bucket | Who | Window | Payout |
|--------|-----|--------|--------|
| 1 | Community stakers | perpetual | streaming, pro-rata |
| 2 | Old Buddy holders (Merkle snapshot) | 30 days | instant, sellable |
| 3 | Influencers (published list) | 72 hours | 30-day stream |
| 4a | The original 2014 Bitcoin signer | until 2030-12-31 | 12-month stream |
| 4b | The new dev | automatic | 12-month stream, with cliff |

One rule governs everything: whatever goes unclaimed ends up in bucket 1.
Bucket 1 is a staking pool — a flexible tier plus per-lockup boosted tiers —
fed by routed pump.fun creator fees, donations, and every forfeiture in the
system.

- Source: `programs/buddy-distributor/src/`
- Current devnet deployment (normal constants, launch-realistic):
  [`5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp`](https://solscan.io/account/5rqxrosd3X6cqc9u7e4gjZHadUCroyFJZiVDTcwTsynp?cluster=devnet)
- Immutability plan: `README.md` § Upgrade authority, `docs/DEPLOY.md` step 2.6

## 2. Architecture in one page

**Token program.** The launch coin is a pump.fun `create_v2` mint, which means
**Token-2022** (pump.fun's `create_v2_enabled` global flag is on for mainnet).
Every token account is an `InterfaceAccount`, every token program an
`Interface<TokenInterface>`, and every transfer is `transfer_checked` — the
deprecated `transfer` is never used, because an immutable program should not
depend on a deprecated instruction. Each instruction that moves reward tokens
therefore carries the `reward_mint` account (`address = config.reward_mint`),
and `recover_foreign_token` carries the stray token's own mint. wSOL remains a
classic SPL mint, so `unwrap_wsol` is called with the classic token program —
the interface accepts either. Worth an auditor's attention: the mint constraint
on every added mint account, and that decimals come from the mint account, not
a constant.

**Config lock lifecycle.** `initialize` (once, config PDA is a singleton) sets
every allocation, Merkle root, deadline and the signer key; `fund_vault` moves
the committed tokens in; `lock_config` verifies solvency and freezes all of
it. Every claim, sweep and reward instruction gates on the lock. After the
lock the authority key has no remaining power; the only long-term authority is
the upgrade authority, which is burned. `instructions/admin.rs`.

**Merkle claims.** Buckets 2 and 3 claim against sorted-pair keccak trees
(OpenZeppelin convention, no direction bits) with double-hashed leaves over
`(wallet, amount)`. A per-wallet `ClaimReceipt` PDA is the double-claim guard:
its `init` fails if it exists. `instructions/claims.rs`, `utils.rs`.

**Streams.** Buckets 3, 4a and 4b pay through a linear `Stream` (optional
cliff, dev only). The dev stream is created permissionlessly on the exact
terms fixed at init, so the team cannot delay or renegotiate its own lockup.
The 2014 signer proves control of the published secp256k1 key by signing a
Bitcoin-style message that embeds the destination Solana address; verification
is the `secp256k1_recover` syscall on-chain, no oracle. `claims.rs`,
`utils.rs`.

**Sweeps.** Permissionless dead-man cranks. After a bucket's deadline the
remainder returns to bucket 1 — instantly for the instant bucket, and through
a `CommunityStream` on the identical vesting schedule for the streamed ones,
so an expiry is never a jackpot event. `release_community_stream` credits the
vested portion to the pool as anyone cranks it. `instructions/sweep.rs`.

**Staking.** One flexible `StakePosition` per wallet (1.0x, exit gated by a
24h request/cooldown), and any number of `Lockup` accounts per wallet — one
per lock, addressed by a monotonic per-wallet `LockupCounter` index, so
committing new principal can never touch the terms of principal already
locked. Tiers 2x/3x/5x for 1/3/5 months. Rewards accrue on weight, but only
the `amount x 1.0` base is claimable during the lock; the multiplier's excess
sits in escrow, released at maturity and forfeited (plus a 15% principal
slash) on early exit. At maturity the boost ends: anyone may crank
`demote_matured` to cut the lockup back to 1.0x. `instructions/staking.rs`,
`state.rs`.

**Reward accounting.** A standard rewards-per-share accumulator
(`acc_token_per_weight` / `acc_sol_per_weight`, u128, scaled by
`ACC_PRECISION = 1e12`) so paying N stakers is O(1). The load-bearing
invariant is `reserved_token` / `reserved_sol`: the running total of funds
that entered the vaults through this program's own instructions. Vault
balances must never fall below the reserved figures, and internal
reclassification (a slashed stake becoming staker rewards) moves nothing and
must not touch them. Anything a vault holds *above* reserved arrived from
outside — a pump.fun fee distribution, a donation, a mistake — and is credited
by the permissionless `sync_sol_rewards` / `sync_token_rewards`;
`unwrap_wsol` converts vault-held wrapped SOL first, and
`recover_foreign_token` forwards stray foreign-mint accounts to the team
multisig rather than stranding them. `state.rs`, `instructions/rewards.rs`.

**What is deliberately absent.** The program contains no pump.fun coupling at
all — no CPI, no hard-coded layout. Creator fees reach the vault because
pump.fun's own permissionless fee instructions are pointed at it; the only
coupled code is frontend (`app/src/pumpfun.ts`), which can be redeployed. The
reasoning is in `docs/FEES.md`: an immutable program must not depend on
another program's instruction layout staying still.

## 3. Build, test, evidence

```bash
npm install --legacy-peer-deps && ~/.avm/bin/anchor-0.31.1 build
cargo test -p buddy-distributor --lib                          # 14 unit tests
npm test                                                       # bankrun integration suite, with time travel
```

Anchor is 0.31.1, invoked through the avm path above; `docs/DEPLOY.md` covers
the toolchain snag where `anchor` re-pins an old Solana version.

**The `fast-clock` feature.** Every wall-clock duration exists twice: real
values, and a `fast-clock` cargo feature that shrinks them to minutes so the
devnet campaign can watch a lock mature in one sitting. The feature is
test-only: `default = []` in `programs/buddy-distributor/Cargo.toml`, CI never
enables it, and `solana-verify` builds default features, so the mainnet
bytecode provably contains the real values. **Please confirm this
independently** — it is exactly the kind of claim an audit should not take on
faith. `constants.rs` carries both sets side by side.

**Devnet campaign.** Beyond the test suites, an 85-scenario end-to-end
campaign (68 "everyone shows up" + 17 "nobody shows up") ran against live
devnet, each scenario recorded with the transaction signature that proves it:
`docs/E2E-DEVNET-CAMPAIGN.md`. The staking model was redesigned once and
re-proven; `docs/E2E-RETEST-PLAN.md` is the delta plan that drove the rerun.
The campaign's fast-clock programs were throwaways; the deployment left for
this review (`ACEQ…`, above) is a normal-constants build with a real Squads
team-withdraw already exercised against it.

## 4. Findings register

Edges we already know about, stated plainly so the review can confirm,
sharpen, or escalate them rather than rediscover them.

**(a) The lock-solvency proof is now enforced on-chain (previously it was not).**
`lock_config` trusts `pool.reserved_token >= committed` as proof the buckets
are physically backed. Every instruction that raises `reserved_token` —
`stake`, `lock_tokens`, `notify_token_rewards`, `sync_token_rewards` (and the
SOL siblings, and `unwrap_wsol`) — now asserts `config.locked`, so before the
lock the only thing that can move `reserved_token` is `fund_vault`. That makes
the check an honest solvency proof: staker principal and stray donations can no
longer pre-satisfy it. Relatedly, `initialize` is now bound to the program's
upgrade authority via a `program_data` constraint, so only the deployer can
create the singleton config PDA — closing the deploy→initialize front-run.
Please confirm no `reserved_token`-mutating path lacks the gate, and that the
`program_data` seeds/constraint are correct. `instructions/staking.rs`,
`instructions/rewards.rs`, `instructions/admin.rs` (`lock_config`, `Initialize`).

**(b) Matured lockups keep boosted weight until demoted; softened by
auto-demotion on interaction.** Nothing on-chain fires at `lock_end`, but the
two ways an owner touches a matured lockup now both demote it in-line:
`unlock_tokens` (always) and `claim_lockup_rewards` (added — it drops the
lockup to 1.0x before paying, so an owner who claims their base rewards
self-corrects). The residual is a lockup whose owner never interacts at all: it
keeps boosted weight until the permissionless `demote_matured` crank runs.
Bounded — every other staker is paid less meanwhile and has the incentive to
crank, and the frontend exposes a demote-all button — but the fully-parked case
is a liveness assumption, not a guarantee. `instructions/staking.rs`
(`demote_matured`, `claim_lockup_rewards`, `unlock_tokens`).

**(c) `emergency_exit_lockup` rejects post-maturity exits with `StillLocked`.**
A matured lockup must exit through `unlock_tokens`, and the guard is
`require!(now < lock_end, StillLocked)` — so the error a matured lockup sees
is literally "Position is still locked" when the truth is the opposite.
Behaviour is correct; the error name is confusing for integrators and
support. `instructions/staking.rs`, `errors.rs`.

**(d) `recover_foreign_token` error asymmetry.** Source-side violations (the
reward mint, wSOL, an account the program's PDAs do not own) all surface the
specific `InvalidRecoverySource`, but the destination checks
(`destination.mint == source.mint`, `destination.owner == config.dev_wallet`)
are bare Anchor constraints and surface the generic `ConstraintRaw`
(campaign scenario N28). Diagnosability, not a vulnerability.
`instructions/rewards.rs` (`RecoverForeignToken`).

**(e) Dust rewards are buffered, not stranded (previously they were lost).** A
reward smaller than `total_weight / ACC_PRECISION` produces a zero accumulator
delta, so it cannot be distributed the instant it arrives. Rather than lose it
— it is already counted into `reserved_*` — `add_token_rewards` /
`add_sol_rewards` now fold every reward into `pending_*` and drain only whole
per-weight units into the accumulator; the sub-unit remainder stays buffered
and is carried into the next, larger reward. This unifies the empty-pool buffer
and the truncation remainder into one mechanism. Please confirm the carry
arithmetic in `drain_token` / `drain_sol` cannot lose or double-count:
`distributed = delta * total_weight / ACC_PRECISION`, which is `<= pending`, so
the remainder is always non-negative and monotone. `state.rs`
(`add_token_rewards`, `add_sol_rewards`, `drain_token`, `drain_sol`,
`flush_pending`).

**(f) `sweep_influencers` with a zero remainder creates a dead stream.** If
the influencer bucket was fully claimed, the sweep still succeeds and opens a
`CommunityStream` with `total = 0`, which can never be released
(`release_community_stream` requires a positive delta — permanent
`NothingToWithdraw`). Harmless but permanent: a dead account on an immutable
program. `instructions/sweep.rs` (`sweep_influencers`,
`release_community_stream`).

**(g) External dependency: pump.fun's reset authority.** The 90/10 creator-fee
split is set once by the creator and the config admin is revoked — but
pump.fun's fee program carries undocumented `reset_fee_sharing_config` /
`reset_fee_sharing_config_v2` instructions behind a pump.fun-side authority.
The published guarantee is therefore exactly this: the split cannot be changed
*by us*. It is creator-irrevocable, not absolutely immutable. Off-chain of
this program, but it bounds what the fee-routing promise can claim.
`docs/FEES.md` § The one-shot.

**(h) Stream and release boundary conditions.** Two behaviours worth explicit
eyes. First, `Stream::vested` measures from `start`, not from `cliff`: before
the cliff nothing is withdrawable, and at the cliff the entire
`start → cliff` portion vests as a lump (documented and intended for the dev
stream — a cliff delays, it does not re-anchor). Second,
`release_community_stream` boundaries: `CommunityStream::vested` returns zero
at `now <= start` and `total` at `now >= end`, and on a live clock at least
one second elapses between sweep and release, so an "immediate release is
refused" expectation holds only under a frozen test clock (campaign note W6).
Please check the off-by-one edges at `start` / `cliff` / `end`, `duration ==
0`, and the monotonicity of `withdrawn` / `released`. `state.rs` (`Stream`,
`CommunityStream`), `instructions/sweep.rs`.

## 5. Questions we want answered

Beyond a general review, these are the specific places we want an independent
verdict:

1. **Accumulator overflow bounds.** `acc_token_per_weight` /
   `acc_sol_per_weight` are u128 scaled by `ACC_PRECISION = 1e12`, and
   `settle_accrual` computes `weight * delta` before dividing. Deltas are
   largest when `total_weight` was small at distribution time; weights reach
   5x a u64 amount. Prove the bounds — and specifically that no reachable
   state makes a position's `settle` overflow permanently, because a position
   whose settle always errors can never claim, unstake or exit, which on this
   program is bricked funds. `state.rs` (`split_accrual`, `settle_accrual`,
   `distribute_*`), `constants.rs`.

2. **`secp256k1_recover` misuse potential in `claim_original_signer`.**
   Signature malleability (the syscall does not enforce low-s), the header
   byte handling (27–34, compressed and uncompressed ranges mapped to
   recovery ids 0–3), and whether anything depends on signature uniqueness.
   Our understanding: the claim is one-shot, destination-bound inside the
   signed message, and pays only the fixed allocation to the fixed stream, so
   a malleated signature buys an attacker nothing — confirm or correct.
   `utils.rs` (`verify_bitcoin_signature`), `instructions/claims.rs`.

3. **PDA seed collisions on the stream PDA.** `Stream` accounts for
   influencers, the 2014 signer's chosen destination, and the dev wallet all
   live at `[b"stream", beneficiary]`. If one address falls into two roles
   (the dev wallet also in the influencer tree; the signer naming an existing
   beneficiary as destination), the second `init` fails. Which of those
   failure modes are recoverable (the signer can pick another destination) and
   which permanently strand an allocation until its sweep? `claims.rs`,
   `admin.rs` (`CreateDevStream`).

4. **Rent and lamport accounting of the raw `sol_vault`.** The SOL vault is a
   program-owned data account debited directly (`pay_sol_from_vault`), with
   the rent-exempt floor recomputed from `data_len` and never spendable, and
   `sync_sol_rewards` crediting only the surplus above floor plus
   `reserved_sol`. Verify the invariant `lamports >= floor + reserved_sol`
   holds across every path — including `unwrap_wsol`'s before/after
   arithmetic and direct transfers landing mid-transaction — since a state
   where `reserved_sol` exceeds spendable balance would make honest claims
   fail. `instructions/staking.rs` (`pay_sol_from_vault`),
   `instructions/rewards.rs`.

5. **Close-account griefing on lockups.** `unlock_tokens` and
   `emergency_exit_lockup` close the lockup to the owner, and the
   counter-indexed PDA scheme means a closed index can never be re-created.
   Can pre-funding a future lockup PDA (or otherwise occupying predicted
   addresses) grief `lock_tokens`? Any resurrection or same-transaction
   close/reuse angle we missed?

6. **The counter-indexed lockup PDA scheme generally.** `LockupCounter` is
   `init_if_needed`; the client supplies `index` and the handler pins it to
   `counter.count`. Anything about races between concurrent `lock_tokens`
   transactions, the `init_if_needed` surface, or enumeration assumptions the
   frontend makes that the chain does not enforce. `instructions/staking.rs`
   (`LockTokens`, `lock_tokens`), `state.rs` (`LockupCounter`).

## 6. Scope boundaries

- **In scope:** everything in `programs/buddy-distributor/src/`. This is what
  becomes immutable.
- **Frontend and scripts** (`app/`, `scripts/`, `functions/`): out of scope,
  *except* as exploit vectors against the program — a transaction the site
  could be tricked into building is in scope; the site's own XSS surface is
  not.
- **pump.fun's programs** (`pump`, `pump_amm`, `pump_fees`): out of scope.
  They are a documented external dependency (`docs/FEES.md`, and finding (g)
  above); the distributor deliberately contains no coupling to them.
