# End-to-end devnet test campaign

Every behaviour the site and docs claim, run against live devnet and recorded with the transaction that proves it. This is the completed, evidenced superset of the scripted rehearsal in [docs/DEVNET-REHEARSAL.md](DEVNET-REHEARSAL.md).

## Results at a glance

| Run | What it covers | Result |
|-----|----------------|--------|
| A — everyone shows up | claims, streams, the full staking suite, rewards, donations, sync, stream maturities | 68 pass · 0 note · 0 fail (of 68) |
| B — nobody shows up | expired windows, all three sweeps, community streams, forfeits reaching stakers | 16 pass · 1 note · 0 fail (of 17) |

📝 = documented behaviour (an edge worth noting for the security review), not a failure.

## How this was tested, and how you can re-check it

Two things are worth being precise about, because "we tested it" is exactly the kind of claim this project refuses to make without evidence.

**What I drove, and how.** Each scenario is a real transaction (or a real, expected rejection) sent by `scripts/e2e-campaign.ts` against a program deployed to devnet. Holders, influencers, stakers, the donor and the fee-payer relay are throwaway wallets the script generates and funds; the 2014-signer path uses a locally generated secp256k1 key so a valid Bitcoin-style signature can actually be produced. Every row below with a `tx` link is a signature you can open on Solscan and inspect independently — the accounts touched, the amounts, the logs.

**What you verify, and how.** I cannot drive a browser wallet like Phantom, so the columns above prove the *contract* behaves correctly, not the *site's* wiring to it. The normal-user equivalent of each area is in [§ Verify it yourself](#verify-it-yourself-as-a-normal-user) — the exact tab, button and expected result to confirm on staging with Phantom.

## Time compression (the `fast-clock` build)

Most windows and locks are month- to year-scale, so the runs used a program compiled with the `fast-clock` cargo feature, which shrinks every wall-clock duration to minutes. The feature is **never a default**, CI never enables it, and `solana-verify` builds default features — so the mainnet bytecode provably contains the real values. The mapping:

| Duration | Mainnet | fast-clock (tests) |
|----------|---------|--------------------|
| Legacy-holder claim window | 30 days | 45 min |
| Influencer claim window | 72 hours | 20 min |
| Influencer stream | 30 days | 15 min |
| Founder/signer stream | 365 days | 30 min |
| 1 / 3 / 12-month locks | 30 / 90 / 365 days | 5 / 8 / 12 min |
| Unstake cooldown | 3 days | 3 min |
| 2014-signer deadline | 2030-12-31 | Run B build only: back-dated to 2025-01-01, so `sweep_original_signer` (gated `now > deadline`) is reachable |

The claim windows also depend on `claims_start`, an `initialize` parameter: Run A set it a few minutes in the future (to prove "window not open yet"), Run B back-dated it ~50 min (so both windows are already closed and the sweeps are reachable).

## Run A — everyone shows up

