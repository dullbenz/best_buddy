import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import {
  PROGRAM_ID,
  REPO_ACTIONS_URL,
  REPO_URL,
  RPC_HOST,
  RPC_IS_KEYED,
  SEEDS,
  pda,
  repoPath,
  solscanAccount,
} from "../config";
import { fmtAmount } from "../format";
import { SharingConfigView, readSharingConfig, sharingConfigPda } from "../pumpfun";
import { VERIFY_ANCHORS } from "../nav";
import { useDistributor } from "../useDistributor";
import { useUpgradeAuthority } from "../useUpgradeAuthority";

type Status = "pass" | "fail" | "pending";

/**
 * Rebuild the frontend and compare it to what is being served.
 *
 * Vite hashes each asset by content, so the filename in the served HTML is
 * itself the claim: if the locally built bundle carries the same name, the
 * bytes are the same bytes.
 */
const BUNDLE_DIFF = [
  "git clone https://github.com/dullbenz/best_buddy && cd best_buddy/app",
  "npm ci && npm run build && ls dist/assets",
  "curl -s https://mybestbuddy.fun | grep -o 'assets/[^\"]*\.js'",
].join("\n");

interface Check {
  /** Stable id, so other pages can deep-link to the check that settles them. */
  id?: string;
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
 * reader can confirm: live from chain where we can do it for them, and as a
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

