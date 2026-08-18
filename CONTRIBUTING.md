# Contributing

Thanks for looking. What this project most wants from outside contributors is
**verification**, not features — read the code, run the checks, and say
publicly what you find. That is worth more than anything the team can assert
about itself.

## The one thing to understand first

The on-chain program is **immutable**. Its upgrade authority is burned, so a
pull request against `programs/` cannot change what is running on mainnet. It
can still be worth writing (a fix belongs in the record, and any future
deployment would start from this source), but nothing merged here alters the
deployed contract. Treat `programs/` as the published artifact of something
already frozen.

Everything else — the site in `app/`, the tooling in `scripts/`, the docs —
is live and improvable in the ordinary way.

## Verifying, which is the most useful contribution

The [Verify page](https://mybestbuddy.fun/verify) lists every check with a
copy-pasteable command: reproduce the holder snapshot from public chain data,
confirm the deployed bytecode matches this source, read the frozen fee split,
confirm `Authority: none`. If a check does not hold, that is a bug report we
want urgently — see [SECURITY.md](SECURITY.md).

## Running things locally

```bash
npm install && npm test                    # 53 integration tests (bankrun)
cargo test -p buddy-distributor --lib      # 14 program unit tests
cd app && npm install && npm run dev       # the site
```

Building the program needs Anchor 0.31.1 and current platform-tools:

```bash
agave-install init stable && ~/.avm/bin/anchor-0.31.1 build
```

Never `anchor build` through avm's shim — it re-pins Solana to a version whose
cargo cannot parse this dependency tree.

## Pull requests

- Keep the diff to one idea, and say in the description what a reviewer should
  check rather than what you changed (the diff already says that).
- Tests must pass, and the committed IDL must match a fresh build — CI checks
  both, plus that no keypair file ever enters the repo.
- Match the surrounding code: this codebase comments the *why* (a constraint, a
  trap, a decision that looks wrong until explained) and leaves the *what* to
  the code.
- Copy that describes what the contract does must be true of the contract. If
  a change makes the site claim something the chain does not back, it will be
  sent back however nice it reads.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
