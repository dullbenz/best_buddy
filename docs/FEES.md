# Creator fees

How trading fees reach the community staking pool, why nobody has to be trusted
to make it happen, and the one step that can never be undone.

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
        90% our SOL vault  +  10% dev wallet
                 │  unwrap_wsol       (ours, permissionless)
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
| Bonding-curve SOL fees are native lamports | *"When `quote_mint` is wrapped SOL the program performs a lamport transfer from `creator_vault` to `creator`"* |
| Post-graduation AMM fees are wrapped SOL | `collect_coin_creator_fee` moves between token accounts (`coin_creator_vault_ata` → `coin_creator_token_account`) |
| A PDA can receive fees | The only constraints are "must not be executable" and "must not be owned by the Pump Fees program" |
| The split can be set exactly once | *"Can only be called once per `sharing_config` (the admin is revoked after)"* |

> One caution on secondary sources: DeepWiki's §6.2 summary states a signer *is*
> required. It is wrong. The IDL is authoritative, and it says otherwise.

---

## The one-shot: `update_fee_shares_v2`

**This is the single most dangerous step in the entire launch.**

Setting the fee split is a one-time action enforced by pump.fun's program. It
revokes its own admin afterwards, and the shareholder list is frozen forever.
There is no appeal, no support ticket, no second attempt.

If a share points at an address that distribution cannot pay, and payouts are
atomic across shareholders, **that one bad entry can block every future
distribution permanently.**

Which is why the throwaway-coin rehearsal below is not optional.

The upside of the same property: once frozen, the split is provably permanent
and anyone can verify it. Together with the burned upgrade authority, that is
two independent, checkable "this can never change" facts.

---

## Launch configuration

| Shareholder | Share | Why |
|---|---|---|
| Our SOL vault PDA | 90% | funds the staking pool, permanently |
| Dev wallet | 10% | the project's only ongoing income, disclosed |

Sequence, all self-service — **no application to pump.fun is needed**:

1. Create the coin (creator = your wallet).
2. `create_fee_sharing_config` — signed by you as coin creator. Initial
   shareholders default to `[(creator, 10000 bps)]`.
3. `update_fee_shares_v2` — set 90/10. **One shot. Frozen after this.**

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

`unwrap_wsol` handles the post-graduation case: it closes a vault-owned wrapped
SOL account into plain lamports and credits them. The wSOL mint is hard-coded so
it can never be aimed at anything else.

---

## Rehearsal — mandatory

pump.fun's official docs show **no devnet deployment**; every example is a
mainnet Solscan link. The fee path therefore cannot be rehearsed on devnet.

Before touching the real coin, on **mainnet**:

1. Create a throwaway coin with a minimal buy.
2. `create_fee_sharing_config`, then set a 90/10 split onto a test PDA of the
   same shape as the real vault.
3. Generate a little trading volume so fees accrue.
4. Run the full chain and confirm value actually lands and gets credited.
5. **Record which form the payout took** — native lamports or wrapped SOL. That
   determines whether `unwrap_wsol` sits on the critical path.

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

Check that the shareholder list is 90% our vault / 10% dev, and that the admin
is revoked. The Verify page renders the same check live, and shows "CHECK IT"
rather than a verdict when it cannot read the chain.