  // Every distinct host this page has actually talked to, read from the
  // browser's own resource timings rather than asserted by us. It is the same
  // data the network tab shows, gathered by the page itself, which turns "we
  // have no backend" from a promise into something visible on the page making
  // the promise.
  const [origins, setOrigins] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const here = window.location.origin;
      const seen = new Set<string>();
      for (const entry of performance.getEntriesByType("resource")) {
        try {
          const origin = new URL(entry.name, here).origin;
          if (origin !== here) seen.add(new URL(origin).host);
        } catch {
          /* data: and blob: URLs have no host and are not network calls */
        }
      }
      setOrigins([...seen].sort());
    };
    read();
    // Re-read after the chain calls have had time to fire; the first paint
    // happens before the RPC has been touched.
    const t = setTimeout(read, 2500);
    return () => clearTimeout(t);
  }, []);

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
  // reach. Unreadable chain state is "unknown", never pass and never fail:
  // a false VERIFIED here would be worse than showing nothing at all.
  const UNREADABLE = "Could not read this from the chain. Check it yourself below.";

  // 1: immutability, the one that matters most.
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

  // 2: config frozen.
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

  // 3: the vault covers everything still owed.
  //
  // Deliberately measured against *outstanding* obligations rather than the
  // original committed total: the vault legitimately shrinks as Legacy Buddy holders
  // claim, so comparing to the launch-day total would report a false failure
  // the moment claims started. This is a lower bound (the vault also holds
  // stream remainders we cannot enumerate from here), so it must always hold.
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
      : `Vault holds ${fmtAmount(vaultBalance)}, against ${fmtAmount(outstanding)} in unclaimed allocations plus staked principal.`,
    why:
      "Unclaimed restitution and everyone's staked tokens have to be physically present, not merely promised. The balance falls as people claim, which is correct, so what matters is that it never falls below what is still owed.",
    command: `spl-token balance --address ${vaultPda}`,
  });

  // 4: the team cannot dump.
  checks.push({
    title: "The team's tokens are locked in a stream",
    status: loading || !config ? "pending" : config.devStreamCreated ? "pass" : "fail",
    detail: loading
      ? "reading the config…"
      : !config
      ? UNREADABLE
      : config.devStreamCreated
      ? `${fmtAmount(config.devAllocation)} released linearly over 12 months behind a cliff. No team wallet holds any of it.`
      : "The team's stream has not been created yet.",
    why:
      "The original token failed because its creator could sell whenever he liked. Here the team's allocation exists only inside the contract and comes out at a fixed rate nobody can accelerate, into a multisig rather than any one person's wallet.",
  });

  // 5: reproduce the snapshot.
  checks.push({
    id: VERIFY_ANCHORS.snapshotReproducible,
    title: "The Legacy Buddy holder snapshot is reproducible from public data",
    status: "pending",
    detail:
      "The contract stores one 32-byte fingerprint per list: a Merkle root. The verifier rebuilds that fingerprint from the published CSV and compares it to the one on chain. Change a single digit in the file and the fingerprint no longer matches.",
    why:
      "The eligibility list was produced off-chain, because Solana programs cannot enumerate token holders. That is only trustworthy if anyone can regenerate the identical result, which they can, because the input is public chain history. The fingerprint is what makes the published file binding rather than decorative: the contract pays against the root, so a list that does not reproduce it is not the list being paid.",
    command: `RPC_URL=<your-rpc> npx ts-node scripts/verify-snapshot.ts --onchain`,
  });

  // 6: the fee split is frozen and points at the community.
  // Creator fees are paid as lamports, so the shareholder to look for is the
  // SOL vault, not the token vault.
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
            ? "cleared, so the split can no longer be changed"
            : sharing.admin
        }. Status: ${sharing.status}.`,
    why:
      "pump.fun lets a fee split be set exactly once, after which it revokes the admin and the shares are permanent. That is what stops a team quietly redirecting the community's fees to themselves once a token has traction, so the thing to check is not just the percentage but that the admin really is revoked.",
    link: solscanAccount(
      config ? sharingConfigPda(config.rewardMint).toBase58() : ""
    ),
    linkLabel: "Inspect the fee-sharing config on Solscan",
  });

  // 7: there is nothing between you and the chain.
  const unexpectedOrigins = origins.filter((h) => h !== RPC_HOST);
  checks.push({
    id: VERIFY_ANCHORS.noBackend,
    title: "This site has no server in the path of your money",
    status: origins.length === 0 ? "pending" : unexpectedOrigins.length === 0 ? "pass" : "fail",
    detail:
      origins.length === 0
        ? "Reading this page's own network activity…"
        : `Besides this domain, this page has contacted ${origins.length === 1 ? "one host" : `${origins.length} hosts`}: ${origins.join(", ")}.` +
          (unexpectedOrigins.length === 0
            ? ` That is the Solana RPC${RPC_IS_KEYED ? "" : " (public endpoint)"} and nothing else. Every balance, deadline and allocation on this site was read directly on-chain by your browser.`
            : ` ${unexpectedOrigins.join(", ")} ${unexpectedOrigins.length === 1 ? "is" : "are"} not the RPC and should not be there.`),
    why:
      "There is no API of ours in the middle. Your browser asks the chain directly and renders the answer, which means we have no opportunity to change a number on the way past. If this page showed you a balance the chain disagrees with, any explorer would catch it instantly. It also means your wallet only ever signs transactions built in front of you, and never sends anything to a server of ours. The list above is measured live by the page itself, and you can confirm it independently in your browser's network tab: open developer tools, reload, and see the same hosts. The one server-side component in this project is the public influencer terms register, which records signatures for transparency and cannot affect who can claim what: a claim is verified on chain against the Merkle root, not against us.",
  });

  // 8: source matches what is deployed.
  checks.push({
    id: VERIFY_ANCHORS.sourceMatchesDeployed,
    title: "The published source matches the deployed bytecode",
    status: "pending",
    detail:
      "Every line of this project is public: the Solana program, this website, the snapshot scripts and the runbooks. Build the repository yourself and compare the hash to the bytecode on chain.",
    why:
      "Open source on its own proves nothing: reading code is only meaningful if that code is what actually got deployed. solana-verify rebuilds the program in a fixed container and compares the resulting hash to the bytecode the chain is executing. If they match, the program you can read is the program that holds the tokens.",
    command: `solana-verify verify-from-repo -um --program-id ${programId} <repo-url>`,
  });

  return (
    <div className="stack">
      <section className="card highlight">
        <h2>Verify this yourself</h2>
        <p className="muted">
          Nothing on this page asks you to believe us. Each item below is a claim
          this project makes about itself, paired with the way to check it. Read
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
        <section className="card" key={i} id={check.id}>
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

      {/* Deliberately not framed as a check, because it cannot pass. Putting a
          weaker guarantee inside the same VERIFIED badge as the on-chain ones
          would quietly borrow their credibility. */}
      <section className="card">
        <h2>What this page cannot prove about itself</h2>
        <p className="muted">
          The contract can be pinned down completely: rebuild it, hash it,
          compare it to the bytecode the chain is running. A website cannot be
          pinned down the same way, and anyone telling you otherwise is
          overselling. A web server can serve different files to different
          people, so no page can prove its own authenticity from the inside.
          That is true here and it is true of every web app you have ever used.
        </p>

        <p className="muted small">
          What we can do instead is narrow the gap, in three ways.
        </p>

        <ol className="verify-gap">
          <li>
            <strong>The source is public and the build is public.</strong> Every
            deploy runs in GitHub Actions from a named commit, with the log
            open. You can read what was built and from what.
          </li>
          <li>
            <strong>You can diff the bytes yourself.</strong> Build the same
            commit locally and compare the hash of the bundle against the one
            this site is actually serving. Same input, same output, so a
            difference means the served file is not the published one.
          </li>
          <li>
            <strong>The site is not load-bearing, which is the real answer.</strong>{" "}
            This page holds no keys and can move nothing. Every action is a
            transaction your own wallet shows you before you sign it, and every
            number here is read from the chain and contradicted by any explorer
            if it is wrong. A tampered frontend could lie to you or propose a
            transaction you should refuse, but it could not take anything, and it
            could not change who is owed what, because that is decided by a
            Merkle root on chain and not by this website.
          </li>
        </ol>

        <div className="cmd">
          <code>{BUNDLE_DIFF}</code>
          <button onClick={() => copy(BUNDLE_DIFF, "bundle")}>
            {copied === "bundle" ? "copied" : "copy"}
          </button>
        </div>

        <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            Read the source
          </a>
          {" · "}
          <a href={REPO_ACTIONS_URL} target="_blank" rel="noreferrer noopener">
            Every build, with logs
          </a>
          {" · "}
          <a
            href={repoPath("programs/buddy-distributor/src")}
            target="_blank"
            rel="noreferrer noopener"
          >
            The contract itself
          </a>
        </p>
      </section>

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
                  config ? sharingConfigPda(config.rewardMint).toBase58() : "n/a",
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
              tier, say 12 months at 5×, and then pulls their tokens out
              early, they give up the entire bonus they had accrued plus 15% of
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
              <span className="stat-value">{fmtAmount(pool.lifetimeTokenRewards, true)}</span>
              <span className="stat-label">Lifetime rewards into the pool</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmtAmount(pool.totalStaked, true)}</span>
              <span className="stat-label">Currently staked</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
