# Creator fees

How trading fees reach the community staking pool, why nobody has to be trusted
to make it happen, and the one step we can never undo.

---

## The short version

Every trade of the token earns creator fees. They **do not arrive anywhere by
themselves** — they pile up inside pump.fun's own vault until somebody sends a
transaction that moves them.

That somebody can be **anyone**. pump.fun's fee instructions are permissionless,
and so are ours. Chained together, any visitor can push the community's fees
into the staking pool from `mybestbuddy.fun` → **Fund pool**, using their own
wallet. No key, no bot, no trusting the team to forward anything.

```
trades ──► pump.fun creator vault
                 │  transfer_creator_fees_to_pump_v2   (permissionless)
                 │  distribute_creator_fees_v2         (permissionless)
                 ▼
        90% our SOL vault  +  10% team multisig
                 │  unwrap_wsol       (ours, a safety net)
                 │  sync_sol_rewards  (ours, permissionless)
                 ▼
           credited to stakers
```

---

## Why the contract does not call pump.fun itself

It would be tempting to have the distributor collect its own fees in one
instruction. **We deliberately did not**, and the reason is the same one behind
burning the upgrade authority.

Our program is immutable. Hard-coding pump.fun's instruction layout into it
would mean that the day they reorder an account or rename an instruction, the
fee stream dies permanently, with no way to fix it — and pump.fun shipped two
breaking fee changes in a single quarter (the January 2026 fee overhaul, the
March 2026 redirect cap).

So the coupling lives in `app/src/pumpfun.ts` instead: ordinary frontend code we
can redeploy in an afternoon. **The distributor contract contains no reference
to pump.fun at all.**

---

## Verified facts this design rests on

From pump.fun's official IDL and instruction docs
([pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)):

| Claim | Evidence |
|---|---|
| Collection is permissionless | `creator` is `signer=false` in `idl/pump.json`; the docs say "It is permissionless: anyone can call it" for `collect_creator_fee_v2`, `collect_coin_creator_fee`, `transfer_creator_fees_to_pump_v2` and `distribute_creator_fees_v2` |
| Sharing-path payouts are native lamports for a SOL-paired coin | With a sharing config on a SOL-quoted coin, both `transfer_creator_fees_to_pump_v2` and `distribute_creator_fees_v2` unwrap the wSOL internally and pay raw lamports; shareholders need no token accounts at all — "only the wallet pubkeys are required" |
| AMM fees accrue as wrapped SOL, but leave as lamports | `collect_coin_creator_fee` moves wSOL between token accounts (`coin_creator_vault_ata` → `coin_creator_token_account`); routed through the sharing path instead, the transfer/distribute pair above delivers plain lamports |
| A PDA can receive fees | The often-quoted "must not be executable, must not be owned by the Pump Fees program" constraint belongs to `collect_creator_fee_v2`'s recipient. The sharing path documents no ownership constraint on a shareholder at all, only rules about the list itself: at most 10 entries, no duplicates, `share_bps` summing to 10,000 |
| The split can be set exactly once — by the creator | *"Can only be called once per `sharing_config` (the admin is revoked after)"*. The program also carries undocumented `reset_fee_sharing_config` / `reset_fee_sharing_config_v2` instructions behind a pump.fun-side authority — see the one-shot section below |
| The coin itself will be Token-2022 | pump.fun's Global account has `create_v2_enabled = true` on mainnet (read live 2026-08-17), and `create_v2` mints under Token-2022. This does not touch the fee chain — every token program in the fee instructions is the **quote** side (SOL/wSOL, classic SPL), not the coin's — but the distributor contract, the site and the deploy scripts all use the token interface and read the mint's program at run time, so either create path works |
| The programs exist on devnet | `pump`, `pump_amm` and `pump_fees` are all deployed and executable on devnet, per the docs and a live RPC probe, so the fee chain can be dry-run there |

> One caution on secondary sources: DeepWiki's §6.2 summary states a signer *is*
> required. It is wrong. The IDL is authoritative, and it says otherwise.

---

## The one-shot: `update_fee_shares_v2`

**This is the single most dangerous step in the entire launch.**

Setting the fee split is a one-time action for the creator, enforced by
pump.fun's program. It revokes its own admin afterwards, and there is no
instruction we could ever call to touch the shareholder list again. No second
attempt.

If a share points at an address that distribution cannot pay, and payouts are
atomic across shareholders, **that one bad entry can block every future
distribution permanently.** One narrowing note: for a SOL-quoted coin the
shareholders are raw lamport credits, no token accounts involved, so the
classic missing-ATA distribution failure belongs to non-SOL-quote coins. That
shrinks the risk; it does not remove it, and a wrong pubkey is still forever.

Which is why the rehearsals below are not optional.

The upside of the same property: once the admin is revoked, the split is
provably out of our hands and anyone can verify it. Together with the burned
upgrade authority, that is two independent, checkable "the team can never
change this" facts.

One precision, stated plainly because blurring it is exactly what this project
promised not to do: the split is irrevocable **by the creator**, not absolutely
permanent. pump.fun's fee program contains undocumented
`reset_fee_sharing_config` / `reset_fee_sharing_config_v2` instructions, gated
by a pump.fun-side authority, that can replace a config's admin and
shareholders — presumably the machinery behind their CTO fee-redirect process.
So the guarantee is exactly this: the split cannot be changed by us. pump.fun
itself retains a reset path.

