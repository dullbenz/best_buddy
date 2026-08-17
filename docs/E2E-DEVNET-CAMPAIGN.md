# End-to-end devnet test campaign

Every behaviour the site and docs claim, run against live devnet and recorded with the transaction that proves it. This is the completed, evidenced superset of the scripted rehearsal in [docs/DEVNET-REHEARSAL.md](DEVNET-REHEARSAL.md).

## Results at a glance

| Run | What it covers | Result |
|-----|----------------|--------|
| A — everyone shows up | claims, streams, the full staking suite, rewards, donations, sync, stream maturities | 67 pass · 0 note · 1 fail (of 68) |
| B — nobody shows up | expired windows, all three sweeps, community streams, forfeits reaching stakers | 17 pass · 0 note · 0 fail (of 17) |

📝 = documented behaviour (an edge worth noting for the security review), not a failure.

> **The single Run A ❌ (N19) is a corrected test-harness assertion, not a contract fault.** N19 checks that rewards paid to a lockup *after* it demotes at maturity accrue at exactly 1x, no boost. That on-chain behaviour is correct and is proven deterministically by the bankrun test _"lets a stranger demote a matured lockup, exactly once, and it earns 1x thereafter"_ (`tests/buddy-distributor.ts`). The scenario's *helper* check pre-dated the dust-buffering fix: it expected the reward accumulator to move by exactly `reward · ACC / weight`, but that fix now folds each reward into `pending` and drains only whole per-weight units, so the true delta is `(pending + reward) · ACC / weight` — larger by the carried dust. The assertion was corrected in `scripts/e2e-campaign.ts` to include the pending buffer; the program was not touched.

## How this was tested, and how you can re-check it

Two things are worth being precise about, because "we tested it" is exactly the kind of claim this project refuses to make without evidence.

**What I drove, and how.** Each scenario is a real transaction (or a real, expected rejection) sent by `scripts/e2e-campaign.ts` against a program deployed to devnet. Holders, influencers, stakers, the donor and the fee-payer relay are throwaway wallets the script generates and funds; the 2014-signer path uses a locally generated secp256k1 key so a valid Bitcoin-style signature can actually be produced. Every row below with a `tx` link is a signature you can open on Solscan and inspect independently — the accounts touched, the amounts, the logs.

**What you verify, and how.** I cannot drive a browser wallet like Phantom, so the columns above prove the *contract* behaves correctly, not the *site's* wiring to it. The normal-user equivalent of each area is in [§ Verify it yourself](#verify-it-yourself-as-a-normal-user) — the exact tab, button and expected result to confirm on staging with Phantom.

## Time compression (the `fast-clock` build)

Most windows and locks are month- to year-scale, so the runs used a program compiled with the `fast-clock` cargo feature, which shrinks every wall-clock duration to minutes. The feature is **never a default**, CI never enables it, and `solana-verify` builds default features — so the mainnet bytecode provably contains the real values. The mapping:

| Duration | Mainnet | fast-clock (tests) |
|----------|---------|--------------------|
| Legacy-holder claim window | 30 days | 6 min |
| Influencer claim window | 72 hours | 4 min |
| Influencer stream | 30 days | 3 min |
| Founder/signer stream | 365 days | 5 min |
| 1 / 3 / 5-month locks | 30 / 90 / 150 days | 1 / 2 / 3 min |
| Unstake cooldown | 24 hours | 1 min |
| 2014-signer deadline | 2030-12-31 | Run B build only: back-dated to 2025-01-01, so `sweep_original_signer` (gated `now > deadline`) is reachable |

The claim windows also depend on `claims_start`, an `initialize` parameter: Run A sets it a few minutes in the future (to prove "window not open yet"). Run B sets it to now (`claims_start = 0`) so both windows are open when it locks — `lock_config` now refuses a config whose windows have already closed — then waits them out on chain before the sweeps, deriving each wait from the deadlines the config reports.

## Run A — everyone shows up

