# End-to-end devnet test campaign

Every behaviour the site and docs claim, run against live devnet and recorded with the transaction that proves it. This is the completed, evidenced superset of the scripted rehearsal in [docs/DEVNET-REHEARSAL.md](DEVNET-REHEARSAL.md).

## Results at a glance

| Run | What it covers | Result |
|-----|----------------|--------|
| A — everyone shows up | claims, streams, the full staking suite, rewards, donations, sync, stream maturities | 68 pass · 0 note · 0 fail (of 68) |
| B — nobody shows up | expired windows, all three sweeps, community streams, forfeits reaching stakers | 16 pass · 1 note · 0 fail (of 17) |

📝 = documented behaviour (an edge worth noting for the security review), not a failure.

> **The single Run B 📝 (W6) is a fast-clock timing artifact, not a contract fault.** W6 expects `release_community_stream` to find nothing withdrawable in the same instant the sweep opened the stream. Under the compressed 3-minute stream, at least one second has vested by the time the release transaction lands on devnet, so a tiny first release succeeds instead of rejecting. W7 immediately proves the schedule itself: ~half the forfeit at the halfway mark, the exact total at the end, and `NothingToWithdraw` on every attempt after. With the real 30-day stream the same-second window is unhittable by a human.

## How this was tested, and how you can re-check it

Two things are worth being precise about, because "we tested it" is exactly the kind of claim this project refuses to make without evidence.

**What I drove, and how.** Each scenario is a real transaction (or a real, expected rejection) sent by `scripts/e2e-campaign.ts` against a program deployed to devnet. Holders, influencers, stakers, the donor and the fee-payer relay are throwaway wallets the script generates and funds; the 2014-signer path uses a locally generated secp256k1 key so a valid Bitcoin-style signature can actually be produced. Every row below with a `tx` link is a signature you can open on Solscan and inspect independently — the accounts touched, the amounts, the logs.

**The mint is Token-2022, deliberately.** pump.fun creates coins through `create_v2` whenever its `create_v2_enabled` flag is on — it is on for mainnet — and `create_v2` mints under **Token-2022**, not classic SPL Token. The campaign's reward mint is therefore a Token-2022 mint carrying a metadata-pointer extension, the exact shape `create_v2` produces, and every instruction runs through the token interface with `transfer_checked`. wSOL remains classic SPL, so the `unwrap_wsol` scenarios exercise the mixed pairing the launch will actually have.

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

