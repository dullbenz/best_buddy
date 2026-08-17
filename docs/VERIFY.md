# Verify this yourself

Every claim this project makes about itself, and how to check it without
trusting anyone involved.

This is the canonical version. The site renders the same checks live at
`mybestbuddy.fun` → **Verify**, running the ones it can against the chain in
your browser. Anything the site cannot read, it says so rather than guessing —
a verification page that shows a green tick it did not actually earn is worse
than no page at all.

**If you run these and they hold, please post that publicly.** An independent
check from someone with no stake in the outcome is worth more than anything the
team can write about itself.

---

## Addresses

| What | Address |
|---|---|
| Program | `6gXQUJ8WQWZjhvNWPqDNMYk185hQyZyn3yTEAwkx6qHM` |
| Config | `5FchcWEipuLrsYWs6M634jEiHYudY1LaWc4zZKMGQJbT` |
| Token vault | `EuLtBocmZxYTG77rqYxjLKSs8okTSCiBXpEYMkUJa5Lz` |
| SOL vault | `Fd8YBEg6VZ2LPDXVJARD9fEcwjYGhdteNSoEiERfMykB` |
| Staking pool | `Gaj4qbq8szJqY5G8E6gw6Ky7n13DrktcYbdgED9mxqND` |
| pump.fun fee config | `HVwUvuA8MQrP8rWQC3uytwaA8NU8XpsDSUtoAveWp6ts` |
| Token mint | `G93spDaBFKHEjjURJ38uGoXwD7Wpfv5inihDLhybpump` |
| Source | https://github.com/dullbenz/best_buddy |
| Devnet test campaign | https://github.com/dullbenz/best_buddy/blob/main/docs/E2E-DEVNET-CAMPAIGN.md |

---

## 1. The program can never be changed

**The single most important check, and the one almost nobody runs.**

```bash
solana program show 6gXQUJ8WQWZjhvNWPqDNMYk185hQyZyn3yTEAwkx6qHM
```

The `Authority` line must read **`none`**.

If it names any address, that address can replace the program's code with
something completely different, and every other guarantee below is void. A
project that says "our contract is locked" without telling you who holds the
upgrade authority is showing you half the picture — possibly deliberately.

This program's upgrade authority was destroyed on launch day, before the token
was announced. Burn transaction: `<signature>`.

## 2. The rules are frozen

```bash
solana account <CONFIG_PDA>
```

Or read it through the Verify tab, which decodes it for you.

`locked: true` means the program itself now rejects any attempt to change
allocations, Merkle roots, deadlines or the 2014 signer's key — regardless of
who is asking.

## 3. The vault still covers everything it owes

```bash
spl-token balance --address EuLtBocmZxYTG77rqYxjLKSs8okTSCiBXpEYMkUJa5Lz
```

Compare against **what is still outstanding**, not the launch-day total:

```
unclaimed bucket 2  +  unclaimed bucket 3  +  the signer allocation if unclaimed
                    +  everyone's staked principal
```

The balance is *supposed* to fall as people claim — that is the contract
working. What must never happen is it falling below what is still owed. This is
a lower bound, since the vault also backs stream remainders that cannot be
enumerated from outside, so it should hold with room to spare.

At launch, before any claims, outstanding equals the full committed total; the
program refuses to lock unless the tokens are physically present.

## 4. The eligibility list is reproducible

The old-holder list was built off-chain, because Solana programs cannot
enumerate token holders. That is only trustworthy if you can regenerate it.

```bash
git clone https://github.com/dullbenz/best_buddy && cd best_buddy && npm install --legacy-peer-deps
```

```bash
RPC_URL=<your-archival-rpc> npx ts-node scripts/verify-snapshot.ts --onchain
```

It rebuilds the Merkle tree from the published allocations, regenerates every
proof, and compares the root against what is committed on chain. Any
discrepancy is a hard failure with a message saying which check broke.

You can go further and re-derive the holder set yourself from the snapshot slot
using any archival RPC. The slot and the reason it was chosen are in the
pre-commitment document; the input is public chain history that nobody can
alter after the fact.

## 5. The deployed code matches the published source

Reading source proves nothing unless that source is what actually got deployed.

```bash
solana-verify verify-from-repo -um --program-id 6gXQUJ8WQWZjhvNWPqDNMYk185hQyZyn3yTEAwkx6qHM https://github.com/dullbenz/best_buddy
```

## 6. The team cannot dump

```bash
solana account <TEAM_STREAM_PDA>
```

The team's allocation exists only inside a vesting stream: a fixed total, a
cliff, and a linear release over twelve months that nobody can accelerate. The
beneficiary is the team's multisig vault, and neither it nor any team member's
wallet holds the allocation itself.

Check the multisig vault's token balance directly if you want to confirm that.

## 7. The fee split is frozen, and most of it goes to the community

```bash
solana account <SHARING_CONFIG_PDA>
```

Two things to confirm: the shareholder list reads **90% the SOL vault, 10% the
team's multisig vault**, and the **admin is revoked**.

The second matters more than the first. pump.fun lets a fee split be set exactly
once and then permanently revokes the ability to change it. Until that flag is
set, a team could still redirect the community's fees to themselves once the
token has traction — which is precisely the failure this project exists to
answer. A percentage without a revoked admin is a promise, not a guarantee.

Note also what this implies about the funding path: fees are **not** pushed
anywhere automatically. They accumulate at pump.fun until somebody moves them,
and every instruction involved is permissionless — including for you. If the
team went silent tomorrow, the community could still route its own fees.

## 8. Forfeited tokens actually go to the community

Every expiry in the system routes to the staking pool. The pool's
`lifetime_token_rewards` only ever increases, and each increase is a
transaction you can inspect.

```bash
solana account <POOL_PDA>
```

Watch it move after the influencer window closes at 72 hours — that is the
first large forfeiture, and it is the easiest single proof that the dead-man
rule is real rather than decorative.

---

## What verification cannot tell you

Being straight about the limits, because a page that oversells its own rigour
is doing the same trick from a different angle:

- **Verification is not a guarantee of safety.** These checks confirm the
  contract is what we say it is. They do not prove it is free of bugs — no check
  can. The source and its full test suite are public precisely so more eyes can
  look, and even that is not a promise nothing was missed.
- **Immutable means unfixable.** The same property that stops us changing the
  rules stops anyone fixing a bug. This was a deliberate trade.
- **None of this predicts price.** Everything here is about mechanics and
  custody. A memecoin can go to zero, and verified mechanics will not stop that.
