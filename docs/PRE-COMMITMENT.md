# Buddy — pre-commitment document

> **Publish this before launch, not after.** Its whole value is that it went out
> while the team could still have chosen differently. Replace every `<...>`
> below with real values, then never edit it again except to add links.

---

## Why this exists

The legacy Buddy token (`7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump`) was
abandoned by its creator, who sold into the community he built and continued
collecting creator fees from a project he had walked away from. The evidence is
in [RECEIPTS.md](./RECEIPTS.md) — transaction by transaction.

A community takeover of the old token would still have routed fees to him. So
this is a new token, run by rules in a contract instead of promises from a
person.

The mechanism below is designed on one assumption: **nobody should have to trust
us.** Every number here is enforced by a program whose source is public, whose
build is reproducible, and whose parameters are frozen on chain before the first
claim opens.

---

## The four buckets

| Bucket | Who | Window | How it pays |
|---|---|---|---|
| 1 | Community stakers | perpetual | pro-rata, continuously |
| 2 | Legacy Buddy holders | 30 days | instantly, no lockup |
| 3 | Influencers | 72 hours | 30-day stream on claim |
| 4a | The original 2014 Bitcoin signer | until 2030-12-31 | 12-month stream |
| 4b | The new dev | automatic | 12-month stream behind a cliff |

**One rule governs all of it: anything unclaimed becomes community staking
rewards.** Expired influencer allocations, the unclaimed old-holder remainder,
the founder allocation if the 2014 signer never appears, forfeited boost escrow
and slashed principal from people who break their locks — every last unit ends
up in bucket 1.

### Allocations

| Bucket | Amount | Share |
|---|---|---|
| 2 — Legacy Buddy holders | `<amount>` | `<55%>` |
| 3 — influencers | `<amount>` | `<15%>` |
| 4a — original signer | `<amount>` | `<20%>` |
| 4b — new dev | `<amount>` | `<10%>` |
| 1 — staking pool | **0 at launch** | grows forever |

Bucket 1 starting empty is deliberate. It is funded by what the ecosystem
generates and by what other people forfeit, not by a pre-mine.

---

## Bucket 2 — Legacy Buddy holders

Snapshot taken at slot `<slot>` (`<UTC time>`), chosen **retroactively** — the
block of `<the documented event: e.g. the creator's final sell transaction>`,
`<solscan link>`.

The moment was already in the past when this was published, deliberately.
Announcing a future snapshot would have told the whole market to go buy the old
token and farm the airdrop, which would have handed restitution to speculators
instead of the people it is owed to — and paid the old creator's fees on the way
through.

- Full holder list, allocations and Merkle proofs: `<link>`
- Merkle root committed on chain: `<hex>`
- Excluded wallets and the reason for each: `<link>`

Anyone can re-run `scripts/verify-snapshot.ts` against the published files and
must arrive at the identical root. If they do not, we are lying and it is
provable in about thirty seconds.

**Claimed tokens transfer instantly and are yours.** Sell them the same minute
if you want to. This is restitution to people who were already treated badly
once; attaching conditions to it would be its own insult.

30 days rather than 72 hours because there is no way to contact these wallets
directly, and many belong to people who left after the rug.

---

## Bucket 3 — influencers

The complete list of addresses and amounts is published at `<link>`. There are
no allocations that are not on that list.

72 hours to claim. Claiming opens a 30-day linear stream rather than
transferring at once — the programme is for people who show up and stay, not
exit liquidity. Anything unclaimed at the deadline goes to the stakers.

Everyone on that list has been told in writing to disclose that they were
compensated whenever they post about this token.

---

## Bucket 4a — the original signer

In 2014, someone signed a message on the Bitcoin blockchain that became this
story. That spend revealed their public key:

```
<0480ba01...4779>
```

An allocation is reserved for whoever controls the corresponding private key,
claimable until **2030-12-31 23:59:59 UTC**.

Proving it needs no permission from us. They sign a message with that Bitcoin
key naming a Solana address; the program verifies the signature on chain with
the secp256k1 recovery syscall and opens a 12-month stream to the address they
named. The message embeds the destination, so a signature cannot be stolen and
redirected.

**If they claim, the tokens are theirs — including the right to sell all of
them.** We are committing to that now, publicly, years before it could happen,
so that nobody can pretend later that it was not the deal. Twelve years is long
enough.

If nobody ever claims, the allocation goes to the community after the deadline.

---

## Bucket 4b — the new dev

