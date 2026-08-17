# Community content

Scripts and posts for explaining the project. Everything here follows the same
rules, because the compliance line and the trust story point the same way.

---

## Ground rules for every post

**Never say:** returns, profit, gains, guaranteed, safe investment, "we're
going to X", price targets, "early", "don't miss out".

**Always:** describe mechanics, not outcomes. Point at something checkable.
State a limitation somewhere in the piece.

Two reasons this is not just legal caution. Promising outcomes is what the last
project did, so it reads as a warning sign to exactly the people you want. And
influencers who repeat a profit claim carry the liability with you — every one
of them has been told in writing to disclose that they were compensated.

---

## TikTok — 60 seconds

Timings are for a spoken take. Keep it plain; the story does the work.

**[0:00–0:04] Hook** — *on screen: the old chart, falling*

> In 2014, someone wrote a message onto the Bitcoin blockchain. That message
> became a memecoin. And then the guy who made it sold everything and walked
> away.

**[0:04–0:12] The problem** — *on screen: Solscan, the dev's sell transactions*

> And the community stayed anyway. People kept holding it, kept trading it,
> kept pushing. But here's what made it an uphill fight — every trade still
> paid him fees. There was no way to take it over without funding the person
> who walked.

**[0:12–0:20] Turn** — *on screen: the new token page*

> So the community rebuilt it. Same story, same dog, new token. And this time
> the rules aren't a promise from a developer. They're a contract nobody can
> change.

**[0:20–0:32] The four buckets** — *on screen: simple four-box graphic*

> Everyone who held the old coin can claim their share — paid instantly, no
> lockup, sell it the same minute if you want. Influencers get 72 hours to show
> up. And there's an allocation reserved for whoever holds the original 2014
> Bitcoin key, open until 2030.

**[0:32–0:40] The rule** — *on screen: arrows converging into one box*

> Anything nobody claims doesn't come back to us. It goes to the people who
> stake. Influencers who ghost it, allocations nobody takes — it all ends up in
> the community pool.

**[0:40–0:52] The part that matters** — *on screen: terminal, `Authority: none`*

> And the team's own tokens? Locked in the contract for twelve months. They
> can't sell them. They couldn't change that if they wanted to, because the
> contract was made permanent on day one. Run this command yourself. If it says
> "none", nobody can ever touch the code again. Not them. Not anyone.

**[0:52–1:00] Close** — *on screen: mybestbuddy.fun*

> Don't take my word for it — the whole thing's built so you don't have to.
> Every address, every command, on the site. It's a memecoin. It can go to zero
> like any other. But this time you can check.

---

## TikTok — 30 second cut

> In 2014 someone signed a message on Bitcoin. It became a memecoin. Then the
> dev dumped it and walked away — and every trade after still paid him. The
> community kept it going anyway, uphill the whole way.
>
> So they rebuilt it. Legacy holders can claim, paid instantly, no lockup.
> Anything unclaimed goes to the community, not to us. And the team's own tokens
> are locked in the contract for a year.
>
> One command tells you if that's true. `solana program show`, and if it says
> "Authority: none", the code can never be changed by anyone. That's the whole
> pitch — you don't have to trust us, you can check.
>
> mybestbuddy.fun. It's a memecoin, it can go to zero. But this one's honest
> about it.

---

## X / Twitter thread

