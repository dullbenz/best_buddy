# Retest plan — staking redesign (v2)

The staking model changed after the first campaign
([E2E-DEVNET-CAMPAIGN.md](E2E-DEVNET-CAMPAIGN.md)). This document is the
delta: what changed, which proven scenarios are invalidated by it, and the
full list of what must run again on devnet before the security review.

## What changed

| # | Change | Why |
|---|---|---|
| 1 | Flexible cooldown **3 days → 24 hours**, with the reason stated on the site | Flexible should feel flexible; the delay's only job is stopping flash-stake capture of visibly accrued fee pots, and 24h does that |
| 2 | **Each lock-up is its own on-chain entity** (own amount, tier, maturity clock, escrow), created by `lock_tokens`, listed and withdrawn separately | No commingling: top-up rules, tier upgrades and the matured-multiplier loophole cease to exist as concepts |
| 3 | **Boost applies only while the lock runs.** At maturity the escrowed boost is released and the lock-up drops to 1× until withdrawn — via the permissionless `demote_matured` crank, or automatically inside `unlock_tokens` | The multiplier prices commitment; it must end when the commitment ends |
| 4 | Tiers: **1× flexible · 2×/1 month · 3×/3 months · 5×/5 months** | New economics; 12-month tier removed |
| 5 | New permissionless `recover_foreign_token`: stray non-$BUDDY/wSOL tokens forward to the team multisig (disclosed), instead of stranding forever in an immutable program | Nothing donated should be unrecoverable |
| 6 | Instructions removed: `withdraw_boost_escrow`, position `emergency_exit`, locked-tier `stake` path. Added: `lock_tokens`, `claim_lockup_rewards`, `demote_matured`, `unlock_tokens`, `emergency_exit_lockup`, `recover_foreign_token` | |
| 7 | fast-clock v2: locks 1/2/3 min, cooldown 1 min, influencer window 4 min, holder window 6 min, streams 3/5 min — longest single wait ≤ 6 min | Faster reruns; campaign runs through the keyed staging RPC (`RPC_ORIGIN`) to avoid public rate limits |

## Still valid from the first campaign (no retest needed)

Everything that never touched the staking position model: setup & lock
(S1–S13), team stream & Squads flow (T1–T9), legacy claims (L1–L8),
influencer claims (I1–I6), the 2014 signer (G1–G8), sweeps & community
streams (W1–W9), and the sync/rent/wSOL mechanics themselves (R1–R6). The
program changes do not touch those instructions; the retest re-runs a smoke
subset of them anyway (below) to prove the rebuild didn't regress them.

## Invalidated (model no longer exists)

K9–K24, K27–K29 as originally written (position-based locks, escrow release
by owner, tier top-up/upgrade rules, position emergency exit), plus the three
documented quirks they surfaced — **K14, K16, and the matured-top-up hole are
all designed out** and get explicit "no longer possible" probes instead.

## The retest matrix

### Flexible (24h cooldown)
| ID | Scenario | Expect |
|---|---|---|
| N1 | stake (no tier argument) registers at weight == amount | ok |
| N2 | unstake without request | NoUnstakeRequested |
| N3 | unstake inside 24h (fast: 1 min) | CooldownActive |
| N4 | after cooldown: partial then full unstake; full pays rewards too | ok |
| N5 | staking again cancels a pending request | ok |
| N6 | **flash-stake probe**: stake-huge → sync → claim → unstake in one bundle | blocked by cooldown |

### Lock-ups as separate entities
| ID | Scenario | Expect |
|---|---|---|
| N7 | `lock_tokens` at each tier: weights 2×/3×/5×, own index, own lock_end | ok |
| N8 | two lock-ups same wallet, different days: independent clocks, amounts, escrows; withdrawing one leaves the other untouched | ok |
| N9 | lock at tier 0 (flexible) via `lock_tokens` | InvalidTier |
| N10 | wrong index (≠ counter) | rejected |
| N11 | `claim_lockup_rewards` pays base only while locked; escrow intact | exact math |
| N12 | `unlock_tokens` before maturity | StillLocked |
| N13 | `emergency_exit_lockup` pre-maturity: 85% principal, base kept, boost+slash to pool, account closed; the *other* lock-up of the same wallet unaffected | exact math |
| N14 | `emergency_exit_lockup` after maturity | StillLocked (use unlock) |
| N15 | old quirks impossible: no top-up path exists; a closed lock-up leaves nothing behind; re-locking creates a fresh entity with a fresh clock | ok |

### Boost ends at maturity
| ID | Scenario | Expect |
|---|---|---|
| N16 | before maturity, `demote_matured` | EscrowNotMatured |
| N17 | after maturity, anyone demotes: escrow → claimable, weight → 1×, pool weight falls by the boost portion | exact math |
| N18 | demote twice | AlreadyDemoted |
| N19 | rewards distributed *after* demotion split at 1× (no boost accrues) | exact math |
| N20 | `unlock_tokens` on a never-demoted matured lock-up demotes inline and pays principal + rewards + released boost in one call | exact math |
| N21 | batch: several matured lock-ups demoted in one transaction (the Fund-pool "demote all" shape); fee stays a single flat tx fee | ok |

### Reward forms and pool interplay (regression of the model change)
| ID | Scenario | Expect |
|---|---|---|
| N22 | token + SOL rewards split pro-rata across a flexible stake and live lock-ups of different tiers; each claims and receives exact amounts | exact math |
| N23 | wSOL wrap → `unwrap_wsol` → SOL claimed by a lock-up holder | ok |
| N24 | rewards with nobody staked buffer to pending; first staker + flush collects | ok |
| N25 | vault ≥ reserved invariant after mixed lock/unlock/exit/demote operations | ok |

### Foreign-token recovery
| ID | Scenario | Expect |
|---|---|---|
| N26 | stray SPL mint sent to an ATA owned by sol_vault: `recover_foreign_token` forwards to the team multisig's ATA, closes the stray account, rent to the cranker | ok |
| N27 | attempt on the reward mint or wSOL | rejected |
| N28 | destination not owned by the team multisig | rejected |

### Smoke re-runs of unchanged suites
S-series lock checks, one legacy claim + double-claim, one influencer claim +
stream withdraw, signer claim happy path, sweep_old_holders + community-stream
release, R1/R4 syncs — proving the rebuild left them intact.

## Also updated by this change

Bankrun suite rewritten for the new model; `devnet-rehearsal.ts` updated
(flexible stake signature); app: My Buddy lists lock-ups individually with
per-lock-up claim/unlock/exit and a demote-all crank on Fund pool; site copy
(tier table, cooldown explainer); PRE-COMMITMENT tier table.

_Every row lands in the regenerated campaign report with a devnet tx
signature, exactly like the first campaign._
