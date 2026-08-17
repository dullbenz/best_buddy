# Receipts — the case for the relaunch

> Fill this in **now**, before launch. Links rot, socials get deleted, and
> screenshots without dates convince nobody. This file is both your defence if
> the old dev objects and the justification for every wallet excluded from the
> snapshot.

Old token: `7MYegHoqDGhWdvrnxeuiAEndgG6qcs1N3W5v6SXspump`

---

## 1. Creator wallets

Every wallet believed to belong to the original creator, with how it was
identified. Anyone should be able to follow the reasoning, not just take it on
faith.

| Wallet | How identified | Excluded from snapshot |
|---|---|---|
| `<address>` | creator of the pump.fun coin — `<solscan link>` | yes |
| `<address>` | received `<n>` tokens from creator pre-launch — `<link>` | yes |

## 2. The dumps

Dated, linked, with amounts. This is the core of the case.

| Date | Wallet | Action | Amount | Transaction |
|---|---|---|---|---|
| `<YYYY-MM-DD>` | `<address>` | sold into the pool | `<n>` | `<solscan link>` |

Summary: `<total sold>` tokens, roughly `<$>` at the time, over `<n>` days.

## 3. Abandonment

Evidence that the creator walked away — not a claim about the price. The
community kept showing up; he did not, and his silence is what this section
documents.

| Date | What | Evidence |
|---|---|---|
| `<date>` | last post on X | `<link>` + `<Wayback capture>` |
| `<date>` | Telegram admin stopped responding | `<dated screenshot>` |
| `<date>` | website went offline | `<Wayback capture>` |
| ongoing | creator fees still being collected | `<link>` |

Archive everything with the [Wayback Machine](https://web.archive.org/save/)
today. A deleted tweet you did not capture is worth nothing later.

## 4. Community impact

| Date | What | Evidence |
|---|---|---|
| `<date>` | community asked for a CTO and got no reply | `<screenshot>` |
| `<date>` | holders organised independently | `<link>` |

## 5. Pool and infrastructure addresses

Not wrongdoing — these are excluded from restitution because they are contracts,
not people. Left in, an AMM vault would take a pro-rata slice of a bucket meant
for the holders it was trading against, and nothing could ever claim it: a PDA
has no private key, so that share would sit unclaimed until the sweep moved it
to the stakers. Excluding them keeps the restitution with the people it is for.

Every address here is reproduced in `excluded.csv` with the same reason, so the
list can be argued with rather than taken on faith.

| Address | What it is | Excluded |
|---|---|---|
| `<address>` | PumpSwap pool vault | yes |
| `<address>` | Meteora pool vault | yes |
| `<address>` | burn address | yes |

## 6. Optional — the pump.fun CTO application

Filing pump.fun's official community-takeover fee-redirect application for the
**old** token is worth doing even though the relaunch is the main plan. An
approved application is third-party confirmation that the project was
abandoned, which is far stronger evidence than your own dossier.

- Filed: `<date>`
- Status: `<pending / approved / denied>`
- Reference: `<link>`

---

## How to use this

Link it from the pre-commitment document and from the claim site. When someone
asks "why does this new token deserve the old one's story", the answer should be
a link, not an argument.

Two things to keep in mind while writing it:

**Stick to what is documented.** Transactions, timestamps, archived pages. Skip
speculation about motives — the transaction history is more damning than any
adjective, and speculation is what gives someone grounds to complain.

**Exclusions need reasons, not just addresses.** Every wallet you leave out of
the snapshot is someone you are denying restitution to. Publish the reason next
to each one so the decision can be argued with.