The dev's allocation streams linearly over 12 months behind a `<30>`-day cliff.

**The dev wallet holds no tokens after deployment.** Every token the dev will
ever receive from this allocation exists only inside the distributor contract
and comes out at a fixed rate that nobody — including the dev — can accelerate.

Ongoing dev income is the retained share of pump.fun creator fees: **10%
retained, 90% to the community staking pool.**

That split is set once, on chain, through pump.fun's fee-sharing config — which
revokes its own admin immediately afterwards. It is therefore **permanent and
publicly verifiable**, exactly like the burned upgrade authority. Neither we nor
anyone else can change it later.

---

## Bucket 1 — the staking pool

Stake the token to register; rewards accrue continuously and pro-rata.

| Tier | Multiplier | Lock | Early exit |
|---|---|---|---|
| Flexible | 1.0x | none, 3-day unstake cooldown | n/a |
| 1 month | 1.5x | 30 days | forfeits boost + 15% |
| 3 months | 2.0x | 90 days | forfeits boost + 15% |
| 12 months | 5.0x | 365 days | forfeits boost + 15% |

**Base rewards are claimable at any time, in every tier.** The portion your
multiplier earns above 1.0x — the "boost" — is held in escrow until your lock
matures.

That split exists for a specific reason. Without it, someone could take the 5.0x
rate, collect five times the rewards continuously, exit after a few weeks, and have
captured the full multiplier while honouring almost none of the commitment it
paid for — diluting everyone who actually locked. With it, breaking a lock
leaves you with roughly what a flexible staker would have earned, which is
exactly what you actually committed to.

Early exit forfeits the escrowed boost plus 15% of principal. Both go straight
into the pool for the stakers who stayed.

The pool is fed by a 90% share of pump.fun creator fees, donations from anyone,
and every forfeiture in the system.

Fees do not arrive automatically. They accumulate at pump.fun until someone
moves them — and **anyone can**, because every instruction in that chain is
permissionless. The site has a button that runs it from your own wallet. We
have no special ability to do it, and no ability to prevent it.

---

## What we cannot do

Once `lock_config` runs — before the first claim — the authority permanently
loses the ability to:

- change any allocation
- change any Merkle root
- change any deadline
- change the original signer's public key
- withdraw from any bucket

The remaining admin surface is nothing. The authority can no longer move funds.

### The upgrade authority — read this part carefully

The section above is about what the program's own instructions allow. There is a
second, more powerful control that people evaluating a Solana contract should
always check: **the upgrade authority**, which can replace the program's code
entirely.

A locked config stops a dishonest instruction call. It does **not** stop whoever
holds the upgrade authority from deploying new code that ignores the lock. Any
project telling you its contract is "locked" without telling you who holds the
upgrade authority is showing you half the picture.

So here is ours, and how to check it yourself at any time:

```
solana program show <PROGRAM_ID>
```

The `Authority` line is the answer. `none` means the program is immutable and
its code can never change again, by anyone.

**This program is immutable.** The upgrade authority was burned on launch day,
before the token was announced to anyone. There is no window, no multisig, no
future date to hold us to — the code that is deployed is the code that will run
forever.

Burn transaction: `<signature>`

| Period | Upgrade authority |
|---|---|
| Before announcement | held briefly by the deployer, to verify setup |
| From launch onward | **none — permanently immutable** |

We are telling you what this costs, because a project that only tells you the
upside is selling you something. An immutable program cannot be patched. If
there is a bug in it, nobody can fix it — not us, not anyone — and it has to
keep working until the 2030 signer deadline. Our mitigations were a full devnet
rehearsal and an independent security review (`<link>`), and those were our only
two shots at it.

We made that trade deliberately. A contract that someone can rewrite is a
contract you have to trust someone about, and this community has already been
asked to do that once.

---

**Verify it yourself:**

- Program: `<PROGRAM_ID>`
- Config account: `<CONFIG_PDA>`
- Token vault: `<VAULT_PDA>`
- Source code: `<repo link>`
- Security review: `<link>`
- Live dashboard: `<link>`

---

## What we are not saying

This document describes mechanics. It is not a promise, projection, or
suggestion about price, profit, returns, or the value of anything. It is not
investment advice. Buying a memecoin can lose you all of your money, and this
one is no different from any other in that respect.

The mechanism is designed to be fair and verifiable. It is not designed to make
anyone money, and we make no claim that it will.

---

## Signed

`<date>` — published before launch, at commit `<git sha>`.
