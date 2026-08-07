import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { PROGRAM_ID, SEEDS, pda, solscanAccount } from "../config";
import { fmtTokens } from "../format";
import { SharingConfigView, readSharingConfig, sharingConfigPda } from "../pumpfun";
import { useDistributor } from "../useDistributor";
import { useUpgradeAuthority } from "../useUpgradeAuthority";

type Status = "pass" | "fail" | "pending";

interface Check {
  title: string;
  status: Status;
  detail: string;
  why: string;
  command?: string;
  link?: string;
  linkLabel?: string;
}

/**
 * The "don't trust us" page.
 *
 * Every claim the project makes about itself is restated here as something the
 * reader can confirm — live from chain where we can do it for them, and as a
 * copy-pasteable command where they should do it themselves. Anyone technical
 * enough to run the commands can then vouch for the result publicly, which is
 * worth far more than the team asserting it.
 */
export function Verify() {
  const { config, pool, vaultBalance, loading, error } = useDistributor();
  const upgrade = useUpgradeAuthority();
  const { connection } = useConnection();
  const [copied, setCopied] = useState<string | null>(null);
  const [sharing, setSharing] = useState<SharingConfigView | null>(null);

  useEffect(() => {
    if (!config?.rewardMint) return;
    let cancelled = false;
    readSharingConfig(connection, config.rewardMint)
      .then((v) => !cancelled && setSharing(v))
      .catch(() => !cancelled && setSharing(null));
    return () => {
      cancelled = true;
    };
  }, [connection, config?.rewardMint?.toBase58()]);

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  const programId = PROGRAM_ID.toBase58();
  const configPda = pda([SEEDS.config]).toBase58();
  const vaultPda = pda([SEEDS.vault]).toBase58();
  const solVaultPda = pda([SEEDS.solVault]).toBase58();

  const checks: Check[] = [];

  // A verification page must never render a verdict it could not actually
  // reach. Unreadable chain state is "unknown", never pass and never fail —
  // a false VERIFIED here would be worse than showing nothing at all.
  const UNREADABLE = "Could not read this from the chain — check it yourself below.";

  // 1 — immutability, the one that matters most.
  checks.push({
    title: "The program can never be changed",
    status: upgrade.loading || upgrade.error || upgrade.immutable === null
      ? "pending"
      : upgrade.immutable
      ? "pass"
      : "fail",
    detail: upgrade.loading
      ? "reading the upgrade authority…"
      : upgrade.error || upgrade.immutable === null
      ? UNREADABLE
      : upgrade.immutable
      ? "Upgrade authority: none. The deployed code is permanent."
      : `Upgrade authority is still held by ${upgrade.authority}. Until this reads "none", the code can be replaced.`,
    why:
      "A locked configuration only limits what the current code allows. Whoever holds the upgrade authority can deploy different code and ignore it entirely. This is the check almost nobody performs, and it is the one that decides whether any other promise is enforceable.",
    command: `solana program show ${programId}`,
  });

  // 2 — config frozen.
  checks.push({
    title: "Allocations, deadlines and Merkle roots are frozen",
    status: loading || !config ? "pending" : config.locked ? "pass" : "fail",
    detail: loading
      ? "reading the config…"
      : !config
      ? UNREADABLE
      : config.locked
      ? "Config is locked. No allocation, root, deadline or key can be altered."
      : "Config is NOT locked. Parameters can still be changed by the authority.",
    why:
      "Before the lock the authority can change who gets what. After it, those fields are rejected by the program itself, whoever is asking.",
    // `solana account` returns raw base64, which proves nothing to a reader.
    // Solscan decodes Anchor accounts against the published IDL, so the flag is
    // legible without running anything.
    link: `${solscanAccount(configPda)}#anchorData`,
    linkLabel: "Decode the config account on Solscan",
  });

  // 3 — the vault covers everything still owed.
  //
  // Deliberately measured against *outstanding* obligations rather than the
  // original committed total: the vault legitimately shrinks as Legacy Buddy holders
  // claim, so comparing to the launch-day total would report a false failure
  // the moment claims started. This is a lower bound — the vault also holds
  // stream remainders we cannot enumerate from here — so it must always hold.
  const outstanding =
    config && pool
      ? BigInt(config.oldHolderAllocation) -
        BigInt(config.oldHolderClaimed) +
        (BigInt(config.influencerAllocation) - BigInt(config.influencerClaimed)) +
        (config.originalSignerClaimed || config.originalSignerSwept
          ? 0n
          : BigInt(config.originalSignerAllocation)) +
        BigInt(pool.totalStaked)
      : null;
  checks.push({
    title: "The vault still covers everything it owes",
    status:
      loading || outstanding === null
        ? "pending"
        : vaultBalance >= outstanding
        ? "pass"
        : "fail",
    detail: loading
      ? "reading the vault…"
      : outstanding === null
      ? UNREADABLE
      : `Vault holds ${fmtTokens(vaultBalance)}, against ${fmtTokens(outstanding)} in unclaimed allocations plus staked principal.`,
    why:
      "Unclaimed restitution and everyone's staked tokens have to be physically present, not merely promised. The balance falls as people claim — that is correct — so what matters is that it never falls below what is still owed.",
    command: `spl-token balance --address ${vaultPda}`,
  });

  // 4 — the Token Creator cannot dump.
  checks.push({
    title: "The Token Creator's tokens are locked in a stream",
    status: loading || !config ? "pending" : config.devStreamCreated ? "pass" : "fail",
    detail: loading
      ? "reading the config…"
      : !config
      ? UNREADABLE
      : config.devStreamCreated
      ? `${fmtTokens(config.devAllocation)} released linearly over 12 months behind a cliff. The Token Creator's wallet holds none of it.`
      : "The dev stream has not been created yet.",
    why:
      "The original token failed because its creator could sell whenever he liked. Here the Token Creator's allocation exists only inside the contract and comes out at a fixed rate nobody can accelerate.",
  });

  // 5 — reproduce the snapshot.
  checks.push({
    title: "The Legacy Buddy holder snapshot is reproducible from public data",
    status: "pending",
    detail:
      "Run the verifier against the published files. It rebuilds the Merkle tree from scratch and compares the root to what is committed on chain.",
    why:
      "The eligibility list was produced off-chain, because Solana programs cannot enumerate token holders. That is only trustworthy if anyone can regenerate the identical result — which they can, because the input is public chain history.",
    command: `RPC_URL=<your-rpc> npx ts-node scripts/verify-snapshot.ts --onchain`,
  });

  // 6 — the fee split is frozen and points at the community.
  // Creator fees are paid as lamports, so the shareholder to look for is the
  // SOL vault — not the token vault.
  const vaultShare = sharing?.shareholders.find(
    (h) => h.address === solVaultPda
  );
  checks.push({
    title: "The fee split is frozen, and most of it goes to the community",
    status:
      !sharing || !sharing.exists
        ? "pending"
        : sharing.adminRevoked && !!vaultShare
        ? "pass"
        : "fail",
    detail: !sharing
      ? UNREADABLE
      : !sharing.exists
      ? "No fee-sharing config found for this mint yet."
      : `${
          vaultShare ? (vaultShare.shareBps / 100).toFixed(0) : "0"
        }% of creator fees go to the community vault. Admin: ${
          sharing.adminRevoked
            ? "cleared — the split can no longer be changed"
            : sharing.admin
        }. Status: ${sharing.status}.`,
    why:
      "pump.fun lets a fee split be set exactly once, after which it revokes the admin and the shares are permanent. That is what stops a team quietly redirecting the community's fees to themselves once a token has traction — so the thing to check is not just the percentage but that the admin really is revoked.",
    link: solscanAccount(
      config ? sharingConfigPda(config.rewardMint).toBase58() : ""
    ),
    linkLabel: "Inspect the fee-sharing config on Solscan",
  });

  // 7 — source matches what is deployed.
  checks.push({
    title: "The published source matches the deployed bytecode",
    status: "pending",
    detail:
      "Build the repository yourself and compare the hash to the on-chain program.",
    why:
      "Reading the source proves nothing unless the source is what actually got deployed. This closes that gap.",
    command: `solana-verify verify-from-repo -um --program-id ${programId} <repo-url>`,
  });

  return (
    <div className="stack">
      <section className="card highlight">
        <h2>Verify this yourself</h2>
        <p className="muted">
          Nothing on this page asks you to believe us. Each item below is a claim
          this project makes about itself, paired with the way to check it — read
          live from the chain where we can, and as a command you can run where
          you should do it yourself.
        </p>
        <p className="muted small">
          If you run these and they hold up, please say so publicly. An
          independent verification is worth more than anything we can write.
        </p>
      </section>

      {error && (
        <div className="card error">
          Could not read on-chain state: {error}
          <div className="muted small">
            The live checks below need a working RPC. The commands work regardless.
          </div>
        </div>
      )}

      {checks.map((check, i) => (
        <section className="card" key={i}>
          <div className="check-head">
            <span className={`badge ${check.status}`}>
              {check.status === "pass" ? "VERIFIED" : check.status === "fail" ? "FAILED" : "CHECK IT"}
            </span>
            <h2>{check.title}</h2>
          </div>
          <p>{check.detail}</p>
          <p className="muted small">{check.why}</p>
          {check.command && (
            <div className="cmd">
              <code>{check.command}</code>
              <button onClick={() => copy(check.command!, `c${i}`)}>
                {copied === `c${i}` ? "copied" : "copy"}
              </button>
            </div>
          )}
          {check.link && (
            <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
              <a href={check.link} target="_blank" rel="noreferrer noopener">
                {check.linkLabel ?? check.link}
              </a>
            </p>
          )}
        </section>
      ))}

      <section className="card">
        <h2>Addresses</h2>
        <p className="muted small">
          Everything above refers to these. Look them up on any explorer.
        </p>
        <div className="table-wrap">
          <table>
            <tbody>
              {[
                ["Program", programId],
                ["Config", configPda],
                ["Token vault", vaultPda],
                ["SOL vault", pda([SEEDS.solVault]).toBase58()],
                ["Staking pool", pda([SEEDS.pool]).toBase58()],
                [
                  "pump.fun fee config",
                  config ? sharingConfigPda(config.rewardMint).toBase58() : "—",
                ],
              ].map(([label, address]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <a
                      href={solscanAccount(String(address))}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mono"
                    >
                      {address}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pool && (
        <section className="card">
          <h2>Where forfeited tokens went</h2>
          <p className="muted">
            One rule covers everything nobody takes, and all of it becomes
            rewards for the people who stayed:
          </p>
          <ul className="muted small reasons">
            <li>
              <strong>Influencers who never claimed.</strong> The 72-hour window
              closes and their allocation is gone.
            </li>
            <li>
              <strong>The Legacy Buddy holder remainder.</strong> Whatever is
              still unclaimed when the 30-day window closes.
            </li>
            <li>
              <strong>Broken staking locks.</strong> If somebody picks a locked
              tier — say 12 months at 3× — and then pulls their tokens out
              early, they give up the entire bonus they had accrued plus 20% of
              their stake. That is what "broken lock" means: a commitment ended
              before its term. The penalty is not burned and does not come to
              us; it is shared among the stakers who kept theirs.
            </li>
            <li>
              <strong>The 2014 allocation</strong>, if nobody proves the key by
              2030.
            </li>
          </ul>
          <p className="muted small">
            The counter only ever goes up, and every increase is a transaction
            you can inspect.
          </p>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{fmtTokens(pool.lifetimeTokenRewards, true)}</span>
              <span className="stat-label">Lifetime rewards into the pool</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtTokens(pool.totalStaked, true)}</span>
              <span className="stat-label">Currently staked</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