---

## Launch configuration

| Shareholder | Share | Why |
|---|---|---|
| Our SOL vault PDA | 90% | funds the staking pool, permanently |
| The team multisig vault (Squads, 2-of-3) | 10% | the team's only ongoing income, disclosed, and behind more than one key |

The 10% deliberately points at the **team's Squads vault**, not any member's
wallet. We can never change the split once it is set, so pointing it at one
person's key would make the team's entire future income hostage to that one
key never being lost, stolen, or walked away with. A multisig survives all
three. Nothing in pump.fun's docs stands in the way: the sharing path puts no
ownership constraint on a shareholder at all, only rules about the list
itself — and the rehearsals below prove a Squads vault can be paid rather
than assume it.

Sequence, all self-service — **no application to pump.fun is needed**:

1. Create the coin (creator = your ordinary launch wallet — the multisig is a
   payout destination, not the coin creator).
2. `create_fee_sharing_config` — signed by you as coin creator. Initial
   shareholders default to `[(creator, 10000 bps)]`.
3. `update_fee_shares_v2` — set 90% → SOL vault PDA, 10% → the team multisig
   vault. **One shot. We can never change it after this.**

> Do not confuse this with the **CTO fee-redirect application**, which is a
> request to pump.fun to reassign fees on *someone else's* abandoned coin. That
> one is discretionary and goes through their team. Setting your own coin's
> split does not.

---

## Why our contract needs `sync_*`

Crediting an account on Solana needs no permission, so value can land in our
vaults without our program being involved at all.

`notify_sol_rewards` cannot help with that: it transfers *from a caller* and
books exactly what it transferred. Funds arriving any other way would inflate
the balance while the reward ledger stayed ignorant — and payouts only release
what the ledger knows.

On an immutable contract that means **permanently frozen**. Visible, unowned,
unrecoverable.

`sync_sol_rewards` and `sync_token_rewards` close that hole. They compare the
real balance against `reserved_sol` / `reserved_token` — the running total of
what came in through our own instructions — and credit the difference to
stakers. Anyone can call them.

This also rescues donations. We publish the vault addresses on the Verify page,
so people will send funds straight to them. Without sync, every one of those
would be lost.

`unwrap_wsol` is a safety net rather than a step on the critical path. For a
SOL-paired coin the sharing distribution pays plain lamports — pump.fun
unwraps the wSOL internally — so under normal operation it finds nothing to
do. It exists for the day wrapped SOL lands in the vault anyway, a donation
say: it closes a vault-owned wrapped SOL account into plain lamports and
credits them. The wSOL mint is hard-coded so it can never be aimed at anything
else.

---

## Rehearsal — mandatory, and now twice

pump.fun's programs — `pump`, `pump_amm` and `pump_fees` — are live and
executable on **devnet**, so the fee chain can be dry-run there first, for
pocket change.

**First, the devnet dry-run.** The entire chain, end to end:

1. Create a coin on devnet pump.fun with a minimal buy.
2. `create_fee_sharing_config`, then set the 90/10 split onto the devnet SOL
   vault PDA and a devnet team multisig vault.
3. Trade a little so fees accrue.
4. Run the crank — transfer, distribute, `sync_sol_rewards` — and confirm
   value lands and gets credited on both sides of the split.

**Then, the mainnet throwaway coin — still the definitive final rehearsal.**
Devnet proves the shape of the chain, but nothing guarantees the devnet
deployment matches mainnet's program version or configuration, and the
one-shot is a mainnet decision. Before touching the real coin, on **mainnet**:

1. Create a throwaway coin with a minimal buy.
2. `create_fee_sharing_config`, then set a 90/10 split onto a test PDA of the
   same shape as the real vault, with the 10% pointing at a **test Squads
   vault** — the real configuration pays the team's multisig, and both
   recipients being program-owned accounts is exactly the property to prove.
3. Generate a little trading volume so fees accrue.
4. Run the full chain and confirm value actually lands and gets credited on
   both sides of the split.
5. **Record which form the payout took.** The docs say native lamports for a
   SOL-quoted coin, wSOL unwrapped inside the distribution, which leaves
   `unwrap_wsol` as a safety net rather than a step. Confirm it anyway; this
   is the cheap place to be surprised.

Cost: a few tens of dollars. It is the only way to validate the configuration
before spending the irreversible one-shot on the real coin.

---

## Operating it after launch

Nothing needs a schedule. Fees accrue safely in pump.fun's vault indefinitely —
they do not expire — and any community member can move them whenever they like.

Worth doing anyway:

- Run it yourself after the first burst of trading, so people see it work.
- Point at it in transparency posts: *"anyone can press this, including you."*
- Watch the **not yet credited** figure on the dashboard. If it is non-zero,
  someone donated directly and a sync will hand it to the stakers.

## Verifying

Anyone can confirm the whole arrangement:

```bash
solana account <SHARING_CONFIG_PDA>
```

Check that the shareholder list is 90% our vault / 10% the team multisig, and
that the admin is revoked. A revoked admin proves *we* can never change the
split; as noted above, pump.fun itself retains a reset path. The Verify page
renders the same check live, and shows "CHECK IT" rather than a verdict when
it cannot read the chain.
