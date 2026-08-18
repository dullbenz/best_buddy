import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
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
  const { config, rewardTokenProgram, refresh } = useDistributor();

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
            source: getAssociatedTokenAddressSync(
              config!.rewardMint,
              publicKey,
              false,
              rewardTokenProgram!
            ),
            rewardMint: config!.rewardMint,
            tokenProgram: rewardTokenProgram!,
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
        <h2>Donate with your wallet — the recommended way</h2>
        <p className="muted">
          One instruction, <code>notify_sol_rewards</code> or{" "}
          <code>notify_token_rewards</code>, moves the amount out of your
          wallet and credits it to the stakers in the same transaction.
          Nothing sits uncredited, and — the reason this way is recommended —{" "}
          <strong>nothing can be sent to the wrong place</strong>: the
          instruction routes the asset itself, so the mistake the direct
          addresses below allow is impossible here.
        </p>
        {!publicKey ? (
          <p className="muted small">
            Connect a wallet (top right) to donate this way.
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

      <section className="card">
        <h2>Don't want to connect a wallet? Send directly</h2>
        <p className="muted small">
          The pool lives at two contract-owned addresses, and you can simply
          send from any wallet or exchange. But the two are different kinds
          of account, and <strong>each accepts exactly one asset</strong>:
        </p>

        <div className="donate-grid">
          <div className="donate-cell">
            <span className="only-tag">Only SOL to this address</span>
            <p className="muted small">
              The contract's SOL vault — the account every trading fee lands
              in. wSOL also ends up here safely, via the unwrap crank.
            </p>
            <div className="signer-message">
              <code>{solVault}</code>
              <Copy text={solVault} />
            </div>
          </div>
          <div className="donate-cell">
            <span className="only-tag">Only {TOKEN_SYMBOL} to this address</span>
            <p className="muted small">
              The contract's token vault — it holds every unclaimed
              allocation and pays every staking reward.
            </p>
            <div className="signer-message">
              <code>{vault}</code>
              <Copy text={vault} />
            </div>
          </div>
        </div>

        <div className="note">
          <strong>Cross them and the donation is gone, permanently.</strong>{" "}
          SOL sent to the token vault, or {TOKEN_SYMBOL} sent to the SOL
          vault, cannot be recovered by anyone — the contract is immutable
          and has no instruction for it, and that includes us. Double-check
          the asset against the label before sending, and if you are not
          certain, use the wallet flow above: it cannot be mis-sent.
        </div>

        <p className="muted small">
          A correct direct send sits in the vault safely but uncredited until
          anyone presses sync on the{" "}
          <TabLink tab="fund pool">Fund pool</TabLink> tab — that anyone can
          be you, and nothing is lost in the meantime. Only {TOKEN_SYMBOL},
          SOL or wSOL count: the contract cannot price any other token, so
          anything else is forwarded to the team multisig by a disclosed,
          permissionless recovery instruction, converted by hand, and donated
          back.
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
