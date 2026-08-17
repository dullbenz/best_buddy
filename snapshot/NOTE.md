# The frozen legacy holder set

Taken from mainnet at **finalized slot 439869907** (2026-08-17T14:48:36Z) against
the legacy Buddy mint `7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump`.

| | |
|---|---|
| token accounts read | 3,468 |
| holders (after merging multi-account wallets) | 976 |
| excluded (pool / program vaults) | 3 |
| **eligible wallets in the tree** | **946** |

## What is final here, and what is not

**Final — the WHO.** `holders.csv` (`owner,old_balance,...`) is the frozen holder
set and their real legacy balances at that slot. This never changes. It is the
input the launch-day recompute reuses, and the reason it must be kept: Solana's
`getProgramAccounts` sees present state only, so no RPC can replay this slot
later. If this file were lost, the published snapshot could not be reproduced.

**Not final — the HOW MUCH.** `allocations.json`, `proofs.json`, the
`merkleRoot` in `manifest.json`, and the `new_allocation` column of
`holders.csv` are computed from a **placeholder** bucket size (30,000,000
tokens). Bucket 2 is 15% of the distributor total, and the distributor total is
however many tokens the launch buy acquires — unknown until launch. **Do not
publish these amounts or this root.**

Same for `influencers-*.json`: the ten addresses are final, the `1`-base-unit
amounts are placeholders (bucket 3 is 50% of the total, split ten ways equally).

## Launch day

Recompute both trees from this frozen set with the real total, per
[TO-THE-MOON.md](../TO-THE-MOON.md) §3.3a:

```bash
FROZEN_SNAPSHOT=snapshot BUCKET_TWO_ALLOCATION=<15% of the total> npx ts-node scripts/snapshot.ts
```

That preserves the slot, the date and all 946 wallets, and emits the real
`OLD_ROOT`. Then rebuild the influencer tree for `INF_ROOT`, run
`verify-snapshot.ts`, and publish everything.