Program: [`6iGu7dMT1DcEh7Ki5WWdtRScosAF5bER2BvVz3vCAMCG`](https://solscan.io/account/6iGu7dMT1DcEh7Ki5WWdtRScosAF5bER2BvVz3vCAMCG?cluster=devnet) · 68 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S1 | ✅ | initialize rejects an out-of-range cliff (InvalidCliff) | cliff >365d and <0 both rejected [InvalidCliff] | — |
| S2 | ✅ | initialize creates config/pool/vault and stores params | config initialized; allocations stored; locked=false | [tx](https://solscan.io/tx/2F86RXASKJsrV2sqZT7s44aCYUe8jMHdYc5LpZ7QxK9t2wj2xtS788PW1RY2TxDjohnXkHRn1Zg6uuLkCeNAhTaw?cluster=devnet) |
| S3 | ✅ | initialize cannot run twice | second initialize rejected [AccountInUse] | — |
| S4 | ✅ | fund_vault rejects a non-authority signer (Unauthorized) | rejected [Unauthorized] | — |
| S5 | ✅ | fund_vault rejects a zero amount (ZeroAmount) | rejected [ZeroAmount] | — |
| S6 | ✅ | lock_config refuses while the vault is short (InsufficientBucketBalance) | rejected [InsufficientBucketBalance] | — |
| S7 | ✅ | tokens sent outside fund_vault don't satisfy the lock; fund_vault does | direct transfer left lock short [InsufficientBucketBalance]; fund_vault(1000000) tracked it | [tx](https://solscan.io/tx/4zHLZNdQyFwaE3hvXd6esvAYj8yaQTRmmYgR3xA3KebPi7RRQzk8H2dR9TCp4XmUnJwuBxDvAuzp7UbG9pkmV5tr?cluster=devnet) |
| S9 | ✅ | lock_config succeeds once funded; locked=true | locked=true | [tx](https://solscan.io/tx/xjLJRHoUH5aUtSt7zobbbRfKj6z1AfaMqry2mgMeudJjHFyxpPkKthADQwExm3Lnt3zg2Wrcg7C86FTh5bX8wQ4?cluster=devnet) |
| S10 | ✅ | fund_vault rejected after lock (ConfigLocked) | rejected [ConfigLocked] | — |
| S11 | ✅ | lock_config cannot run twice (ConfigLocked) | rejected [ConfigLocked] | — |
| T2 | ✅ | create_dev_stream is permissionless; terms come from init | stranger opened the team stream; total=250000 | [tx](https://solscan.io/tx/5K7UCNNrww6wgRHAs6gqTA3quR2MavcTDRF5dMxs8zwra5y5QZaMEBApnfmTNZoHCastwVGWrGA5ZavTA3mUQHgo?cluster=devnet) |
| T3 | ✅ | create_dev_stream cannot run twice | rejected [AccountInUse] | — |
| T4 | ✅ | team stream pays nothing before its cliff (NothingToWithdraw) | pre-cliff withdraw rejected [NothingToWithdraw] | — |
| L5 | ✅ | legacy claim rejected before claims_start (ClaimWindowNotOpen) | rejected before window opens [ClaimWindowNotOpen] | — |
| L1 | ✅ | legacy claim pays the exact amount instantly | paid 90000 instantly | [tx](https://solscan.io/tx/3KoEFztd3xKhYVfbjGb2THurY8DpnRdgdzouLJ6Va3f4YK7mrkPmWURwEdob11rytkrrDyzKak3rUqeEw4BfvMt5?cluster=devnet) |
| L2 | ✅ | the same wallet cannot claim twice | second claim rejected [AccountInUse] | — |
| L3 | ✅ | legacy claim with the wrong amount fails (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| L4 | ✅ | a wallet not in the tree cannot claim (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1 | ✅ | influencer claim opens a stream and pays nothing upfront | stream total=300000, 0 paid upfront | [tx](https://solscan.io/tx/2g5Rr1NNt8BAbkHJyHQxLhz1oSpQnHodJznTrHhie9MkWwKVjaC3WXbN3YHwxWtEML1zRdkGLVjchqtBSCWu3UnP?cluster=devnet) |
| I3 | ✅ | a non-member cannot claim an influencer allocation (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1b | ✅ | second influencer claims (bucket fully claimed) | influencer 2 claimed 200000 | [tx](https://solscan.io/tx/5vDdvcbBuvsuvTNvJSC2ncLX2x5w9PZnmz3tJakZ7U3SRuRwmaKCvGooCY1v2a521sYNrdQ2QBpWYLU1yPuQAVYu?cluster=devnet) |
| G1 | ✅ | a signature from the wrong key fails (SignerMismatch) | rejected [SignerMismatch] | — |
| G2 | ✅ | a signature bound to A cannot be replayed for B (SignerMismatch) | replay to a different destination rejected [SignerMismatch] | — |
| G3 | ✅ | a header byte outside 27-34 fails (InvalidRecoveryId) | rejected [InvalidRecoveryId] | — |
| G4 | ✅ | a valid signature, relayed by an unrelated payer, opens the stream | stream opened by relay wallet; total=100000 | [tx](https://solscan.io/tx/2aJ5RewtAUWjf3NC8Jio9YbZdY2m3yqU2hTwQg76dz9BHg6NDA311hrMicM2BqcVuAzbHvnquhPdFDb9sZc294e4?cluster=devnet) |
| G6 | ✅ | the signer cannot claim twice (AlreadyClaimed) | second claim rejected [AccountInUse] | — |
| N24 | ✅ | rewards with nobody staked buffer to pending | 1000 tokens buffered in pending; accumulator untouched | [tx](https://solscan.io/tx/2Snu9mVLxVhycxS5sWQo1nsCrNpkayeSF2KRryoqBdWwdRYBuUbg2MA4tFLWbvaK36y1mRi7JXeKmQW4QweKiYJk?cluster=devnet) |
| N1 | ✅ | stake(amount) with no tier argument registers at weight == amount | stake(0) rejected [ZeroAmount]; stake(8000) weight=8000 (1.0x, flexible only) | [tx](https://solscan.io/tx/5b2i2HjnBpuiXCMr7y9N5iu2XpqcUnCCRDHwyrEpGqqbMVf46v6mrAbUK2bPsyxDpRdXwgpK9MghQ3jiY7RfpafN?cluster=devnet) |
| N24b | ✅ | first staker + flush_pending collects the buffered rewards exactly | sole staker collected the exact 1000 buffered tokens after flush | [tx](https://solscan.io/tx/26CcRX8mSsD34n3j24bRcYDnx54UEDFiwLFSggrpeTyfPmVcVqmjUPemgD4UTPbEMn8HksMoKtE7HkYC96wUiU1b?cluster=devnet) |
| N2 | ✅ | unstake without a request fails (NoUnstakeRequested) | rejected [NoUnstakeRequested] | — |
| N3 | ✅ | unstake inside the 24h cooldown (fast: 60s) fails (CooldownActive) | request made; immediate unstake rejected [CooldownActive] | — |
| N5 | ✅ | staking again cancels a pending unstake request | top-up to 10000 zeroed unstake_requested_at; the cooldown restarts from scratch | [tx](https://solscan.io/tx/2JzxZV8EevZUVGmcvaRT2LbNPSJb6aui5tKPk9Ci2dHxqvqtNtZpwXAtrUeLhrSkHbwc6efbPk2h9JWbp5od8fTy?cluster=devnet) |
| N6 | ✅ | flash-stake bundle (stake huge, sync, claim, unstake) is blocked by the cooldown | bundle rejected atomically [NoUnstakeRequested]: an exit needs a request plus the cooldown, so a flash capture cannot stake and leave in one breath | — |
| N7 | ✅ | lock_tokens at each tier: 2x/3x/5x weight, own index, own lock_end | 10000@2x=20000/60s, 10000@3x=30000/120s, 8000@5x=40000/180s; counter=3; pool weight +90000 | [tx](https://solscan.io/tx/3yp17CxnJ6xcry3fE3KQQF2rUFhN9t7pgQKwSvVKfrWNrzgmUmKSteYYcQ6qCQxovqHdcx36WKBw4soX3zJVx2jk?cluster=devnet) |
| N8 | ✅ | two lockups for one wallet keep independent clocks, amounts and escrows | lockup#0 10000@2x/60s and lockup#1 8000@5x/180s coexist, each with its own clock (unlock check follows in N8b) | [tx](https://solscan.io/tx/2XpbruYS6M6rXbyCeuYBrpayehViQfQ5UCLESUqCJEnPDMky4UY522v6RXF3jSbjPm2RiRCvQNoMuy2VgXViz7Ym?cluster=devnet) |
| N12 | ✅ | unlock_tokens before maturity fails (StillLocked) | rejected [StillLocked] | — |
| N16 | ✅ | demote_matured before maturity fails (EscrowNotMatured) | rejected [EscrowNotMatured] | — |
| N9 | ✅ | lock_tokens refuses the flexible tier (InvalidTier) | tier 0 must go through stake(); rejected [InvalidTier] | — |
| N10 | ✅ | a lockup index that does not match the counter is rejected (InvalidLockupIndex) | index 5 against count 3, and index 1 with no counter, both rejected [InvalidLockupIndex] | — |
| N22 | ✅ | token + SOL rewards split pro-rata across flexible and lockups; claims pay exact amounts | 200000 tokens + 0.2 SOL over 200000 weight: flexible claimed 10000 + 0.01 SOL all-base; 2x lockup claimed base 10000 with 10000 + 0.01 SOL escrowed | [tx](https://solscan.io/tx/zUeSp6FbRULzbTcFfYd1HRnMAaNfhQTH8awcnXnBtJHtCyyYye3As8hEPj82ctZzU9NugFNmhy9GxLoyUaZXFJa?cluster=devnet) |
| N11 | ✅ | claim_lockup_rewards pays base only while locked; the boost escrow stays put | 3x lockup: base 10000 + 0.01 SOL paid; 20000 + 0.02 SOL still escrowed until maturity | [tx](https://solscan.io/tx/2RfVLuXTosYvUjgQkx36Y29bDVcRbpSrebZ6f9v4vTGG8hEiwzgLMotUZv4Wib5oQmng5wrBw67rqWVB6F7Hr3wT?cluster=devnet) |
| N13 | ✅ | emergency_exit_lockup: 85% principal + base kept; boost + slash to the pool; siblings untouched | exit paid 7600 (85% of 8000 + base 800); forfeited 3200 boost + 1200 slash redistributed; lockups #0/#1 untouched | [tx](https://solscan.io/tx/23F9jZPKPcDhrwTCaK3XvbeVK92rDs8A2gZ5HjfLMQ1caxToDDADFGMLpTDaRoAGr6JDCYaJvN7dt9pYTyHMUXBK?cluster=devnet) |
| N15 | ✅ | no top-up path; a closed lockup leaves nothing behind; re-locking is a fresh entity | exited #3 is gone; re-creating index 3 rejected [InvalidLockupIndex]; new lock is #4 with its own 60s clock. No instruction can top up an existing lockup | [tx](https://solscan.io/tx/2uHsoyNP4gRkoxBsqatfiMnm1r2HXWpno2sha4F3a7VTr5RVCXMYKHTkzg4S8JkLXmM4a2e3SD8NLfgDc4TLQBiA?cluster=devnet) |
| R2 | ✅ | sync_sol_rewards with nothing untracked fails (NothingToWithdraw) | rejected [NothingToWithdraw] | — |
| R1 | ✅ | direct SOL is invisible until sync_sol_rewards credits exactly it | credited exactly 500000000 lamports | [tx](https://solscan.io/tx/Fz2HLHfyykPP3JyVhJBHhzRFH6vkKxjHtRUJavCT8mUrDuFGbCi6iRbQGBTLJ1uDy1AXHdW4kNTCgEcd4s3ULzZ?cluster=devnet) |
| R4 | ✅ | direct token transfer is invisible until sync_token_rewards | credited exactly 1000 tokens | [tx](https://solscan.io/tx/53Pc9jTjiYQ1wZx7VoAc3gk1hZuTppqBtDiupEFArnmWKRpG5FznwrxBvLfEtBaRQJu3YUT4DorQQqJgdhRAcbAk?cluster=devnet) |
| R5 | ✅ | unwrap_wsol converts vault-held wrapped SOL into lamport rewards | unwrapped 0.3 SOL + closed-account rent to rewards; wSOL account closed | [tx](https://solscan.io/tx/2Dkvoy2Dim8encaoMYsX7mbcpWVcsg832zXZBeyiFMbG2GWCyEgiRRKbHrkeHMaxPXp84CwWHGHGJiDQZd4y1UuE?cluster=devnet) |
| R6 | ✅ | unwrap_wsol rejects a wSOL account the vault does not own (InvalidWsolAccount) | rejected [InvalidWsolAccount] | — |
| R10 | ✅ | a third party can donate via notify_token_rewards | donor added 500 tokens to the pool | [tx](https://solscan.io/tx/3PRHFUmjM5hc13bnz29xVQgaReEZzAgoP6pTwtHWbtNzKeFvtmtuRq9rLACzrbbQAqmKEmTJtHpSCKZw2V8gQMZD?cluster=devnet) |
| R8 | ✅ | invariant: vault balances never fall below what is reserved | vault 1116900 >= reserved 1116900; sol ok | — |
| N4 | ✅ | after the cooldown: partial unstake pays principal; full unstake sweeps rewards too | partial paid 4000 exactly; full exit paid 7591287128 raw tokens + 39704914 lamports (principal + all rewards); position empty | [tx](https://solscan.io/tx/2RSL4yPpzVsnfb8i5HC72hYiE762xLCia38JeMJ9pVeA5NYvxadKfxPKq66JMz2tNGFXdoBYFXB5pfsdtqmfibii?cluster=devnet) |
| N8b | ✅ | unlocking lockup#0 leaves lockup#1 byte-identical | #0 paid principal 10000 + rewards + released escrow = 23182574257 raw and closed; #1 amount/weight/escrow/clock unchanged | [tx](https://solscan.io/tx/4F6DjtFcuVYo4dohMh21zFhiwkGv3h6fcHcHKr9FM9mzq4uYJUfVLcfHrvm2deRRqdW725S3SbRC5i2kavJhkw9A?cluster=devnet) |
| N17 | ✅ | after maturity a stranger demotes: pool weight falls by exactly 4x amount; escrow becomes claimable | a stranger (not the owner) demoted: pool weight -32000 (4 x 8000), escrow moved to claimable (46365148514 raw) | [tx](https://solscan.io/tx/2j6QKTZ7os4kJHPi6XFnUaXZu6sG9wgtnkBXyLfqth1frN3YKHViF5oJbeKwovVCjmQ3tvp9JTETfjC9ihAjDP2H?cluster=devnet) |
| N18 | ✅ | demoting the same lockup twice fails (AlreadyDemoted) | rejected [AlreadyDemoted] | — |
| N19 | ✅ | rewards distributed after demotion accrue at exactly 1x, no boost | post-demotion share of the 20000 distribution = 1142857142 raw for 8000 amount (exactly 1x); escrow stayed 0 | [tx](https://solscan.io/tx/4HDTwTyWqSJT8ckwsxaPngGzozPnPZaGvj8dSE3Ls6fhanmnzR7eWaAashnfqDb5UFAYfHsiH9hAJf9v4hQS5irT?cluster=devnet) |
| N21 | ✅ | several matured lockups demoted in one transaction (the Fund-pool demote-all shape) | 3 demote instructions in one tx (a single flat fee): pool weight -31000 exactly, all flagged demoted | [tx](https://solscan.io/tx/3rUkAe3Acnn2SmGLwFZ2GAyUXhcx8MqjRGAYyxvWE7Z5jXnHaLz9q2ahXNscjRZrTaB1KVsw4ubFaPxbcPSQyt5V?cluster=devnet) |
| N14 | ✅ | emergency_exit_lockup after maturity fails (StillLocked: use unlock_tokens) | matured lockup must exit via unlock_tokens [StillLocked] | — |
| N20 | ✅ | unlock_tokens on a never-demoted matured lockup pays principal + rewards + boost in one call | one call: principal 8000 + base + inline-released boost = 60079434229 raw tokens, 198819659 lamports rewards, rent back | [tx](https://solscan.io/tx/2qymD64Q1QGmzhgXmp8pFoxhQ4ahwqo96iHKy61XxUUKj7EdboTYrGpqE6U7uR6HiMCwqTBM2EFSML66xkpiHqRa?cluster=devnet) |
| N23 | ✅ | wSOL wrap then unwrap_wsol then SOL claimed by a lockup holder | 0.15 wrapped SOL unwrapped into the pool; a lockup holder claimed 161149422 lamports (+29059575671 raw tokens), both exact | [tx](https://solscan.io/tx/5whL7hSbBTwuNBc83Rk3PkLjzkYYtvf7xAzTo7bn6poYqvSKz88WKuy8q6DD25vMXU5YMTM9AUJceeToadau6Uqt?cluster=devnet) |
| N25 | ✅ | invariant after mixed lock/unlock/exit/demote churn: vaults never fall below reserved | vault 965479 >= reserved 965479; sol vault 437128597 >= reserved 436175077 lamports | — |
| N26 | ✅ | recover_foreign_token forwards a stray SPL token to the team wallet, closes the stray, rent to the cranker | 5000 foreign tokens forwarded to the dev wallet's ATA; stray account closed; 2039280 lamports rent to the cranker | [tx](https://solscan.io/tx/5CiJcUaKgirWoGWvxA41djCTL3oXqHCp9R8Kvv27JpkYYg2thLPweZmY9ayXGi6FX7zyneBnYCXLoH5R9xGmCL8f?cluster=devnet) |
| N27 | ✅ | recovery refuses the reward mint and wSOL (InvalidRecoverySource) | the reward vault itself and a vault-owned wSOL account both rejected [InvalidRecoverySource] | — |
| N28 | ✅ | recovery to a destination the team wallet does not own is rejected | destination owned by a stranger rejected [ConstraintRaw] | — |
| I4 | ✅ | influencer stream vests fully and pays the whole amount by the end | full 300000 withdrawn at maturity | [tx](https://solscan.io/tx/43pmARE7JydAd8rGFzVkxW6iJaUJ9Nz1C7iWUzgcUd34oJhynaEWPgGa4MM6mix5rJeXLD97RZrwVCMSigxBDttm?cluster=devnet) |
| I4b | ✅ | a matured, fully-withdrawn stream yields nothing further | re-withdraw rejected [NothingToWithdraw] | — |
| G7 | ✅ | the 2014 signer stream vests and pays in full | full 100000 withdrawn | [tx](https://solscan.io/tx/5e76WMVT9AAVPfELEsiDo1opHhEjTf9tEkEiVzfFjAygPbcJjykq2zx5kcPxCqWVh424qpF8TTSzuxACNzHBWLBo?cluster=devnet) |
| T6 | ✅ | the team stream vests and pays in full by the end | full 250000 withdrawn | [tx](https://solscan.io/tx/5aGKF2TCfWTqqHMyiDSJCirrpsVN7MkQSg1mRkscrKJsbQ6PxPxLtPsECnkNdNUkbNgdMZ63j6doYfmks6EyiMz4?cluster=devnet) |
| T7 | ✅ | stream_withdraw signed by a non-beneficiary fails | rejected [ConstraintSeeds] | — |

## Run B — nobody shows up

Program: [`DJj3AZek9B5PAt7Fe4YTfLK9oiU2EZep6AqiVxq6Lsaf`](https://solscan.io/account/DJj3AZek9B5PAt7Fe4YTfLK9oiU2EZep6AqiVxq6Lsaf?cluster=devnet) · 17 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S2b | ✅ | initialize (backdated claims_start) | initialized with claims_start 50 min in the past | [tx](https://solscan.io/tx/3tjEdrL5mEY3XbZYWjzVgTMpeVYvvUjudVbQ4ShQaoD19nCrf1uQuiCh2aP7vcdbpwZcghLCFEa7tGvL8JdHVg9a?cluster=devnet) |
| S12 | ✅ | claims are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| S13 | ✅ | sweeps are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| L6 | ✅ | a legacy claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| I5 | ✅ | an influencer claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W2 | ✅ | sweep_old_holders credits the unclaimed remainder to the pool instantly | credited full 150000 (nobody claimed) to the pool at once | [tx](https://solscan.io/tx/NwGzCgjMMyCs2XhtJnbG9K2fdzkNR4rwZx8kfaE6GSC1XFkc7G4L7x8fsmeKH7X5cBrcbY4yDr6X4v2RNNaKgFY?cluster=devnet) |
| W3 | ✅ | sweep_old_holders cannot run twice (AlreadyClaimed) | rejected [AlreadyClaimed] | — |
| W4 | ✅ | a legacy claim after the sweep fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W9 | ✅ | a 2014-signer claim after the deadline fails (ClaimWindowClosed) | rejected past the deadline [ClaimWindowClosed] | — |
| W8 | ✅ | sweep_original_signer opens a community stream for the whole allocation | kind1 community stream total=100000, streaming to stakers | [tx](https://solscan.io/tx/uvy5yT5rWphbhkcxmBL4WxRoRh7xJyCg2buqKAuSGR7AzSYxBgcDq3wSDj9VY4jtyz9XNnEa1ApyGLhdrdkZVxm?cluster=devnet) |
| W5 | ✅ | sweep_influencers opens a 30-day community stream for the remainder | community stream kind0 total=500000, streaming to stakers | [tx](https://solscan.io/tx/4fXMRQA8rcdPwBKJWg936W7vKt4FSR1We1T47LLp7FiAdPbKobEuEhyw6dLQo8Z9416Vg2GDuuG1JycamXAXP2Br?cluster=devnet) |
| W6 | 📝 | releasing the community stream immediately yields nothing (NothingToWithdraw) | released a 1-second sliver instead of refusing: on a live chain at least one second elapses between sweep and release, so linear vesting was already nonzero. The zero-elapsed refusal passes under bankrun's frozen clock. Correct behavior, live-clock expectation. | — |
| W7 | ✅ | release_community_stream credits roughly half at the halfway point | credited ~51% of the forfeit at the halfway point | [tx](https://solscan.io/tx/2HJeqHEwQz9SSGmjPG49ybHisFDXFnYfmhcZRb4TfSa7cLETJzFp2tfkrxok3mb4FFayZinYGZntaDZBW5gwuohb?cluster=devnet) |
| W7b | ✅ | at the end the full forfeit has reached the pool exactly once | released == total == 500000 | [tx](https://solscan.io/tx/52zoy4Q3t1Eg3JDkdrV1zCik2RfB2F1m4xHfSjTo5Cx4Q32Zk4jCXW8tKUFaQBCvUDWk7R8JP5ggZskv6rF8kTWY?cluster=devnet) |
| W7c | ✅ | a fully-released community stream yields nothing further | rejected [NothingToWithdraw] | — |
| W8b | ✅ | release_community_stream credits the signer forfeit to the pool as it vests | credited 63000 so far of 100000; released=63000 | [tx](https://solscan.io/tx/5fXwbc5YkvMeWhGZRzaKJdKRXKJreKewwQ3tehSRNCMnojn2fdVwWqBymLfz5fEf4zuoaterCmdSBsosQ3fBXycp?cluster=devnet) |
| W11 | ✅ | a staker can withdraw the swept/forfeited value as real tokens | sole staker claimed 713000 tokens of swept+forfeited value | [tx](https://solscan.io/tx/kkpJr4fdVyN5yasmhodfTZKHCeMBFVZiL4L3Rt9rt6yVEwEoUu8Zu7vCgBeUkNt6yfV7UzAEZVjW12yoZFYUMZA?cluster=devnet) |

## What is NOT covered here, and where it is

- **The pump.fun creator-fee chain** (setting the one-shot 90/10 split, and collecting accrued fees). pump.fun has no devnet deployment, so this is impossible to rehearse on devnet. It stays the mainnet throwaway-coin step in [TO-THE-MOON §1.5](../TO-THE-MOON.md). The distributor contract itself contains no pump.fun coupling — that lives in `app/src/pumpfun.ts` — so nothing in the contract campaign depends on it.
- **The exact 2030 boundary with real constants.** Covered by the bankrun suite's time-travel test "returns the allocation to the community after the 2030 deadline". On devnet, Run B exercised the same code path with the deadline back-dated in the build.
- **The Squads team-withdraw** (`stream_withdraw` signed by a multisig vault). Proven on the final deployment — see below.

## Final devnet deployment

The campaign left devnet on a **normal-constants** build — launch-realistic, for the security review and the manual pass:

- Program: [`ACEQhGpWU8Y8QfbxL5LGL8dmj59TKRxnrPkDaWKhQiVY`](https://solscan.io/account/ACEQhGpWU8Y8QfbxL5LGL8dmj59TKRxnrPkDaWKhQiVY?cluster=devnet)
- Allocation split: 15 / 50 / 10 / 25 of a 200M fixture distribution (tiers 1x/2x/3x/5x at flexible/1mo/3mo/5mo)
- Team stream beneficiary (Squads vault): [`AZ4hxoebwUqGzraYQtHr3tWmkqF3oLxKH2hqZPt4P32Y`](https://solscan.io/account/AZ4hxoebwUqGzraYQtHr3tWmkqF3oLxKH2hqZPt4P32Y?cluster=devnet)
- Team-withdraw through Squads (propose→approve→execute): [tx](https://solscan.io/tx/2ee54YaKbg8enJiVEzznhfRcjxBnFko25p8PQFSjDRpvdrpLsa1qhpG3u3TEGrfAnstEuvYxaxWU9HjAED2mdcMS?cluster=devnet)
- Normal constants; team stream cliff 0 so the Squads withdrawal is exercisable; the 2014 signer bucket uses the real key and is genuinely unclaimed.

## Findings for the security review

Documented behaviours (📝 rows) worth an explicit look. None is a bug; each is a design edge that an auditor should see stated plainly:

- **S8 / pre-lock staking:** `stake()` has no lock gate and increments `reserved_token`, so staker principal could satisfy `lock_config`'s solvency check. In practice the launch script funds and locks before any staking, but the ordering is not enforced on chain.
- **K14 / flexible partial unstake:** `unstake_requested_at` is cleared only on a *full* exit, so after one cooldown a flexible staker can make repeated partial unstakes without a fresh cooldown.
- **K16 / zero-amount position:** after a full unstake the position account survives with `amount = 0`, and the no-downgrade rule then blocks re-staking at a lower tier until the account is closed via `emergency_exit` (unavailable post-maturity).
- **I6 / empty-remainder sweep:** `sweep_influencers` with nothing unclaimed opens a `total = 0` community stream that can never be released (permanent `NothingToWithdraw`). Harmless, but it is a dead account.
- **R9 / dust truncation:** a reward far smaller than `total_weight` truncates to a zero accumulator delta while still counting in `lifetime_*`; the tokens stay in the vault, recoverable only by a later, larger sync.

## Verify it yourself, as a normal user

Against staging (`staging.mybestbuddy.fun`, devnet, behind the basic-auth gate) pointed at the final deployment, with Phantom set to devnet:

1. **See the numbers (no wallet).** Open **Dashboard**. Confirm *Initial distribution* equals the published total and the four allocations match 15 / 50 / 10 / 25. Open **Home** and confirm the allocation shares read the same, live from chain. These are the same values the campaign asserted on chain.
2. **Check an address (no wallet).** On **Claims → Overview**, paste one of the published holder addresses; it should report what that wallet is owed. Paste a random address; it should report nothing.
3. **Claim (Phantom).** With a wallet that holds a legacy allocation, open **My Buddy → Your claims** and claim; the tokens arrive instantly (this is the L1 path). An influencer wallet instead opens a stream (I1) and withdraws over time from the same page.
4. **Stake (Phantom).** **My Buddy → Your stake**: stake a small amount at a locked tier, confirm base rewards are claimable while the boost stays escrowed (K7/K8), and that an early exit forfeits the boost + 15% (K21).
5. **Crank the pool (Phantom, permissionless).** **Fund pool**: after the windows close, run a sweep, then `release`/`sync` — anyone's wallet can, which is the W-series on this page.
6. **The team withdrawal (Squads app).** The team stream pays a multisig vault, so its withdrawal is a Squads proposal, not a site action — `scripts/team-withdraw.ts` builds it. This is deliberately the one flow the site cannot do for you.

_Generated by `scripts/e2e-report.ts` from the campaign run logs._
