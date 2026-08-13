# Published snapshot

The site links to these files from the Claims and Verify tabs, so they have to
be served, not just generated locally.

`scripts/snapshot.ts` writes the holder set to `snapshot/` at the repo root, and
`scripts/build-tree.ts` writes the influencer set beside it. Both directories
are working directories — copy the published subset here before building. The
runbook step is in [TO-THE-MOON.md](../../../TO-THE-MOON.md) §3:

```bash
cp snapshot/holders.csv snapshot/manifest.json snapshot/influencers.csv snapshot/influencers-manifest.json app/public/snapshot/
```

| File | Why it is public |
|---|---|
| `holders.csv` | the exact list the bucket-2 Merkle root commits to — anyone can rebuild the tree from it and check the root matches on-chain |
| `manifest.json` | the snapshot slot and totals, so the whole thing can be re-derived from public chain data |
| `influencers.csv` | the exact list the bucket-3 Merkle root commits to. Chosen by hand, so publishing it is the only check there is |
| `influencers-manifest.json` | the influencer root and totals |

There is no exclusion list. Every address holding the old token at the snapshot
slot is in `holders.csv`, with no judgement applied — a mechanical rule is the
only kind a stranger can re-derive and check against the root. Addresses that
cannot sign (AMM pool vaults, burn addresses) therefore hold allocations they
will never claim, and those are swept to the stakers when the window closes.

Until the files are copied in, the Claims tab detects that they are missing and
says the snapshot has not been published yet, rather than offering a link that
silently serves `index.html`.
