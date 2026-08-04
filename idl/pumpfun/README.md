# pump.fun IDLs (vendored)

Copied verbatim from [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)
so that `app/src/pumpfun.ts` can be checked against its source without trusting
our transcription.

Everything in `app/src/pumpfun.ts` — every account order, every discriminator,
every account layout — must match these files. They are the reason that file can
be reviewed rather than believed.

Re-fetch with:

```bash
gh api repos/pump-fun/pump-public-docs/contents/idl/pump.json --jq '.content' | base64 -d > pump.json
```

These are pump.fun's interface, not ours. If they change, only the frontend
needs updating — the distributor program references none of it.