**1/**
In 2014, someone signed a message onto the Bitcoin blockchain.

That message became a memecoin. Then its creator dumped on everyone who
believed in it and walked away — while still collecting fees on every trade.

The community never left. It kept the coin alive, and now it has rebuilt it.
Here's how, and how to verify all of it. 🧵

**2/**
Why a new token and not just the old one? Because the old coin's rules were
only ever promises. Nothing about it could be locked down, and the creator had
already dumped and moved on to his next launch.

So: new token, same story, rules enforced by a contract nobody can walk away
with — that's the part the old coin could never have.

**3/**
Four buckets.

• Legacy holders — 30 days to claim, paid instantly, no lockup
• Influencers — 72 hours, then a 30-day stream
• The 2014 signer — reserved until 2030
• The team — 12-month stream behind a cliff, paid to a multisig

**4/**
One rule ties them together: anything unclaimed becomes community staking
rewards.

Influencers who don't show. Legacy holders who never return. The 2014 allocation
if nobody claims it. Tokens forfeited by broken staking locks.

None of it comes back to us.

**5/**
The 2014 allocation is the part I like most.

That original Bitcoin transaction revealed a public key. The contract verifies a
signature against it directly, on-chain. No oracle, no committee, no permission
needed from us.

If they turn up before 2030, it's theirs. Including the right to sell it all.

**6/**
Staking: longer locks earn more, up to 5x.

But the multiplier is held in escrow until your lock matures. Base rewards are
claimable any time; the boost isn't.

Otherwise you could take 5x, collect for three weeks, leave — and dilute
everyone who actually committed.

**7/**
Now the part that should decide whether you believe any of the above.

Solana programs are upgradeable by default. Whoever holds the upgrade authority
can replace the code and ignore every rule in it.

Most "locked contract" claims never mention this.

**8/**
Ours was destroyed on launch day, before the token was announced.

  solana program show <PROGRAM_ID>

If `Authority` reads `none`, the code can never change again. Not by me, not by
anyone, ever.

Ten seconds to check. Please do.

**9/**
Cost of that: it can never be patched either. A bug would be permanent.
That's why there was a devnet rehearsal and an independent review first, and
why the source is public.

Trade made on purpose. A contract someone can rewrite is a contract you have to
trust someone about.

**10/**
One more thing worth knowing, because most projects hide it.

Trading fees don't flow to the pool automatically — they sit at pump.fun until
someone moves them. Every instruction in that chain is permissionless.

So there's a button on the site. Anyone can press it. Including you.

**11/**
90% of those fees go to the community pool, 10% to the team — into a multisig,
so no single one of us can touch even that alone. Set once, on chain, through
a config that revokes its own admin the moment it's written.

Permanent and checkable, same as the burned upgrade authority. We couldn't
redirect it later even if we wanted to.

**12/**
Everything checkable in one place: mybestbuddy.fun/verify

Snapshot list, Merkle proofs, source, addresses, commands.

If you run the checks and they hold — say so publicly. That's worth more than
anything I can post about myself.

**13/**
It's a memecoin. It can go to zero, same as any other. Nothing here is a
prediction about price and nothing here is advice.

The difference isn't that it's safe. The difference is that you can verify what
it actually does.

---

## The ask, for technical people

Post this where developers and auditors will see it. An independent voice is
the single most valuable asset this project can acquire, and it cannot be
bought — only earned by the checks holding up.

> We're asking people who can read Solana programs to check ours and say
> publicly what they find — including if it's bad.
>
> Program: `<PROGRAM_ID>`
> Source: https://github.com/dullbenz/best_buddy
> Guide: mybestbuddy.fun/verify
>
> Specifically worth a look:
> • the upgrade authority is burned (`solana program show` → `Authority: none`)
> • the snapshot reproduces from public data (`scripts/verify-snapshot.ts`)
> • the deployed bytecode matches the repo (`solana-verify`)
> • the fee split is frozen (sharing config admin revoked)
> • the sync instructions correctly separate accounted from stray funds
> • the base/boost escrow logic in `state.rs::settle`
> • the secp256k1 path in `utils.rs::verify_bitcoin_signature`
>
> If something's wrong, we'd rather hear it loudly than have it found later. The
> program is immutable, so we can't patch it — but the community deserves to
> know either way.

---

## Answers to the obvious questions

**"How is this different from any other relaunch?"**
Mostly it isn't — same token standard, same launchpad. The difference is the
contract can't be changed, the team can't sell, and every number is checkable.
That's it. If those things don't matter to you, this isn't different.

**"Why should I trust you?"**
You shouldn't. That's the design. Check the upgrade authority, check the vault,
rebuild the snapshot. The whole point is that trusting me is optional.

**"What if you rug?"**
The mechanism doesn't allow it: the team's tokens are in a stream paying a
multisig, and the code can't be changed. What we *can* do is stop showing up —
we can't steal the contract, but we can go quiet. That risk is real and we're
not going to pretend otherwise. The buckets keep working regardless; the
sweeps are permissionless and anyone can run them.

**"Is the old dev going to complain?"**
Maybe. The receipts are published. Everything in them is public chain data.

**"Will this go up?"**
No idea, and anyone telling you otherwise is guessing or lying. It's a memecoin.