Program: [`9Dh1AbVcVELft4mqq72vxeEUMjknTzbwVGQGRURrPcdn`](https://solscan.io/account/9Dh1AbVcVELft4mqq72vxeEUMjknTzbwVGQGRURrPcdn?cluster=devnet) · 68 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S1 | ✅ | initialize rejects an out-of-range cliff (InvalidCliff) | cliff >365d and <0 both rejected [InvalidCliff] | — |
| S2 | ✅ | initialize creates config/pool/vault and stores params | config initialized; allocations stored; locked=false | [tx](https://solscan.io/tx/4rd4RkjQfrEhSMq9tbmuELPYKVjZU1MAmyWcvTze3XgQKvFWRcLw3kX5S83C7ktsoT5j8Xz7Nj4aGpHV3EBDj6Vg?cluster=devnet) |
| S3 | ✅ | initialize cannot run twice | second initialize rejected [AccountInUse] | — |
| S4 | ✅ | fund_vault rejects a non-authority signer (Unauthorized) | rejected [Unauthorized] | — |
| S5 | ✅ | fund_vault rejects a zero amount (ZeroAmount) | rejected [ZeroAmount] | — |
| S6 | ✅ | lock_config refuses while the vault is short (InsufficientBucketBalance) | rejected [InsufficientBucketBalance] | — |
| S7 | ✅ | tokens sent outside fund_vault don't satisfy the lock; fund_vault does | direct transfer left lock short [InsufficientBucketBalance]; fund_vault(1000000) tracked it | [tx](https://solscan.io/tx/3HeTY9EEVkHpHNmr9JaimFhfJ4V5E6TXYR2gH7yYUgpJ6KoEAvCZWQoD1vJmeq3jGBGpoaM4UF7kY7KhiEJnFovv?cluster=devnet) |
| S9 | ✅ | lock_config succeeds once funded; locked=true | locked=true | [tx](https://solscan.io/tx/8cCuaC9M633XqDpk7bFvR4oFvxUhPXQ15gKAMPaKuWaBftiv6msTmU7C1QundUXyrtJdxGBhdeCqw1EwGu92VKX?cluster=devnet) |
| S10 | ✅ | fund_vault rejected after lock (ConfigLocked) | rejected [ConfigLocked] | — |
| S11 | ✅ | lock_config cannot run twice (ConfigLocked) | rejected [ConfigLocked] | — |
| T2 | ✅ | create_dev_stream is permissionless; terms come from init | stranger opened the team stream; total=250000 | [tx](https://solscan.io/tx/67CE1DPq8bMWLmUog2E1mbvmwgiFRi9DqWtPpgDjcho5gJz4ByuSHmuzWG2y2Qdqcu5GM4DZfoLxNBxgyVeGrrQo?cluster=devnet) |
| T3 | ✅ | create_dev_stream cannot run twice | rejected [AccountInUse] | — |
| T4 | ✅ | team stream pays nothing before its cliff (NothingToWithdraw) | pre-cliff withdraw rejected [NothingToWithdraw] | — |
| L5 | ✅ | legacy claim rejected before claims_start (ClaimWindowNotOpen) | rejected before window opens [ClaimWindowNotOpen] | — |
| L1 | ✅ | legacy claim pays the exact amount instantly | paid 90000 instantly | [tx](https://solscan.io/tx/24vA2r3WmpqwkxFNvtWu5w8PiUnkcq3oZCPnbtBXjhphpQ2RfftsBrgStpYaNffLays8EAoayM17Bo4YcFusFnSw?cluster=devnet) |
| L2 | ✅ | the same wallet cannot claim twice | second claim rejected [AccountInUse] | — |
| L3 | ✅ | legacy claim with the wrong amount fails (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| L4 | ✅ | a wallet not in the tree cannot claim (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1 | ✅ | influencer claim opens a stream and pays nothing upfront | stream total=300000, 0 paid upfront | [tx](https://solscan.io/tx/2ey6Noo2vnhqYAxt97ixHJmhMSvZVyjxmRNHTpbDCGw9xHTDXzvLGnhtgeA2S3M9wtEWKSSBGf4baCmSLt7L12y3?cluster=devnet) |
| I3 | ✅ | a non-member cannot claim an influencer allocation (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1b | ✅ | second influencer claims (bucket fully claimed) | influencer 2 claimed 200000 | [tx](https://solscan.io/tx/51sD4bxQd77qaB7aPN96KqgFaioteqEJcWfuPCFxewM7wz8NY1wRyajgmSoZYUeLNPCqCcMXEnpR8EdmgyTNpVtV?cluster=devnet) |
| G1 | ✅ | a signature from the wrong key fails (SignerMismatch) | rejected [SignerMismatch] | — |
| G2 | ✅ | a signature bound to A cannot be replayed for B (SignerMismatch) | replay to a different destination rejected [SignerMismatch] | — |
| G3 | ✅ | a header byte outside 27-34 fails (InvalidRecoveryId) | rejected [InvalidRecoveryId] | — |
| G4 | ✅ | a valid signature, relayed by an unrelated payer, opens the stream | stream opened by relay wallet; total=100000 | [tx](https://solscan.io/tx/246jnP3wwJKB6CCgV6HrQBUagSJDFBsanDzWQYpL9RKqspUJ5GcNzJ9BLwr95hRp5aZcdwTGtci3gagw42KGnK7g?cluster=devnet) |
| G6 | ✅ | the signer cannot claim twice (AlreadyClaimed) | second claim rejected [AccountInUse] | — |
| N24 | ✅ | rewards with nobody staked buffer to pending | 1000 tokens buffered in pending; accumulator untouched | [tx](https://solscan.io/tx/5Q42GETKxLnF7WCcoPiCm9zSxJ1zr8HBxP5hNvUbz4jZk2ERh3iw2KX9brEAJKgGwP21ZjCdR9hv3GT7QtSCABak?cluster=devnet) |
| N1 | ✅ | stake(amount) with no tier argument registers at weight == amount | stake(0) rejected [ZeroAmount]; stake(8000) weight=8000 (1.0x, flexible only) | [tx](https://solscan.io/tx/7VMiKfZohQeWpf7o6wDFdLC1iEucDBNegbhvXWbiv1TVtvmmdvTewNUkjyErfN6N6jrpxrWtRLGjJtfxKfvnhUx?cluster=devnet) |
| N24b | ✅ | first staker + flush_pending collects the buffered rewards exactly | sole staker collected the exact 1000 buffered tokens after flush | [tx](https://solscan.io/tx/3VKwfDoN2rca1B748KiSVdjCEXTH5yrE5RkAkyHMdydA7EFdEvLHNATadwYpRkwwqvMJ9WJAaVdccFNsGRJAC1os?cluster=devnet) |
| N2 | ✅ | unstake without a request fails (NoUnstakeRequested) | rejected [NoUnstakeRequested] | — |
| N3 | ✅ | unstake inside the 24h cooldown (fast: 60s) fails (CooldownActive) | request made; immediate unstake rejected [CooldownActive] | — |
| N5 | ✅ | staking again cancels a pending unstake request | top-up to 10000 zeroed unstake_requested_at; the cooldown restarts from scratch | [tx](https://solscan.io/tx/poDyzc5hPeP6NV28creahq3e518hCHRxY4zGfXvFrPufmwVuUkP3Fo5DQfkr4eChmMZ7KBWYNgzcwD9vdxMg9S7?cluster=devnet) |
| N6 | ✅ | flash-stake bundle (stake huge, sync, claim, unstake) is blocked by the cooldown | bundle rejected atomically [NoUnstakeRequested]: an exit needs a request plus the cooldown, so a flash capture cannot stake and leave in one breath | — |
| N7 | ✅ | lock_tokens at each tier: 2x/3x/5x weight, own index, own lock_end | 10000@2x=20000/60s, 10000@3x=30000/120s, 8000@5x=40000/180s; counter=3; pool weight +90000 | [tx](https://solscan.io/tx/5bs9ZKiEHGZmW5egJbdPqwfm9YsFvJaqDd8ZuaQtummD7mqtbARPwGCKCUjbvBx39DeM9U5VrdJmgbAQNHYxLnVG?cluster=devnet) |
| N8 | ✅ | two lockups for one wallet keep independent clocks, amounts and escrows | lockup#0 10000@2x/60s and lockup#1 8000@5x/180s coexist, each with its own clock (unlock check follows in N8b) | [tx](https://solscan.io/tx/26NEBv5YSvB76h2xGjnwHhQQWysmRJaVK9kx5uohH8LKYiGCZn826tssQL1fxKh6wtE32MqfpMuwD36q4bYorxnk?cluster=devnet) |
| N12 | ✅ | unlock_tokens before maturity fails (StillLocked) | rejected [StillLocked] | — |
| N16 | ✅ | demote_matured before maturity fails (EscrowNotMatured) | rejected [EscrowNotMatured] | — |
| N9 | ✅ | lock_tokens refuses the flexible tier (InvalidTier) | tier 0 must go through stake(); rejected [InvalidTier] | — |
| N10 | ✅ | a lockup index that does not match the counter is rejected (InvalidLockupIndex) | index 5 against count 3, and index 1 with no counter, both rejected [InvalidLockupIndex] | — |
| N22 | ✅ | token + SOL rewards split pro-rata across flexible and lockups; claims pay exact amounts | 200000 tokens + 0.2 SOL over 200000 weight: flexible claimed 10000 + 0.01 SOL all-base; 2x lockup claimed base 10000 with 10000 + 0.01 SOL escrowed | [tx](https://solscan.io/tx/2p1T3Q6N55RNQu6CEdHegHFMJ4XPRTaGr9mrpBi6Pq4nUVhf7YYCGeoVqyK9fJ44xCbN5wYCotrx7ncQY4RW1Fgk?cluster=devnet) |
| N11 | ✅ | claim_lockup_rewards pays base only while locked; the boost escrow stays put | 3x lockup: base 10000 + 0.01 SOL paid; 20000 + 0.02 SOL still escrowed until maturity | [tx](https://solscan.io/tx/5WAbbpR9pZjZF3bUXLsCoyvuNBZ4E5chhM5T9GVkZanBTGpcMXZ5tU6h2dfTgsxTXPLxaJaxE7nQzKndj97qAWuC?cluster=devnet) |
| N13 | ✅ | emergency_exit_lockup: 85% principal + base kept; boost + slash to the pool; siblings untouched | exit paid 7600 (85% of 8000 + base 800); forfeited 3200 boost + 1200 slash redistributed; lockups #0/#1 untouched | [tx](https://solscan.io/tx/4L5rA2T87cbrNk77PXtXURt957Er2vsNG7fKsPecVeTUkXbraDHvZmoWLdV6P8au9DcAeGxsiLs954gBv1HKn8G6?cluster=devnet) |
| N15 | ✅ | no top-up path; a closed lockup leaves nothing behind; re-locking is a fresh entity | exited #3 is gone; re-creating index 3 rejected [InvalidLockupIndex]; new lock is #4 with its own 60s clock. No instruction can top up an existing lockup | [tx](https://solscan.io/tx/58o3TDcHwAoP5BJeHYQii28YxqosrNxXjksMsH9arujPPrFNZZrfokzTV9xhztMqvGHsuXoyouThm1wES3zBu41x?cluster=devnet) |
| R2 | ✅ | sync_sol_rewards with nothing untracked fails (NothingToWithdraw) | rejected [NothingToWithdraw] | — |
| R1 | ✅ | direct SOL is invisible until sync_sol_rewards credits exactly it | credited exactly 500000000 lamports | [tx](https://solscan.io/tx/5vwpHeh7WjmSXiGVYrn6SkxzAYRJ1PDK5GgvNdtufVdQMuwPzqcxpXay9rGEQbYka64cNMqh9C8A8LoTCJBxDXVg?cluster=devnet) |
| R4 | ✅ | direct token transfer is invisible until sync_token_rewards | credited exactly 1000 tokens | [tx](https://solscan.io/tx/5ZtW1u6UD3SQkWkXwGJKAkF6WHxNJekQXasFqKeP5frq7A3PuYGdNNBoLsTDFuQ9HSRyAnwWmUTwMLoYhMo29AMh?cluster=devnet) |
| R5 | ✅ | unwrap_wsol converts vault-held wrapped SOL into lamport rewards | unwrapped 0.3 SOL + closed-account rent to rewards; wSOL account closed | [tx](https://solscan.io/tx/4G9rteF4AYc6manNdXT8b5bS3UBdoXpXHZHhnpcNWTbhnGoDTuyyYfwm4Ce7dUizPtPLvzEQdpfxoYaWGPv8w1zX?cluster=devnet) |
| R6 | ✅ | unwrap_wsol rejects a wSOL account the vault does not own (InvalidWsolAccount) | rejected [InvalidWsolAccount] | — |
| R10 | ✅ | a third party can donate via notify_token_rewards | donor added 500 tokens to the pool | [tx](https://solscan.io/tx/gxp8kV8hJgpVgdJXCQa39LH18TC3fMMfhXbbFCunwc9CihoWaLcVcHXnZsxgJANQW6eimAdQ8To4UqqzN3mL1wQ?cluster=devnet) |
| R8 | ✅ | invariant: vault balances never fall below what is reserved | vault 1116900 >= reserved 1116900; sol ok | — |
| N4 | ✅ | after the cooldown: partial unstake pays principal; full unstake sweeps rewards too | partial paid 4000 exactly; full exit paid 7591287128 raw tokens + 39704914 lamports (principal + all rewards); position empty | [tx](https://solscan.io/tx/5XUHeUW49r9vADG9a2VeRcKcncvyexyaw2E14vJ23qewMVm21FbzwhctuM87X98QosR3292FDJ6ieRC3sdnWSX9k?cluster=devnet) |
| N8b | ✅ | unlocking lockup#0 leaves lockup#1 byte-identical | #0 paid principal 10000 + rewards + released escrow = 23182574257 raw and closed; #1 amount/weight/escrow/clock unchanged | [tx](https://solscan.io/tx/5yMUZKRc9eSKSFZ4vB15yNTzpfQ89iXy9UVH3nyfTdDFVtPy1NR6nN2C2wwU2oVAAfvsw6kgicuEpazoArwcdqDz?cluster=devnet) |
| N17 | ✅ | after maturity a stranger demotes: pool weight falls by exactly 4x amount; escrow becomes claimable | a stranger (not the owner) demoted: pool weight -32000 (4 x 8000), escrow moved to claimable (46365148515 raw) | [tx](https://solscan.io/tx/3w1R4gNPn8LTte8YVnAMXWaUNpDPNP6x8SxJbJqXNBJwvSK69ksqQdDocXEz36RFS6TrRAFFczra2UutEdh9CHcf?cluster=devnet) |
| N18 | ✅ | demoting the same lockup twice fails (AlreadyDemoted) | rejected [AlreadyDemoted] | — |
| N19 | ❌ | rewards distributed after demotion accrue at exactly 1x, no boost | threw: accumulator delta does not match the distribution | — |
| N21 | ✅ | several matured lockups demoted in one transaction (the Fund-pool demote-all shape) | 3 demote instructions in one tx (a single flat fee): pool weight -31000 exactly, all flagged demoted | [tx](https://solscan.io/tx/3ahXojkHkzVieDwQd8GhQFrk9GGqv6sEGwBCxNgdpBBhTdJiQjV9yeFT1ZHUL7bq52wVzKbxt5T7T4bGc8Du2P4S?cluster=devnet) |
| N14 | ✅ | emergency_exit_lockup after maturity fails (StillLocked: use unlock_tokens) | matured lockup must exit via unlock_tokens [StillLocked] | — |
| N20 | ✅ | unlock_tokens on a never-demoted matured lockup pays principal + rewards + boost in one call | one call: principal 8000 + base + inline-released boost = 60079434229 raw tokens, 198819659 lamports rewards, rent back | [tx](https://solscan.io/tx/3XvaswWcjDKuJk3AXqQLkveEj5Z1QKL2iF9xh2SHRuXQTGkL9mgU8PnSpK5S1BvBnR9ioXUytE1mEoTpmaRpWQ5i?cluster=devnet) |
| N23 | ✅ | wSOL wrap then unwrap_wsol then SOL claimed by a lockup holder | 0.15 wrapped SOL unwrapped into the pool; a lockup holder claimed 161149422 lamports (+29059575672 raw tokens), both exact | [tx](https://solscan.io/tx/2pdEZDGUyVX2wHF1bxQ83hWSk5YBQC8yv72VgiQZPSzDStBrXhKWdPvaSMHBJDrFA9BQNYiXr49Zj46ttVtiKVLF?cluster=devnet) |
| N25 | ✅ | invariant after mixed lock/unlock/exit/demote churn: vaults never fall below reserved | vault 1012987 >= reserved 1012987; sol vault 635948256 >= reserved 634994736 lamports | — |
| N26 | ✅ | recover_foreign_token forwards a stray SPL token to the team wallet, closes the stray, rent to the cranker | 5000 foreign tokens forwarded to the dev wallet's ATA; stray account closed; 2039280 lamports rent to the cranker | [tx](https://solscan.io/tx/4stv1TwuTKjF1UrKMmzLaV1mnx5zW2yAzUoLLw2Vf7o5NwAb4pTKT4q4yp1TgeXQwfND5nbZ2SgSAdTHCNLmiwJ?cluster=devnet) |
| N27 | ✅ | recovery refuses the reward mint and wSOL (InvalidRecoverySource) | the reward vault itself and a vault-owned wSOL account both rejected [InvalidRecoverySource] | — |
| N28 | ✅ | recovery to a destination the team wallet does not own is rejected | destination owned by a stranger rejected [ConstraintRaw] | — |
| I4 | ✅ | influencer stream vests fully and pays the whole amount by the end | full 300000 withdrawn at maturity | [tx](https://solscan.io/tx/2QzCiS9WbtJ3yKat7WCWvkH4L3MCLjvkdHEipmk9sA8rKidgZeXnyo84W33qKSFhvgsojWcJvyaugjU9gSnzrCVE?cluster=devnet) |
| I4b | ✅ | a matured, fully-withdrawn stream yields nothing further | re-withdraw rejected [NothingToWithdraw] | — |
| G7 | ✅ | the 2014 signer stream vests and pays in full | full 100000 withdrawn | [tx](https://solscan.io/tx/3BbPBfaXvk1TFWJKPYgZV9Tk5a6wrdYZRf2zDNcFBrynHew5QxerjLcsqXNxVujxdMeWGqa9gSVWCENWfH7nc1zT?cluster=devnet) |
| T6 | ✅ | the team stream vests and pays in full by the end | full 250000 withdrawn | [tx](https://solscan.io/tx/39ZKD6XcxiGqqqHzNJgUHCxmtFh2g3LdQG6DpvyAUYG17iW9LGKoWVrpnCs5R4SMoNvPsJJmm9AfTM35Y92TuQXU?cluster=devnet) |
| T7 | ✅ | stream_withdraw signed by a non-beneficiary fails | rejected [ConstraintSeeds] | — |

## Run B — nobody shows up

Program: [`J4nnnNeT9ZWjFWVeteWgFmheKcUnL6BPtSz8GjWgKC6i`](https://solscan.io/account/J4nnnNeT9ZWjFWVeteWgFmheKcUnL6BPtSz8GjWgKC6i?cluster=devnet) · 17 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S2b | ✅ | initialize with claims_start = now (0); both windows open | initialized with claims_start = now; both claim windows open at lock | [tx](https://solscan.io/tx/5sXFuHTpL4qNgqKc5CXYxFd9uCVsykyfJDLom8vQZeGrLYrDrMCSpLt864HaegQEDLyjBL12HrvHBnjG3m7mvdhe?cluster=devnet) |
| S12 | ✅ | claims are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| S13 | ✅ | sweeps are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| L6 | ✅ | a legacy claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| I5 | ✅ | an influencer claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W2 | ✅ | sweep_old_holders credits the unclaimed remainder to the pool instantly | credited full 150000 (nobody claimed) to the pool at once | [tx](https://solscan.io/tx/WLR6Rfdz3sfwwtUS4rpjSzB5xM612mQXu58GazDentgWws4EjHB7RbhMzgjeFZAeJ7wghbL9g1FNk134EEW9npX?cluster=devnet) |
| W3 | ✅ | sweep_old_holders cannot run twice (AlreadyClaimed) | rejected [AlreadyClaimed] | — |
| W4 | ✅ | a legacy claim after the sweep fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W9 | ✅ | a 2014-signer claim after the deadline fails (ClaimWindowClosed) | rejected past the deadline [ClaimWindowClosed] | — |
| W8 | ✅ | sweep_original_signer opens a community stream for the whole allocation | kind1 community stream total=100000, streaming to stakers | [tx](https://solscan.io/tx/2VCRVqv8ZHKDzGVXqLKPF86PPmSQSWdJHKbH665o23uSnEBV7rpxaudPucAW7rM1P3wJPZndu2burzqUa18LpAiM?cluster=devnet) |
| W5 | ✅ | sweep_influencers opens a 30-day community stream for the remainder | community stream kind0 total=500000, streaming to stakers | [tx](https://solscan.io/tx/51UBVBEn6wiJ4e8hubxQ6DAFKpq2uzp1mKEfyEwwC4zLv3uBPWepwuh6JKAviereStFPB4XndeNrSYHqePZXYTH7?cluster=devnet) |
| W6 | ✅ | releasing the community stream immediately yields nothing (NothingToWithdraw) | rejected [NothingToWithdraw] | — |
| W7 | ✅ | release_community_stream credits roughly half at the halfway point | credited ~52% of the forfeit at the halfway point | [tx](https://solscan.io/tx/5Xvd3FJ9HprSdMFHhf6TPpqgmKLvmB4dFjqdKfQTXbN7N7dDDMhETJzc75JX71srM1pW4WxtB6nf4Ypue9x4iESM?cluster=devnet) |
| W7b | ✅ | at the end the full forfeit has reached the pool exactly once | released == total == 500000 | [tx](https://solscan.io/tx/5ygzz8SE7yLLSDKQi8KotqBMYRTFgqrARN23PxkH2YsscJNM7JbRnWUzj4zTdViixEoWJhyRMgJbzLkbM3hT7imw?cluster=devnet) |
| W7c | ✅ | a fully-released community stream yields nothing further | rejected [NothingToWithdraw] | — |
| W8b | ✅ | release_community_stream credits the signer forfeit to the pool as it vests | credited 63333 so far of 100000; released=63333 | [tx](https://solscan.io/tx/2kdW6jDC2ccJAbmjFie5yfrg5B8soTXnZEPVdWNZSjPbVqV4yi8o2NvzHpZ8QkEKcQwVJ2uxcUjcH2uJcGLzMAuf?cluster=devnet) |
| W11 | ✅ | a staker can withdraw the swept/forfeited value as real tokens | sole staker claimed 713333 tokens of swept+forfeited value | [tx](https://solscan.io/tx/26yR42aPkvCpsa7nEC41xF7FRut3k5ipGKMurz9938d3nnTkqQvJd6inTV8mGPYajTvDfDZXzS1gQxt7yi3Fhh4Z?cluster=devnet) |

## What is NOT covered here, and where it is

- **The pump.fun creator-fee chain** (setting the one-shot 90/10 split, and collecting accrued fees). pump.fun has no devnet deployment, so this is impossible to rehearse on devnet. It stays the mainnet throwaway-coin step in [TO-THE-MOON §1.5](../TO-THE-MOON.md). The distributor contract itself contains no pump.fun coupling — that lives in `app/src/pumpfun.ts` — so nothing in the contract campaign depends on it.
- **The exact 2030 boundary with real constants.** Covered by the bankrun suite's time-travel test "returns the allocation to the community after the 2030 deadline". On devnet, Run B exercised the same code path with the deadline back-dated in the build.
- **The Squads team-withdraw** (`stream_withdraw` signed by a multisig vault). Proven separately by the final deployment (F) and the Squads plumbing test.

## Findings for the security review

The staking redesign turned the old quirks into enforced properties. What remains are design points an auditor should still see stated plainly — none a bug, each backed by the scenario that exercises it:

- **Everything runs after the lock.** `stake`, `lock_tokens`, the `notify_*`/`sync_*` reward paths and `unwrap_wsol` all assert the config is locked, so none can run before `lock_config` (S12/S13). That is what makes the lock's solvency check real: before the lock `reserved_token` rises *only* through `fund_vault`, so staker principal and stray donations cannot pre-satisfy it.
- **Per-lockup entities, no top-up.** Every locked commitment is its own `Lockup` account created by `lock_tokens(amount, tier, index)` against an owner-scoped counter. No instruction adds to an existing lockup, a closed lockup's index cannot be reused, and re-locking is always a fresh entity with its own clock (N15). Flexible `stake` is the only mutable position, at 1x.
- **Maturity is demoted by a permissionless crank.** A matured lockup keeps its boosted weight in the pool until it is demoted to 1x; anyone can crank that demotion — in a batch (N21) or inline when the owner unlocks or claims (N20) — and an owner's own claim auto-demotes their matured lockups. A matured-but-un-cranked lockup over-weights the pool only until the next crank, which is a public, incentive-aligned action rather than a privileged one.
- **One 24-hour floor on every principal exit.** A flexible unstake (N4) and a locked early exit (`emergency_exit_lockup`, N13) are gated by the same 24-hour floor (`CooldownActive`), so no route pulls principal out inside a day. The early exit keeps 85% of principal plus accrued base and forfeits the boost escrow plus a 15% slash, redistributed to the stakers who stayed. One edge survives: a *partial* flexible unstake leaves `unstake_requested_at` set, so after one cooldown a flexible staker can make repeated partial unstakes without waiting again.
- **Reward dust buffers instead of stranding.** Rewards that arrive with nobody staked, or too small to move the per-weight accumulator, settle into `pending_*` and are flushed to the next staker (N24/N24b) rather than left stranded in the vault.
- **An empty influencer sweep opens a dead stream.** `sweep_influencers` creates its community stream unconditionally, so sweeping with nothing unclaimed would open a `total = 0` stream that can never release (permanent `NothingToWithdraw`). Harmless, but a dead account; `sweep_old_holders` instead guards on `remaining > 0`.

## Verify it yourself, as a normal user

Against staging (`staging.mybestbuddy.fun`, devnet, behind the basic-auth gate) pointed at the final deployment, with Phantom set to devnet:

1. **See the numbers (no wallet).** Open **Dashboard**. Confirm *Initial distribution* equals the published total and the four allocations match 15 / 50 / 10 / 25. Open **Home** and confirm the allocation shares read the same, live from chain. These are the same values the campaign asserted on chain.
2. **Check an address (no wallet).** On **Claims → Overview**, paste one of the published holder addresses; it should report what that wallet is owed. Paste a random address; it should report nothing.
3. **Claim (Phantom).** With a wallet that holds a legacy allocation, open **My Buddy → Your claims** and claim; the tokens arrive instantly (this is the L1 path). An influencer wallet instead opens a stream (I1) and withdraws over time from the same page.
4. **Stake (Phantom).** **My Buddy → Your stake**: open a lock-up at a locked tier (each lock-up is its own entity), confirm base rewards are claimable while the boost stays escrowed until maturity (N11), and that an early exit forfeits the boost + 15% (N13). A second lock-up gets its own independent clock (N7/N8). Nothing — flexible unstake or locked early exit — can pull principal out inside the first 24 hours.
5. **Crank the pool (Phantom, permissionless).** **Fund pool**: after the windows close, run a sweep, then `release`/`sync` — anyone's wallet can, which is the W-series on this page.
6. **The team withdrawal (Squads app).** The team stream pays a multisig vault, so its withdrawal is a Squads proposal, not a site action — `scripts/team-withdraw.ts` builds it. This is deliberately the one flow the site cannot do for you.

_Generated by `scripts/e2e-report.ts` from the campaign run logs._