Program: [`ASQtCPyMvBDsVJd53aRXwxPq5cuaq7DAor5jNw4yBQVV`](https://solscan.io/account/ASQtCPyMvBDsVJd53aRXwxPq5cuaq7DAor5jNw4yBQVV?cluster=devnet) · 68 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S1 | ✅ | initialize rejects an out-of-range cliff (InvalidCliff) | cliff >365d and <0 both rejected [InvalidCliff] | — |
| S2 | ✅ | initialize creates config/pool/vault and stores params | config initialized; allocations stored; locked=false | [tx](https://solscan.io/tx/4is7m3yrSqF6dXxCpHCQUDGLfPQkPJGVaFGia1M9AqXZ3jav7v1C9Km65AExLgoPP4ffymJ87YCSfhhwATwqmLju?cluster=devnet) |
| S3 | ✅ | initialize cannot run twice | second initialize rejected [AccountInUse] | — |
| S4 | ✅ | fund_vault rejects a non-authority signer (Unauthorized) | rejected [Unauthorized] | — |
| S5 | ✅ | fund_vault rejects a zero amount (ZeroAmount) | rejected [ZeroAmount] | — |
| S6 | ✅ | lock_config refuses while the vault is short (InsufficientBucketBalance) | rejected [InsufficientBucketBalance] | — |
| S7 | ✅ | tokens sent outside fund_vault don't satisfy the lock; fund_vault does | direct transfer left lock short [InsufficientBucketBalance]; fund_vault(1000000) tracked it | [tx](https://solscan.io/tx/2a4MTULi8YttdpMVJU464kdJPGy41gj7ZEYgwXPPCBkPeo7N4Lnfp85sscEze5tNDQegAYB1PV4vS6AMrpWpFMy1?cluster=devnet) |
| S9 | ✅ | lock_config succeeds once funded; locked=true | locked=true | [tx](https://solscan.io/tx/33huJfBqT68XciZNVW68R3bgffnPSXrfPW3r2XqYAp74GmVMWLJwfiSKr9CoKJxVNjoH5vG14iVb3hUMy8xmfZpK?cluster=devnet) |
| S10 | ✅ | fund_vault rejected after lock (ConfigLocked) | rejected [ConfigLocked] | — |
| S11 | ✅ | lock_config cannot run twice (ConfigLocked) | rejected [ConfigLocked] | — |
| T2 | ✅ | create_dev_stream is permissionless; terms come from init | stranger opened the team stream; total=250000 | [tx](https://solscan.io/tx/66x5nQWRpSo7kmKb1uhqor22YVpM2MTFmoHBrndKd35r52MJtUT9zi4Vvhr3e3BTBh6AZJRWMzvs4fN6KgUCUoP9?cluster=devnet) |
| T3 | ✅ | create_dev_stream cannot run twice | rejected [AccountInUse] | — |
| T4 | ✅ | team stream pays nothing before its cliff (NothingToWithdraw) | pre-cliff withdraw rejected [NothingToWithdraw] | — |
| L5 | ✅ | legacy claim rejected before claims_start (ClaimWindowNotOpen) | rejected before window opens [ClaimWindowNotOpen] | — |
| L1 | ✅ | legacy claim pays the exact amount instantly | paid 90000 instantly | [tx](https://solscan.io/tx/ZUb8kxhymmoCaD7DEWwLUtyjEP8b5tkXvWkNCveA1sh28vCW1FV3fZwyvZpatPCJbQQ9qk9vG2sfQj9ajkDDeZP?cluster=devnet) |
| L2 | ✅ | the same wallet cannot claim twice | second claim rejected [AccountInUse] | — |
| L3 | ✅ | legacy claim with the wrong amount fails (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| L4 | ✅ | a wallet not in the tree cannot claim (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1 | ✅ | influencer claim opens a stream and pays nothing upfront | stream total=300000, 0 paid upfront | [tx](https://solscan.io/tx/4FP3Pt89x6CNcPcMj9psGfQrFGQbk1iqaFtK7rPmiFwnqAyhyGWENTUeeAXn7mF7cyeTP4Fy8je7b3F4pkp9MfBi?cluster=devnet) |
| I3 | ✅ | a non-member cannot claim an influencer allocation (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1b | ✅ | second influencer claims (bucket fully claimed) | influencer 2 claimed 200000 | [tx](https://solscan.io/tx/2emBYZ6qiLuxk51s7bN9G5QwmYbd1Va38CvFDdbbW6p378KQw3qWyGvJEYd8Y9zpeMhowaSyGxoq2DT2W1jSYcgR?cluster=devnet) |
| G1 | ✅ | a signature from the wrong key fails (SignerMismatch) | rejected [SignerMismatch] | — |
| G2 | ✅ | a signature bound to A cannot be replayed for B (SignerMismatch) | replay to a different destination rejected [SignerMismatch] | — |
| G3 | ✅ | a header byte outside 27-34 fails (InvalidRecoveryId) | rejected [InvalidRecoveryId] | — |
| G4 | ✅ | a valid signature, relayed by an unrelated payer, opens the stream | stream opened by relay wallet; total=100000 | [tx](https://solscan.io/tx/4L3sv97mZjxRxvdzMJYKgTdrwgDY4EisQfaCv2BGW3J3fxXs7UNpwiQZoBDVSwVWGeShatKVVuYEbYR5BU5rZEDe?cluster=devnet) |
| G6 | ✅ | the signer cannot claim twice (AlreadyClaimed) | second claim rejected [AccountInUse] | — |
| N24 | ✅ | rewards with nobody staked buffer to pending | 1000 tokens buffered in pending; accumulator untouched | [tx](https://solscan.io/tx/4We1GLanEMkM4Hq7EN4xMA4o6yWzuLvjFZdcEx7SQe5yyUNszrk9Z2njJWku4gzcyJPr3uHAM2Vptav2PDsyCH2U?cluster=devnet) |
| N1 | ✅ | stake(amount) with no tier argument registers at weight == amount | stake(0) rejected [ZeroAmount]; stake(8000) weight=8000 (1.0x, flexible only) | [tx](https://solscan.io/tx/4SHmbuxA7MVAjBhtF475g9p2Z61Ybi9vmtZgSTjBM1FnXd6hNFFNKvzwA4dbtZ1i1NhpSP1UNCuqhgaNsCSmZWfx?cluster=devnet) |
| N24b | ✅ | first staker + flush_pending collects the buffered rewards exactly | sole staker collected the exact 1000 buffered tokens after flush | [tx](https://solscan.io/tx/4xYGTszyxTUkG7b5auu57qY3DecGn8sqJacyWUABWYcZM8wtxCuZDxmgKbEs15BohhePhxM2oiE49qBU7HTRvn8F?cluster=devnet) |
| N2 | ✅ | unstake without a request fails (NoUnstakeRequested) | rejected [NoUnstakeRequested] | — |
| N3 | ✅ | unstake inside the 24h cooldown (fast: 60s) fails (CooldownActive) | request made; immediate unstake rejected [CooldownActive] | — |
| N5 | ✅ | staking again cancels a pending unstake request | top-up to 10000 zeroed unstake_requested_at; the cooldown restarts from scratch | [tx](https://solscan.io/tx/3QSkBhDj3QrWxLrRS1nnUk3vW9j7CgCsmwxdcUDWKCAtMHx5KQzDGz9TuU6Abujuac2ZyUVEAQATEpK5H7MRMMGo?cluster=devnet) |
| N6 | ✅ | flash-stake bundle (stake huge, sync, claim, unstake) is blocked by the cooldown | bundle rejected atomically [NoUnstakeRequested]: an exit needs a request plus the cooldown, so a flash capture cannot stake and leave in one breath | — |
| N7 | ✅ | lock_tokens at each tier: 2x/3x/5x weight, own index, own lock_end | 10000@2x=20000/60s, 10000@3x=30000/120s, 8000@5x=40000/180s; counter=3; pool weight +90000 | [tx](https://solscan.io/tx/29pvM6ba6e6A3rCoSACN1bzuxjtbgfvcHKivXF5e3fH3vWPc5Pw8zLW1WRXnzb814sCi7cYdLL1fuDx5jvbbQr9X?cluster=devnet) |
| N8 | ✅ | two lockups for one wallet keep independent clocks, amounts and escrows | lockup#0 10000@2x/60s and lockup#1 8000@5x/180s coexist, each with its own clock (unlock check follows in N8b) | [tx](https://solscan.io/tx/96fvCPq1bD91A9xTJNJGq5PyFTmrYM8uM3iksosA2zVJK9VbvUHjQDWSwxHYPg6yJmS1sDPGnbWETcuakgWqUUp?cluster=devnet) |
| N12 | ✅ | unlock_tokens before maturity fails (StillLocked) | rejected [StillLocked] | — |
| N16 | ✅ | demote_matured before maturity fails (EscrowNotMatured) | rejected [EscrowNotMatured] | — |
| N9 | ✅ | lock_tokens refuses the flexible tier (InvalidTier) | tier 0 must go through stake(); rejected [InvalidTier] | — |
| N10 | ✅ | a lockup index that does not match the counter is rejected (InvalidLockupIndex) | index 5 against count 3, and index 1 with no counter, both rejected [InvalidLockupIndex] | — |
| N22 | ✅ | token + SOL rewards split pro-rata across flexible and lockups; claims pay exact amounts | 200000 tokens + 0.2 SOL over 200000 weight: flexible claimed 10000 + 0.01 SOL all-base; 2x lockup claimed base 10000 with 10000 + 0.01 SOL escrowed | [tx](https://solscan.io/tx/23oixzqFvkwkB1TitpMHTJnGikKhL66q38DHBkCXvMXhPfN1x99YUQcgcEkMAU4rM7baxn18gkRMDAn725CJXKs6?cluster=devnet) |
| N11 | ✅ | claim_lockup_rewards pays base only while locked; the boost escrow stays put | 3x lockup: base 10000 + 0.01 SOL paid; 20000 + 0.02 SOL still escrowed until maturity | [tx](https://solscan.io/tx/3FPSeHFg7E3dGAXSudYECJsLGeqPZecWxfX5A16F27emEyWmq56WDY1fZ7g16XgENFep9EFFQfc7QRxM13FxuHDy?cluster=devnet) |
| N13 | ✅ | emergency_exit_lockup: 85% principal + base kept; boost + slash to the pool; siblings untouched | exit paid 7600 (85% of 8000 + base 800); forfeited 3200 boost + 1200 slash redistributed; lockups #0/#1 untouched | [tx](https://solscan.io/tx/4Twf1kpLHwPGykWXZXeRwJcywZZ2rM1Mhb2poB71B4DRBPa7FjTBYCXjKaBoRMJxTAATaCu6P4vdkzDC4DWWnp5D?cluster=devnet) |
| N15 | ✅ | no top-up path; a closed lockup leaves nothing behind; re-locking is a fresh entity | exited #3 is gone; re-creating index 3 rejected [InvalidLockupIndex]; new lock is #4 with its own 60s clock. No instruction can top up an existing lockup | [tx](https://solscan.io/tx/5q2pWWfoRkuRWT8jSY1dNUbLKEppHZaav8XtqWUw72XXptMJaUTYYi9TQaHs2fw87ozvNsc7CuXwkyS3VXC1D2Ce?cluster=devnet) |
| R2 | ✅ | sync_sol_rewards with nothing untracked fails (NothingToWithdraw) | rejected [NothingToWithdraw] | — |
| R1 | ✅ | direct SOL is invisible until sync_sol_rewards credits exactly it | credited exactly 500000000 lamports | [tx](https://solscan.io/tx/4Ac8FCAtgcsWConZtDAvqKQMgvuNNc72QkddaWBzSnzwvNQkyMPdMBueTRvZNhfZvFBtLpwN6GHqkxpdBPDamGkz?cluster=devnet) |
| R4 | ✅ | direct token transfer is invisible until sync_token_rewards | credited exactly 1000 tokens | [tx](https://solscan.io/tx/3gSAWYW33ywtByCWoncgiHUkDdLJpsJVbKyHCFH8hnVG2YsdivimR3xxxXMHbcKMPg1J8EYT27LREuUm4ootY67x?cluster=devnet) |
| R5 | ✅ | unwrap_wsol converts vault-held wrapped SOL into lamport rewards | unwrapped 0.3 SOL + closed-account rent to rewards; wSOL account closed | [tx](https://solscan.io/tx/5VTKmHkBx9nNAY5q3fnTZpTQ8qHoHMPiuTca6QmFY8i56vBCnFbSBf35WHVqQkBsnZB5jdgGmbHxQ6GfE24hmEUT?cluster=devnet) |
| R6 | ✅ | unwrap_wsol rejects a wSOL account the vault does not own (InvalidWsolAccount) | rejected [InvalidWsolAccount] | — |
| R10 | ✅ | a third party can donate via notify_token_rewards | donor added 500 tokens to the pool | [tx](https://solscan.io/tx/3amZa1L2uKvXZN9c4Ms8YuuqLnyn5cLQBcGSvbuHusS7shQoWnuUmr5Xfj7fY7vYRGopjk6s89ffJcJJF7U181M4?cluster=devnet) |
| R8 | ✅ | invariant: vault balances never fall below what is reserved | vault 1116900 >= reserved 1116900; sol ok | — |
| N4 | ✅ | after the cooldown: partial unstake pays principal; full unstake sweeps rewards too | partial paid 4000 exactly; full exit paid 7591287128 raw tokens + 39704914 lamports (principal + all rewards); position empty | [tx](https://solscan.io/tx/5CFPGACFLSAkERbePyrfYmeUunUjpBjQCeFdxDERdcyh2Zoon64VcaZKZjaW1RHaZ53YrXWaj9JMeNGHpNB3dxj9?cluster=devnet) |
| N8b | ✅ | unlocking lockup#0 leaves lockup#1 byte-identical | #0 paid principal 10000 + rewards + released escrow = 23182574257 raw and closed; #1 amount/weight/escrow/clock unchanged | [tx](https://solscan.io/tx/2V9UWeqM7KezYTAfjcwsc7mFduEagXNYwBVXMTtXrLu3oi6PeBEbVrDWzFDoTmbmBq5p8JR9oBFLdFRu4JAqZdoq?cluster=devnet) |
| N17 | ✅ | after maturity a stranger demotes: pool weight falls by exactly 4x amount; escrow becomes claimable | a stranger (not the owner) demoted: pool weight -32000 (4 x 8000), escrow moved to claimable (46365148515 raw) | [tx](https://solscan.io/tx/5AzmdKzgLiF8REHVfWRbswVELNiyc7N2taUQmenVFF1LfE4GURD477tr7LXEDk8sDvQpeyH9h6AcMB2uwUFL8dFC?cluster=devnet) |
| N18 | ✅ | demoting the same lockup twice fails (AlreadyDemoted) | rejected [AlreadyDemoted] | — |
| N19 | ✅ | rewards distributed after demotion accrue at exactly 1x, no boost | post-demotion share of the 20000 distribution = 1142857142 raw for 8000 amount (exactly 1x); escrow stayed 0 | [tx](https://solscan.io/tx/3Mz2oaZR4YT6PXoA3qHVHNSFzrRYFyBcCpCDQuUsD57TdCg2rzrMh5LSPM2AmjvkbMvSSM282ro2RssKpFrCNHUJ?cluster=devnet) |
| N21 | ✅ | several matured lockups demoted in one transaction (the Fund-pool demote-all shape) | 3 demote instructions in one tx (a single flat fee): pool weight -31000 exactly, all flagged demoted | [tx](https://solscan.io/tx/5EWvznVzQxbNtxavFqtT9vqaSe79F3ZnMPR5PhcAALY5Rjb5bsW69gHKWSJDeLYbtL93P3QVCWtKomPmd4sAFfJN?cluster=devnet) |
| N14 | ✅ | emergency_exit_lockup after maturity fails (StillLocked: use unlock_tokens) | matured lockup must exit via unlock_tokens [StillLocked] | — |
| N20 | ✅ | unlock_tokens on a never-demoted matured lockup pays principal + rewards + boost in one call | one call: principal 8000 + base + inline-released boost = 60079434229 raw tokens, 198819659 lamports rewards, rent back | [tx](https://solscan.io/tx/66WHt24FNbrYafcZHGaMZ8NRYZqUJAeFxz8fEHFLGLfUZfz54disiSHik3s5NYB3WiCNKCzav7KVfzWUPhz5enY5?cluster=devnet) |
| N23 | ✅ | wSOL wrap then unwrap_wsol then SOL claimed by a lockup holder | 0.15 wrapped SOL unwrapped into the pool; a lockup holder claimed 161149422 lamports (+29059575672 raw tokens), both exact | [tx](https://solscan.io/tx/3PayAXomLRL8CG3SnAYprkd6h3kF3XmAPTMkitwyQWbpjP9xcWXTJr2GYZ3YJbmi65A2xiJRGbikpKztd3PxYNCC?cluster=devnet) |
| N25 | ✅ | invariant after mixed lock/unlock/exit/demote churn: vaults never fall below reserved | vault 965479 >= reserved 965479; sol vault 437128597 >= reserved 436175077 lamports | — |
| N26 | ✅ | recover_foreign_token forwards a stray SPL token to the team wallet, closes the stray, rent to the cranker | 5000 foreign tokens forwarded to the dev wallet's ATA; stray account closed; 2074080 lamports rent to the cranker | [tx](https://solscan.io/tx/5B3ewEjD71iLNteNYrndYwB3shJHCAMQkfVN7oXAbHThrcwTQjLCZnk3ZhbfWMNGHM669dsbyVEVqHrUmVBjkuAJ?cluster=devnet) |
| N27 | ✅ | recovery refuses the reward mint and wSOL (InvalidRecoverySource) | the reward vault itself and a vault-owned wSOL account both rejected [InvalidRecoverySource] | — |
| N28 | ✅ | recovery to a destination the team wallet does not own is rejected | destination owned by a stranger rejected [ConstraintRaw] | — |
| I4 | ✅ | influencer stream vests fully and pays the whole amount by the end | full 300000 withdrawn at maturity | [tx](https://solscan.io/tx/4oLKfL1tc5ePENBUpFzeDXMCFzx5KaxTD8zQesJYUwmLLCSM3ZtV9aQCqUJwA8t6SdSN9AM71XMB8tbD3JKRTHfP?cluster=devnet) |
| I4b | ✅ | a matured, fully-withdrawn stream yields nothing further | re-withdraw rejected [NothingToWithdraw] | — |
| G7 | ✅ | the 2014 signer stream vests and pays in full | full 100000 withdrawn | [tx](https://solscan.io/tx/2A1MPo1RJ7n4hJKjieLoyacoJRrYStfrZLM1HT41pVSGEMJ5hQAQ88voTQGho85JMxV7DLApE1JhVZ8wMCMXECnh?cluster=devnet) |
| T6 | ✅ | the team stream vests and pays in full by the end | full 250000 withdrawn | [tx](https://solscan.io/tx/3x9QyFKztMfjmE8Q2B64giKTKamVxrvsQa4DWCXqBEtbnUiysVNPMTByzhjcjv6PYcMQf6Rx54BXhb5zM4RfVU4G?cluster=devnet) |
| T7 | ✅ | stream_withdraw signed by a non-beneficiary fails | rejected [ConstraintSeeds] | — |

## Run B — nobody shows up

Program: [`At3GWByZa5mZXpb4HtCYJJTerho3opvJVh5e9vuUPb9s`](https://solscan.io/account/At3GWByZa5mZXpb4HtCYJJTerho3opvJVh5e9vuUPb9s?cluster=devnet) · 17 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S2b | ✅ | initialize with claims_start = now (0); both windows open | initialized with claims_start = now; both claim windows open at lock | [tx](https://solscan.io/tx/39U1LwVHEJjvbbeER8iPvvHtjyn1K4ERTVjaxG2rnVkvqReevfQGMevVp8oSGdfEBy4S2SMM4x7dkHEj9pMFi2sA?cluster=devnet) |
| S12 | ✅ | claims are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| S13 | ✅ | sweeps are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| L6 | ✅ | a legacy claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| I5 | ✅ | an influencer claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W2 | ✅ | sweep_old_holders credits the unclaimed remainder to the pool instantly | credited full 150000 (nobody claimed) to the pool at once | [tx](https://solscan.io/tx/2ct4yVQchZ1N8vgeHzKvH6c7nT2uKKgdcFSdmpjneX1VYmEijiZbvFrjpWtCaAkxi5uQe5ZcnBABpsK189vCngQ5?cluster=devnet) |
| W3 | ✅ | sweep_old_holders cannot run twice (AlreadyClaimed) | rejected [AlreadyClaimed] | — |
| W4 | ✅ | a legacy claim after the sweep fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W9 | ✅ | a 2014-signer claim after the deadline fails (ClaimWindowClosed) | rejected past the deadline [ClaimWindowClosed] | — |
| W8 | ✅ | sweep_original_signer opens a community stream for the whole allocation | kind1 community stream total=100000, streaming to stakers | [tx](https://solscan.io/tx/ZNxvu5sfJejdD4bbE3QTQUC1NrLsAYkKXVtw6JFsKxBaLmEHH7yY45ENxhpQcYL6redG9SuDswS2pCVig3LsXnb?cluster=devnet) |
| W5 | ✅ | sweep_influencers opens a 30-day community stream for the remainder | community stream kind0 total=500000, streaming to stakers | [tx](https://solscan.io/tx/3GiKxn71ZmUc4SQ7p1MzM9G4EVR2CMo3fzR2dsWasHeDZCJ6H8A4C5ZVQRSjbgSqGaZRJC1BRZvUXzQrKEVr7CWg?cluster=devnet) |
| W6 | 📝 | releasing the community stream immediately yields nothing (NothingToWithdraw) | observed SUCCEEDED (expected failure) | — |
| W7 | ✅ | release_community_stream credits roughly half at the halfway point | credited ~51% of the forfeit at the halfway point | [tx](https://solscan.io/tx/SnLfG1nxKeiAyZcqnhuHAvs1h7b3M8S9LYg79sSGEyP636LBiVEVqpxhPETtobh8CGeex6AmcuHr48QZt8WF61o?cluster=devnet) |
| W7b | ✅ | at the end the full forfeit has reached the pool exactly once | released == total == 500000 | [tx](https://solscan.io/tx/wqP1gqpPkH5GxuynUG4MrVCjMsYzAxamnakCDoc4TJpx6iQDFA6jaC9azp4d7Erh5U2d6TXQ3Z5vSWfPXk6vsP5?cluster=devnet) |
| W7c | ✅ | a fully-released community stream yields nothing further | rejected [NothingToWithdraw] | — |
| W8b | ✅ | release_community_stream credits the signer forfeit to the pool as it vests | credited 63666 so far of 100000; released=63666 | [tx](https://solscan.io/tx/3GF2j41aG8oXTx4SMaWisxiVpDSYwXECLPJif6PRjxCYr5b8wvYu4JnGCSyTsBUKSYpYD2h6owx7AgEffMZrZZ7c?cluster=devnet) |
| W11 | ✅ | a staker can withdraw the swept/forfeited value as real tokens | sole staker claimed 713666 tokens of swept+forfeited value | [tx](https://solscan.io/tx/4oPkqmCCytWzwW7QezDiUmFkFhjFvMZoAdjcoXoEA7KyVadsMNB1XaihkpkyhZZCtfgdttsHKRNbhxc8RUfA9cbU?cluster=devnet) |

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
