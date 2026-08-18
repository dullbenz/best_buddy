# Security policy

## Why this file matters more here than usual

The `buddy-distributor` program
(`6gXQUJ8WQWZjhvNWPqDNMYk185hQyZyn3yTEAwkx6qHM`) is deployed on Solana
mainnet with its **upgrade authority burned**. It cannot be patched — not by
the team, not by anyone, ever. A vulnerability in it is permanent, which makes
responsible disclosure the only useful kind: the community can mitigate
(unstake, stop depositing, route around) only if it learns calmly and
accurately.

## How to report

Use GitHub's **private vulnerability reporting** on this repository
(Security tab → "Report a vulnerability"). That reaches the maintainers
privately, with a tracked thread.

Please include what you found, where (file and line, or instruction name),
and how to reproduce it. A failing test or a devnet transaction that
demonstrates the issue is worth more than any amount of prose.

## What to expect

- An acknowledgment as soon as a maintainer reads it, typically within 48
  hours.
- An honest assessment of impact. Because the program is immutable, "we'll
  patch it" is never the answer; the answer is a mitigation plan and, where
  user funds are at risk, coordinated public disclosure so nobody learns of
  the risk from an exploit.
- Credit, if you want it, wherever the issue is disclosed.

## Scope

- **In scope:** the on-chain program (`programs/buddy-distributor`), the
  claim/staking site (`app/`), the published snapshot and Merkle proof files,
  and the deploy/verify tooling in `scripts/`.
- **Out of scope:** pump.fun's own programs (report those to pump.fun),
  Solana itself, and social engineering of team members.

## What not to do

Please don't exploit an issue beyond the minimum needed to demonstrate it,
don't test against other people's funds, and don't disclose publicly before a
mitigation plan exists. The staking pool holds community money.
