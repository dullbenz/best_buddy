# End-to-end devnet test campaign

Every behaviour the site and docs claim, run against live devnet and recorded with the transaction that proves it. This is the completed, evidenced superset of the scripted rehearsal in [docs/DEVNET-REHEARSAL.md](DEVNET-REHEARSAL.md).

## Results at a glance

| Run | What it covers | Result |
|-----|----------------|--------|
| A — everyone shows up | claims, streams, the full staking suite, rewards, donations, sync, stream maturities | 53 pass · 1 note · 0 fail (of 54) |
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

Program: [`8m8EVWGVJwHbj3pdDxuGDLUx1ZUVEWiQQfmqARs2E4cz`](https://solscan.io/account/8m8EVWGVJwHbj3pdDxuGDLUx1ZUVEWiQQfmqARs2E4cz?cluster=devnet) · 54 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S1 | ✅ | initialize rejects an out-of-range cliff (InvalidCliff) | cliff >365d and <0 both rejected [InvalidCliff] | — |
| S2 | ✅ | initialize creates config/pool/vault and stores params | config initialized; allocations stored; locked=false | [tx](https://solscan.io/tx/27FebqgSeutBfT2pVC8Tu5vwhs1jGrvUZqdpSLSbLrDjXMXxk7phuCSCA3fDx7365VmvoSxVkmjtJWgTcjerotaA?cluster=devnet) |
| S3 | ✅ | initialize cannot run twice | second initialize rejected [AccountInUse] | — |
| S4 | ✅ | fund_vault rejects a non-authority signer (Unauthorized) | rejected [Unauthorized] | — |
| S5 | ✅ | fund_vault rejects a zero amount (ZeroAmount) | rejected [ZeroAmount] | — |
| S6 | ✅ | lock_config refuses while the vault is short (InsufficientBucketBalance) | rejected [InsufficientBucketBalance] | — |
| S7 | ✅ | tokens sent outside fund_vault don't satisfy the lock; fund_vault does | direct transfer left lock short [InsufficientBucketBalance]; fund_vault(1000000) tracked it | [tx](https://solscan.io/tx/ZApQoyQuSNq4vB5RFEPHS1VGmimgBjRA7SLCVxNFmRLP9yewJc5qhNRqwxJWyy6T4DtDuKTYJtiNFgkc6jmjMyv?cluster=devnet) |
| S9 | ✅ | lock_config succeeds once funded; locked=true | locked=true | [tx](https://solscan.io/tx/4UsJXsGmfxeTo2m3v45qivJtH5MJt7efKByHd7mHBSfa6xnUKEfw4nvkQjio4vyjwkg7K7x4NhpTGoK3gqJsp4gk?cluster=devnet) |
| S10 | ✅ | fund_vault rejected after lock (ConfigLocked) | rejected [ConfigLocked] | — |
| S11 | ✅ | lock_config cannot run twice (ConfigLocked) | rejected [ConfigLocked] | — |
| T2 | ✅ | create_dev_stream is permissionless; terms come from init | stranger opened the team stream; total=250000 | [tx](https://solscan.io/tx/45Wk4KAQ5excjqr4tpBisYMhHMLZdW9p18puw6diPQXvsnys5SNwPs9xHPvnqiffn7z4JjyMGhXTVR4HcRqdSKyg?cluster=devnet) |
| T3 | ✅ | create_dev_stream cannot run twice | rejected [AccountInUse] | — |
| T4 | ✅ | team stream pays nothing before its cliff (NothingToWithdraw) | pre-cliff withdraw rejected [NothingToWithdraw] | — |
| L5 | ✅ | legacy claim rejected before claims_start (ClaimWindowNotOpen) | rejected before window opens [ClaimWindowNotOpen] | — |
| L1 | ✅ | legacy claim pays the exact amount instantly | paid 90000 instantly | [tx](https://solscan.io/tx/4xVmbL2eL4yU2MHpgac5DFA2YWY2bMCvWs89JGqDNdgvrVVZkMkeBNP81j8DKFWptLCdJ3yJv9bxrbickCDB6u7z?cluster=devnet) |
| L2 | ✅ | the same wallet cannot claim twice | second claim rejected [AccountInUse] | — |
| L3 | ✅ | legacy claim with the wrong amount fails (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| L4 | ✅ | a wallet not in the tree cannot claim (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1 | ✅ | influencer claim opens a stream and pays nothing upfront | stream total=300000, 0 paid upfront | [tx](https://solscan.io/tx/54Mc9R1xUpViDikyZLZ4KjLARUd9e7iE7wCgxg2uzPmeapJZM91URC141wpL4XQC9NW43a4DphqmvC8N4LZfZswW?cluster=devnet) |
| I3 | ✅ | a non-member cannot claim an influencer allocation (InvalidMerkleProof) | rejected [InvalidMerkleProof] | — |
| I1b | ✅ | second influencer claims (bucket fully claimed) | influencer 2 claimed 200000 | [tx](https://solscan.io/tx/gS6X7sJwE7oTZo2P1DSDGKUcnLsvWAN9A22Tce6Y5vb7MoqqymbLTyorZA2hPxxmKtA3VzkRHgiKWnqMknV5Npu?cluster=devnet) |
| G1 | ✅ | a signature from the wrong key fails (SignerMismatch) | rejected [SignerMismatch] | — |
| G2 | ✅ | a signature bound to A cannot be replayed for B (SignerMismatch) | replay to a different destination rejected [SignerMismatch] | — |
| G3 | ✅ | a header byte outside 27-34 fails (InvalidRecoveryId) | rejected [InvalidRecoveryId] | — |
| G4 | ✅ | a valid signature, relayed by an unrelated payer, opens the stream | stream opened by relay wallet; total=100000 | [tx](https://solscan.io/tx/4ciGskdzHAzDha8jFcX5dsXmCSKs63XLmp1gY1h9Uipc67BtMsTLc92jEjtmmyLesbGWzrnHpp4NKZfnVgJ8QLTH?cluster=devnet) |
| G6 | ✅ | the signer cannot claim twice (AlreadyClaimed) | second claim rejected [AccountInUse] | — |
| K3 | ✅ | staking rejects an invalid tier byte (InvalidTier) | rejected [InvalidTier] | — |
| K4 | ✅ | staking rejects a zero amount (ZeroAmount) | rejected [ZeroAmount] | — |
| K1 | ✅ | flexible stake registers with weight == amount | flexible weight=10000 | [tx](https://solscan.io/tx/Kjtr31dLRGJijUaJBwY9qsePmjZKUtAC4dVn533Smcanv9GRDzzpDyQyMmoEW6aYC2AGmoPE7cFxXUMnACVdsPB?cluster=devnet) |
| K2 | ✅ | locked tiers apply the multiplier to weight (2x, 5x) | 3-month weight=20000 (2x), 12-month weight=50000 (5x) | [tx](https://solscan.io/tx/tDTCDyo9EGRXMPNLwtRNZau5KyYkHAw8d3cwpA4QDVGKEfxZWN8ZEzqdc63yqi43BQwXExXBxyk1LUYUQ91U6kZ?cluster=devnet) |
| K5/K7/K8 | ✅ | token rewards split pro-rata by weight; base paid on claim, boost escrowed | flex base=10000 boost=0; 12mo base=10000 boost=40000 escrowed (pro-rata by weight; claim pays base only) | [tx](https://solscan.io/tx/3aUywpQYWGdG3kY4TVTVUtTERQxvRXFCRXJ7JyZdKyitFCWASxqub5yS92eRC6GaCMEbCvCSbDc1GHCHxvGTKsif?cluster=devnet) |
| K9 | ✅ | boost escrow cannot be released before maturity (EscrowNotMatured) | rejected [EscrowNotMatured] | — |
| K6 | ✅ | SOL rewards distribute alongside token rewards | staker0 received ~0.1 SOL of rewards (flexible, all base) | [tx](https://solscan.io/tx/5H17xrBntWHyyG3H58ZAjkP5Z9aDDicCgyS7XHV5mL3gv2x1uLkGMxQfS2LjZduPCTeDdfTbidum5uWWKdnFoP4S?cluster=devnet) |
| K11 | ✅ | flexible unstake without a request fails (NoUnstakeRequested) | rejected [NoUnstakeRequested] | — |
| K29 | ✅ | request_unstake on a locked tier fails (NotLocked) | rejected [NotLocked] | — |
| K28 | ✅ | locked-tier unstake before maturity fails (StillLocked) | rejected [StillLocked] | — |
| K19 | ✅ | emergency_exit on a flexible position fails (NotLocked) | rejected [NotLocked] | — |
| K22 | ✅ | claim-then-exit still forfeits the whole boost escrow | exited: got back 8500 (85% of 10k), forfeited 10000 escrow + 15% slash to pool | [tx](https://solscan.io/tx/5CF2MbfwPJkdjWeCYYFJ7WqpXTYFnfHSic9iBBWWeWD6wJCrZEe86RC4i3S6AsqEcYGG2DAyD7QV7h8ZoHKzus9z?cluster=devnet) |
| R2 | ✅ | sync_sol_rewards with nothing untracked fails (NothingToWithdraw) | rejected [NothingToWithdraw] | — |
| R1 | ✅ | direct SOL is invisible until sync_sol_rewards credits exactly it | credited exactly 500000000 lamports | [tx](https://solscan.io/tx/3MAhGhj1oCeBZvMPGWURe4T5a3DJSznqKT44iYW41yLGg5VtdT7wwUxFtBvb7hKTsERDLChuSHKpBfexcDxyHZfH?cluster=devnet) |
| R4 | ✅ | direct token transfer is invisible until sync_token_rewards | credited exactly 1000 tokens | [tx](https://solscan.io/tx/26mcFprjEQFgxNG1mcEPTXjsaMiQmni9yeLHgATZqiVDwr6VVHgj1XmGRXwEsT3dYXYoHFKC4UdVseDotvdCmiLb?cluster=devnet) |
| R5 | ✅ | unwrap_wsol converts vault-held wrapped SOL into lamport rewards | unwrapped 0.3 SOL + closed-account rent to rewards; wSOL account closed | [tx](https://solscan.io/tx/5K9iD4w7PGfeB8Xe3bFJvmYaXQge3jPyrgEP2pJskJp9P96QhsH8N5dzSSaoT9gvCLKmiX5cHZp7D4mTM4NYfynv?cluster=devnet) |
| R6 | ✅ | unwrap_wsol rejects a wSOL account the vault does not own (InvalidWsolAccount) | rejected [InvalidWsolAccount] | — |
| R10 | ✅ | a third party can donate via notify_token_rewards | donor added 500 tokens to the pool | [tx](https://solscan.io/tx/5CgZfSEP7q7PTfiYm5K7YSXYp348a3i1beRtQkbc667EvTijgjtzL6mZFjExgYWYW3qn1rZaFJBZCMpn1nMgnXW3?cluster=devnet) |
| R8 | ✅ | invariant: vault balances never fall below what is reserved | vault 924000 >= reserved 924000; sol ok | — |
| K12 | ✅ | flexible unstake inside the cooldown fails (CooldownActive) | request made; immediate unstake rejected [CooldownActive] | — |
| K13 | ✅ | after the cooldown, a partial flexible unstake pays principal only | partial unstake returned 4000 principal | [tx](https://solscan.io/tx/3JMiEs8HpQTB7YGTkLFdNn61bKefohVBpqHxYRHuxnm61gYwJoZa5utthM83heVdB9dDTicdqjpJWrwZMgH6pMyg?cluster=devnet) |
| K14 | 📝 | a second partial unstake succeeds without a fresh request (documented quirk) | second partial unstake succeeded without re-requesting — flag for review | [tx](https://solscan.io/tx/5i43KK2nP9rgDwnDyG9m5NpB7wFBmq3WVBnAUjpXwT1iZBsjrFLKWnKLYNydUuvt3dWDHGzeLqPkaNQdgErHSvJ?cluster=devnet) |
| I4 | ✅ | influencer stream vests fully and pays the whole amount by the end | full 300000 withdrawn at maturity | [tx](https://solscan.io/tx/2p5sug7C17ajpMvqgr5Zhnza81266ufpHzmGMSxPZsGFXoCuw15GyLVg1CwjEFM6kk38BVwEArNYHhh1MHT5VgMg?cluster=devnet) |
| I4b | ✅ | a matured, fully-withdrawn stream yields nothing further | re-withdraw rejected [NothingToWithdraw] | — |
| K10 | ✅ | boost escrow releases after lock maturity | released 49333 escrow after maturity; escrow now 0 | [tx](https://solscan.io/tx/33vFoTHErJZKuxhUh9tA3gHwPoF8s5ZsY6JgrnxBa9CPLiRcKgZNfVAunQpKhw2nbGakD79wXzjKC7xQ6RuyiubP?cluster=devnet) |
| G7 | ✅ | the 2014 signer stream vests and pays in full | full 100000 withdrawn | [tx](https://solscan.io/tx/rqv5vb65U7wdPAA6CFy9U3C9hUBRahikeLPRwWmsUgFiHmraHhoqEq7eQj11sxpLc7zwkdTvN7KQZKzqB7JuUN4?cluster=devnet) |
| T6 | ✅ | the team stream vests and pays in full by the end | full 250000 withdrawn | [tx](https://solscan.io/tx/CDPePXF11XygjQU2xBCJhK33iW1V74kFs1XvBXN5z4aukzXSEyEXatAEPAgQVryMRyPqdD81zmwT4VQKDA8QdL8?cluster=devnet) |
| T7 | ✅ | stream_withdraw signed by a non-beneficiary fails | rejected [ConstraintSeeds] | — |

## Run B — nobody shows up

Program: [`6ZzEq4Amk7hRSMCbVmFjMsejbggn7bY8vYkjVTUE2EZa`](https://solscan.io/account/6ZzEq4Amk7hRSMCbVmFjMsejbggn7bY8vYkjVTUE2EZa?cluster=devnet) · 17 scenarios

| ID | Result | What it proves | Observed | Evidence |
|----|--------|----------------|----------|----------|
| S2b | ✅ | initialize (backdated claims_start) | initialized with claims_start 50 min in the past | [tx](https://solscan.io/tx/4GVS6bJxoxNieCi12RtDLXuFYmMs2bMh2VsHcGE86rhsN3Z3Two9TtstW3SzK7jTvFGZxH5t8vAAHUYC8WMDTYRf?cluster=devnet) |
| S12 | ✅ | claims are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| S13 | ✅ | sweeps are refused before the config is locked (ConfigNotLocked) | rejected [ConfigNotLocked] | — |
| L6 | ✅ | a legacy claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| I5 | ✅ | an influencer claim after the window fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W2 | ✅ | sweep_old_holders credits the unclaimed remainder to the pool instantly | credited full 150000 (nobody claimed) to the pool at once | [tx](https://solscan.io/tx/375kKHYfyhmQWbkLCaY9qqhjNcvh7MWzYfBsemLMdktntNK1yxg6p5FDanEsE3u6T5iLDx6kDGTXtwxoGgPgVnke?cluster=devnet) |
| W3 | ✅ | sweep_old_holders cannot run twice (AlreadyClaimed) | rejected [AlreadyClaimed] | — |
| W4 | ✅ | a legacy claim after the sweep fails (ClaimWindowClosed) | rejected [ClaimWindowClosed] | — |
| W9 | ✅ | a 2014-signer claim after the deadline fails (ClaimWindowClosed) | rejected past the deadline [ClaimWindowClosed] | — |
| W8 | ✅ | sweep_original_signer opens a community stream for the whole allocation | kind1 community stream total=100000, streaming to stakers | [tx](https://solscan.io/tx/5rtHcJyTz4afVP7haGFVgVQaSCXK3VFxXm2XTmKBWC3QA88k4D2MSSb2Zd2wEnFXAvKGbDee7GWMGD58XsMgmMuT?cluster=devnet) |
| W5 | ✅ | sweep_influencers opens a 30-day community stream for the remainder | community stream kind0 total=500000, streaming to stakers | [tx](https://solscan.io/tx/SafFBRxb8owLPtpQK3wicZUEmRLKQU98CDatEdeB769mvrwAYmEzWXpsrpcVipiCidXxzjmFQR8B6yYDpBxzKd1?cluster=devnet) |
| W6 | 📝 | releasing the community stream immediately yields nothing (NothingToWithdraw) | released a 1-second sliver instead of refusing: on a live chain at least one second elapses between the sweep and the release, so linear vesting was already nonzero. The zero-elapsed refusal is only observable under bankrun's frozen clock, where it passes. Correct behavior, wrong live-chain expectation. | — |
| W7 | ✅ | release_community_stream credits roughly half at the halfway point | credited ~50% of the forfeit at the halfway point | [tx](https://solscan.io/tx/4M3kWpmXi816ZQ27ceSE5wHrkjDxFvaAp6yWqn6Ae55aRbcLQM5QHx3Vc5SxDuEgfm2YmK7qabNjsBDxH9tsJKDf?cluster=devnet) |
| W7b | ✅ | at the end the full forfeit has reached the pool exactly once | released == total == 500000 | [tx](https://solscan.io/tx/4TCEfo7gYS15EigmUYLZ1oSAp5ZgAWE8G3BXzCr5dE74yiuSPkATsUQvyg33RaCwRqqcEnc6rrYtUBfLzYE5QMm6?cluster=devnet) |
| W7c | ✅ | a fully-released community stream yields nothing further | rejected [NothingToWithdraw] | — |
| W8b | ✅ | release_community_stream credits the signer forfeit to the pool as it vests | credited 50500 so far of 100000; released=50500 | [tx](https://solscan.io/tx/Nv3ia6kHMScHkwPXXZjaoHBjqePebcT8qiHgcepX5eqbUhVBi6NcYyNSzHcZNXNE2GgM95YqxaSs6p2n83opdYu?cluster=devnet) |
| W11 | ✅ | a staker can withdraw the swept/forfeited value as real tokens | sole staker claimed 700500 tokens of swept+forfeited value | [tx](https://solscan.io/tx/4t317ahjPdj5oNdhzjkmHzfoNngxvbRUqC9FGaQFQkWKU4PsGuWHPaaMZmPCq6SAkkDE9iDQN1Bxv2kgCnNxLJ2h?cluster=devnet) |

## What is NOT covered here, and where it is

- **The pump.fun creator-fee chain** (setting the one-shot 90/10 split, and collecting accrued fees). pump.fun has no devnet deployment, so this is impossible to rehearse on devnet. It stays the mainnet throwaway-coin step in [TO-THE-MOON §1.5](../TO-THE-MOON.md). The distributor contract itself contains no pump.fun coupling — that lives in `app/src/pumpfun.ts` — so nothing in the contract campaign depends on it.
- **The exact 2030 boundary with real constants.** Covered by the bankrun suite's time-travel test "returns the allocation to the community after the 2030 deadline". On devnet, Run B exercised the same code path with the deadline back-dated in the build.
- **The Squads team-withdraw** (`stream_withdraw` signed by a multisig vault). Proven on the final deployment — see below.

## Final devnet deployment

The campaign left devnet on a **normal-constants** build — launch-realistic, for the security review and the manual pass:

- Program: [`GgsLMe6gmK4wXuN6zMfg3wH9rb8HxCUnCvfGsESGryca`](https://solscan.io/account/GgsLMe6gmK4wXuN6zMfg3wH9rb8HxCUnCvfGsESGryca?cluster=devnet)
- Config: [`6APb2D5kwaDSnLFBjVdczHEEBPLuDvNz6xGfNH9YLJhm`](https://solscan.io/account/6APb2D5kwaDSnLFBjVdczHEEBPLuDvNz6xGfNH9YLJhm?cluster=devnet)
- Allocation split: 15 / 50 / 10 / 25 of a 200M fixture total (30M legacy, 100M influencers, 20M signer, 50M team), verified on chain
- Team stream beneficiary (Squads vault): [`AZ4hxoebwUqGzraYQtHr3tWmkqF3oLxKH2hqZPt4P32Y`](https://solscan.io/account/AZ4hxoebwUqGzraYQtHr3tWmkqF3oLxKH2hqZPt4P32Y?cluster=devnet)
- Team-withdraw through Squads (propose→approve→execute): [tx](https://solscan.io/tx/5pK25AVjzEJqFW8427ecC32CuZqYcoz1nBqBf2kQdZ4ZJLfQRpL2Qk1xdRd95QUvD7zJZ7sZ1bsjSncuo7us2KdG?cluster=devnet)
- Team stream: cliff 0 on this devnet fixture so the Squads withdraw is exercisable; the signer bucket uses the real 2014 public key and is genuinely unclaimed. verify-snapshot.ts --onchain passes against this config.

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
