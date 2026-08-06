# Published snapshot

The site links to these files from the Claims and Verify tabs, so they have to
be served, not just generated locally.

`scripts/snapshot.ts` writes them to `snapshot/` at the repo root, which is a
working directory. Copy them here before building — the runbook step is in
[TO-THE-MOON.md](../../../TO-THE-MOON.md) §3:

```bash
cp snapshot/holders.csv snapshot/excluded.csv snapshot/manifest.json app/public/snapshot/
```

| File | Why it is public |
|---|---|
| `holders.csv` | the exact list the Merkle root commits to — anyone can rebuild the tree from it and check the root matches on-chain |
| `excluded.csv` | who was left out and why. Publishing only the winners lets a project hide arbitrary exclusions |
| `manifest.json` | the snapshot slot and totals, so the whole thing can be re-derived from public chain data |

Until they are copied in, the site links resolve to 404 and the Claims tab says
the snapshot has not been published yet, rather than pretending otherwise.
