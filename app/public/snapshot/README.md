# Published snapshot

The site links to these files from the Claims and Verify tabs, so they have to
be served, not just generated locally.

`scripts/snapshot.ts` writes the holder set to `snapshot/` at the repo root, and
`scripts/build-tree.ts` writes the influencer set beside it. Both directories
are working directories — copy the published subset here before building. The
runbook step is in [TO-THE-MOON.md](../../../TO-THE-MOON.md) §3:

```bash
cp snapshot/holders.csv snapshot/excluded.csv snapshot/manifest.json snapshot/influencers.csv snapshot/influencers-manifest.json app/public/snapshot/
```

| File | Why it is public |
|---|---|
| `holders.csv` | the exact list the bucket-2 Merkle root commits to — anyone can rebuild the tree from it and check the root matches on-chain |
| `excluded.csv` | who was left out and why. Publishing only the winners lets a project drop anyone it likes without it showing |
| `manifest.json` | the snapshot slot and totals, so the whole thing can be re-derived from public chain data |
| `influencers.csv` | the exact list the bucket-3 Merkle root commits to. Chosen by hand, so publishing it is the only check there is |
| `influencers-manifest.json` | the influencer root and totals |

The exclusions exist because pool vaults and burn addresses are not people. An
AMM vault left in the tree would take a pro-rata slice of restitution meant for
the holders it was trading against, and nothing could ever claim it — a PDA has
no private key — so that share would sit unclaimed until the sweep handed it to
the stakers. Excluding them keeps the bucket with the people it is for. Fill
`EXCLUSIONS` in `scripts/snapshot.ts` from the receipts dossier before running
the snapshot for real; it ships empty.

Until the files are copied in, the Claims tab detects that they are missing and
says the snapshot has not been published yet, rather than offering a link that
silently serves `index.html`.
