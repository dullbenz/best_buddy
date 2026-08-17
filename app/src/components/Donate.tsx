import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { useState } from "react";
import { SEEDS, TOKEN_DECIMALS, TOKEN_SYMBOL, pda } from "../config";
import { goTo } from "../nav";
import { useDistributor } from "../useDistributor";
import { useProgram } from "../useProgram";

/**
 * Donate.
 *
 * The pool the rest of the site describes is fed by trading fees and
 * forfeits, but it also takes plain gifts, and a gift needs nothing from us:
 * the two addresses below belong to the contract, so donating requires no
 * wallet connection, no permission and no form. You can simply send.
 *
 * The page exists because "just send it here" deserves the same honesty as
 * every other claim on the site: what happens to a donation after it
 * arrives, which assets count, and exactly what becomes of one that does
 * not. The addresses are derived locally from the program id, so this whole
 * page renders without touching the RPC; only the connected shortcut at the
 * bottom needs anything more.
 */
export function Donate() {
  const { publicKey } = useWallet();
  const program = useProgram();
  const { config, refresh } = useDistributor();

  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"sol" | "buddy">("sol");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const solVault = pda([SEEDS.solVault]).toBase58();
  const vault = pda([SEEDS.vault]).toBase58();

  /**
   * The connected shortcut. `notify_sol_rewards` / `notify_token_rewards`
   * move the amount out of the signing wallet and book it for the stakers in
   * the same transaction, so it never sits uncredited at all.
   */
  async function donate() {
    if (!program || !publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      let sig: string;
      if (asset === "sol") {
        const lamports = BigInt(Math.round(parseFloat(amount) * 1e9));
        sig = await program.methods
          .notifySolRewards(new BN(lamports.toString()))
          .accountsPartial({
            depositor: publicKey,
            config: pda([SEEDS.config]),
            pool: pda([SEEDS.pool]),
            solVault: pda([SEEDS.solVault]),
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } else {
        const raw = BigInt(
          Math.round(parseFloat(amount) * 10 ** TOKEN_DECIMALS)
        );
        sig = await program.methods
          .notifyTokenRewards(new BN(raw.toString()))
          .accountsPartial({
            depositor: publicKey,
            config: pda([SEEDS.config]),
            pool: pda([SEEDS.pool]),
            vault: pda([SEEDS.vault]),
            source: getAssociatedTokenAddressSync(config!.rewardMint, publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }
      setStatus(`Donated, and already credited to the stakers. ${sig}`);
      setAmount("");
      refresh();
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card highlight">
        <h2>Donate to the community pool</h2>
        <p className="muted">
          Donating needs no wallet connection and no permission from anyone.
          The pool lives at two addresses the contract owns, printed in full
          below; you can simply send. Whatever arrives is shared out among
          the stakers, and no wallet, including ours, can move it anywhere
          else.
        </p>
      </section>

      <section className="card">
        <h2>SOL donations</h2>
        <p className="muted small">
          The contract's SOL vault, the same account every trading fee lands
          in. Send SOL here from any wallet or exchange.
        </p>
        <div className="signer-message">
          <code>{solVault}</code>
          <Copy text={solVault} />
        </div>
      </section>

      <section className="card">
        <h2>{TOKEN_SYMBOL} donations</h2>
        <p className="muted small">
          The contract's token vault, which holds every unclaimed allocation
          and pays every staking reward. Send {TOKEN_SYMBOL} here.
        </p>
        <div className="signer-message">
          <code>{vault}</code>
          <Copy text={vault} />
        </div>
      </section>

      <section className="card">
        <h2>What happens after you send</h2>
        <p className="muted">
          A direct send sits in the vault safely but uncredited, because a
          Solana program cannot notice a balance changing; it only runs when
          a transaction calls it. Your donation starts counting for the
          stakers the moment anyone presses sync on the{" "}
          <TabLink tab="fund pool">Fund pool</TabLink> tab, and that anyone
          can be you. Nothing is ever lost in the meantime.
        </p>
        <p className="muted small">
          Wrapped SOL works too. wSOL sent to the vault's token account is
          turned back into plain SOL by the same permissionless crank, then
          credited with the rest.
        </p>
        <p className="muted small">
          <strong>Only {TOKEN_SYMBOL}, SOL or wSOL count.</strong> The
          contract cannot price any other token, so anything else sent to the
          vault is forwarded to the team multisig by a permissionless
          recovery instruction, converted by hand, and donated back. That is
          the one step that runs on trust rather than code, which is why it
          is disclosed here, and why the three assets above are the better
          way to give.
        </p>
      </section>

      <section className="card">
        <h2>Donate with your wallet, credited instantly</h2>
        <p className="muted">
          Connected wallets get a shortcut. One instruction,{" "}
          <code>notify_sol_rewards</code> or <code>notify_token_rewards</code>
          , moves the amount out of your wallet and credits it to the stakers
          in the same transaction. No sync needed, nothing sits uncredited.
        </p>
        {!publicKey ? (
          <p className="muted small">
            Connect a wallet to use it. Entirely optional: the addresses
            above work without one.
          </p>
        ) : (
          <div className="form-row">
            <input
              type="number"
              min="0"
              step="any"
              placeholder={
                asset === "sol" ? "Amount in SOL" : `Amount in ${TOKEN_SYMBOL}`
              }
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="seg">
              <button
                type="button"
                className={asset === "sol" ? "seg-btn is-active" : "seg-btn"}
                onClick={() => setAsset("sol")}
              >
                SOL
              </button>
              <button
                type="button"
                className={asset === "buddy" ? "seg-btn is-active" : "seg-btn"}
                onClick={() => setAsset("buddy")}
              >
                {TOKEN_SYMBOL}
              </button>
            </div>
            <button
              className="primary"
              disabled={
                busy ||
                !amount ||
                parseFloat(amount) <= 0 ||
                (asset === "buddy" && !config)
              }
              onClick={donate}
            >
              Donate {asset === "sol" ? "SOL" : TOKEN_SYMBOL}
            </button>
          </div>
        )}
        <p className="muted small">
          A donation is a donation: it entitles the sender to nothing back,
          from the contract or from us.
        </p>
      </section>

      {status && <div className="card status">{status}</div>}
    </div>
  );
}

/** Same copy button as the Dashboard's provenance rows. */
function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/** An inline link that changes tab, styled as a link rather than a button. */
function TabLink({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <button type="button" className="inline-link" onClick={() => goTo(tab)}>
      {children}
    </button>
  );
}
