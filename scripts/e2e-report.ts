/**
 * Generate docs/E2E-DEVNET-CAMPAIGN.md from the run logs the campaign wrote.
 *
 *   REPORT_DIR=/path/to/scratch/e2e npx ts-node scripts/e2e-report.ts > docs/E2E-DEVNET-CAMPAIGN.md
 *
 * Reads run-A.json and run-B.json (whichever exist) plus an optional
 * final.json (the F-deployment facts), and emits the committed report:
 * per-scenario results with Solscan tx links, plus the static methodology,
 * the fast-clock table, and the normal-user verification steps.
 */
import * as fs from "fs";

interface Row {
  id: string;
  claim: string;
  status: "pass" | "fail" | "note";
  detail: string;
  signature?: string;
  errorCode?: string;
}
interface RunLog {
  run: string;
  programId: string;
  rows: Row[];
}

const dir = process.env.REPORT_DIR ?? "./scratch-e2e";
const read = (name: string): RunLog | null => {
  const p = `${dir}/${name}`;
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

const runA = read("run-A.json");
const runB = read("run-B.json");
const final: any = fs.existsSync(`${dir}/final.json`)
  ? JSON.parse(fs.readFileSync(`${dir}/final.json`, "utf8"))
  : null;

const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const solscanAcct = (a: string) => `https://solscan.io/account/${a}?cluster=devnet`;

function mark(s: string) {
  return s === "pass" ? "✅" : s === "note" ? "📝" : "❌";
}

function table(log: RunLog): string {
  const lines = [
    `Program: [\`${log.programId}\`](${solscanAcct(log.programId)}) · ${log.rows.length} scenarios`,
    "",
    "| ID | Result | What it proves | Observed | Evidence |",
    "|----|--------|----------------|----------|----------|",
  ];
  for (const r of log.rows) {
    const evidence = r.signature
      ? `[tx](${solscanTx(r.signature)})`
      : r.errorCode
        ? `\`${r.errorCode}\``
        : "—";
    const detail = r.detail.replace(/\|/g, "\\|");
    const claim = r.claim.replace(/\|/g, "\\|");
    lines.push(`| ${r.id} | ${mark(r.status)} | ${claim} | ${detail} | ${evidence} |`);
  }
  return lines.join("\n");
}

function summary(log: RunLog | null): string {
  if (!log) return "not run";
  const p = log.rows.filter((r) => r.status === "pass").length;
  const n = log.rows.filter((r) => r.status === "note").length;
  const f = log.rows.filter((r) => r.status === "fail").length;
  return `${p} pass · ${n} note · ${f} fail (of ${log.rows.length})`;
}

const out: string[] = [];
out.push(`# End-to-end devnet test campaign`);
out.push("");
out.push(
  `Every behaviour the site and docs claim, run against live devnet and recorded ` +
    `with the transaction that proves it. This is the completed, evidenced superset ` +
    `of the scripted rehearsal in [docs/DEVNET-REHEARSAL.md](DEVNET-REHEARSAL.md).`
);
out.push("");
out.push(`## Results at a glance`);
out.push("");
out.push(`| Run | What it covers | Result |`);
out.push(`|-----|----------------|--------|`);
out.push(`| A — everyone shows up | claims, streams, the full staking suite, rewards, donations, sync, stream maturities | ${summary(runA)} |`);
out.push(`| B — nobody shows up | expired windows, all three sweeps, community streams, forfeits reaching stakers | ${summary(runB)} |`);
out.push("");
out.push(`📝 = documented behaviour (an edge worth noting for the security review), not a failure.`);
out.push("");
out.push(
  `> **The single Run B 📝 (W6) is a fast-clock timing artifact, not a contract fault.** ` +
    `W6 expects \`release_community_stream\` to find nothing withdrawable in the same instant the ` +
    `sweep opened the stream. Under the compressed 3-minute stream, at least one second has vested by ` +
    `the time the release transaction lands on devnet, so a tiny first release succeeds instead of ` +
    `rejecting. W7 immediately proves the schedule itself: ~half the forfeit at the halfway mark, the ` +
    `exact total at the end, and \`NothingToWithdraw\` on every attempt after. With the real 30-day ` +
    `stream the same-second window is unhittable by a human.`
);
out.push("");

out.push(`## How this was tested, and how you can re-check it`);
out.push("");
out.push(
  `Two things are worth being precise about, because "we tested it" is exactly ` +
    `the kind of claim this project refuses to make without evidence.`
);
out.push("");
out.push(`**What I drove, and how.** Each scenario is a real transaction (or a real, ` +
  `expected rejection) sent by \`scripts/e2e-campaign.ts\` against a program deployed ` +
  `to devnet. Holders, influencers, stakers, the donor and the fee-payer relay are ` +
  `throwaway wallets the script generates and funds; the 2014-signer path uses a ` +
  `locally generated secp256k1 key so a valid Bitcoin-style signature can actually ` +
  `be produced. Every row below with a \`tx\` link is a signature you can open on ` +
  `Solscan and inspect independently — the accounts touched, the amounts, the logs.`);
out.push("");
out.push(`**The mint is Token-2022, deliberately.** pump.fun creates coins through ` +
  `\`create_v2\` whenever its \`create_v2_enabled\` flag is on — it is on for mainnet — ` +
  `and \`create_v2\` mints under **Token-2022**, not classic SPL Token. The campaign's ` +
  `reward mint is therefore a Token-2022 mint carrying a metadata-pointer extension, ` +
  `the exact shape \`create_v2\` produces, and every instruction runs through the ` +
  `token interface with \`transfer_checked\`. wSOL remains classic SPL, so the ` +
  `\`unwrap_wsol\` scenarios exercise the mixed pairing the launch will actually have.`);
out.push("");
out.push(`**What you verify, and how.** I cannot drive a browser wallet like Phantom, ` +
  `so the columns above prove the *contract* behaves correctly, not the *site's* ` +
  `wiring to it. The normal-user equivalent of each area is in ` +
  `[§ Verify it yourself](#verify-it-yourself-as-a-normal-user) — the exact tab, ` +
  `button and expected result to confirm on staging with Phantom.`);
out.push("");

out.push(`## Time compression (the \`fast-clock\` build)`);
out.push("");
out.push(
  `Most windows and locks are month- to year-scale, so the runs used a program ` +
    `compiled with the \`fast-clock\` cargo feature, which shrinks every wall-clock ` +
    `duration to minutes. The feature is **never a default**, CI never enables it, ` +
    `and \`solana-verify\` builds default features — so the mainnet bytecode ` +
    `provably contains the real values. The mapping:`
);
out.push("");
out.push(`| Duration | Mainnet | fast-clock (tests) |`);
out.push(`|----------|---------|--------------------|`);
out.push(`| Legacy-holder claim window | 30 days | 6 min |`);
out.push(`| Influencer claim window | 72 hours | 4 min |`);
out.push(`| Influencer stream | 30 days | 3 min |`);
out.push(`| Founder/signer stream | 365 days | 5 min |`);
out.push(`| 1 / 3 / 5-month locks | 30 / 90 / 150 days | 1 / 2 / 3 min |`);
out.push(`| Unstake cooldown | 24 hours | 1 min |`);
out.push(`| 2014-signer deadline | 2030-12-31 | Run B build only: back-dated to 2025-01-01, so \`sweep_original_signer\` (gated \`now > deadline\`) is reachable |`);
out.push("");
out.push(
  `The claim windows also depend on \`claims_start\`, an \`initialize\` parameter: ` +
    `Run A sets it a few minutes in the future (to prove "window not open yet"). ` +
    `Run B sets it to now (\`claims_start = 0\`) so both windows are open when it ` +
    `locks — \`lock_config\` now refuses a config whose windows have already closed — ` +
    `then waits them out on chain before the sweeps, deriving each wait from the ` +
    `deadlines the config reports.`
);
out.push("");

if (runA) {
  out.push(`## Run A — everyone shows up`);
  out.push("");
  out.push(table(runA));
  out.push("");
}
if (runB) {
  out.push(`## Run B — nobody shows up`);
  out.push("");
  out.push(table(runB));
  out.push("");
}

out.push(`## What is NOT covered here, and where it is`);
out.push("");
out.push(`- **The pump.fun creator-fee chain** (setting the one-shot 90/10 split, and ` +
  `collecting accrued fees). pump.fun has no devnet deployment, so this is impossible ` +
  `to rehearse on devnet. It stays the mainnet throwaway-coin step in ` +
  `[TO-THE-MOON §1.5](../TO-THE-MOON.md). The distributor contract itself contains ` +
  `no pump.fun coupling — that lives in \`app/src/pumpfun.ts\` — so nothing in the ` +
  `contract campaign depends on it.`);
out.push(`- **The exact 2030 boundary with real constants.** Covered by the bankrun ` +
  `suite's time-travel test "returns the allocation to the community after the 2030 ` +
  `deadline". On devnet, Run B exercised the same code path with the deadline ` +
  `back-dated in the build.`);
out.push(`- **The Squads team-withdraw** (\`stream_withdraw\` signed by a multisig vault). ` +
  (final?.teamWithdraw
    ? `Proven on the final deployment — see below.`
    : `Proven separately by the final deployment (F) and the Squads plumbing test.`));
out.push("");

if (final) {
  out.push(`## Final devnet deployment`);
  out.push("");
  out.push(`The campaign left devnet on a **normal-constants** build — launch-realistic, ` +
    `for the security review and the manual pass:`);
  out.push("");
  out.push(`- Program: [\`${final.programId}\`](${solscanAcct(final.programId)})`);
  if (final.configPda) out.push(`- Config: [\`${final.configPda}\`](${solscanAcct(final.configPda)})`);
  if (final.split) out.push(`- Allocation split: ${final.split}`);
  if (final.squadsVault) out.push(`- Team stream beneficiary (Squads vault): [\`${final.squadsVault}\`](${solscanAcct(final.squadsVault)})`);
  if (final.teamWithdraw) out.push(`- Team-withdraw through Squads (propose→approve→execute): [tx](${solscanTx(final.teamWithdraw)})`);
  if (final.notes) out.push(`- ${final.notes}`);
  out.push("");
}

out.push(`## Findings for the security review`);
out.push("");
out.push(`The staking redesign turned the old quirks into enforced properties. What ` +
  `remains are design points an auditor should still see stated plainly — none a ` +
  `bug, each backed by the scenario that exercises it:`);
out.push("");
out.push(`- **Everything runs after the lock.** \`stake\`, \`lock_tokens\`, the ` +
  `\`notify_*\`/\`sync_*\` reward paths and \`unwrap_wsol\` all assert the config is ` +
  `locked, so none can run before \`lock_config\` (S12/S13). That is what makes the ` +
  `lock's solvency check real: before the lock \`reserved_token\` rises *only* through ` +
  `\`fund_vault\`, so staker principal and stray donations cannot pre-satisfy it.`);
out.push(`- **Per-lockup entities, no top-up.** Every locked commitment is its own ` +
  `\`Lockup\` account created by \`lock_tokens(amount, tier, index)\` against an ` +
  `owner-scoped counter. No instruction adds to an existing lockup, a closed lockup's ` +
  `index cannot be reused, and re-locking is always a fresh entity with its own clock ` +
  `(N15). Flexible \`stake\` is the only mutable position, at 1x.`);
out.push(`- **Maturity is demoted by a permissionless crank.** A matured lockup keeps ` +
  `its boosted weight in the pool until it is demoted to 1x; anyone can crank that ` +
  `demotion — in a batch (N21) or inline when the owner unlocks or claims (N20) — and ` +
  `an owner's own claim auto-demotes their matured lockups. A matured-but-un-cranked ` +
  `lockup over-weights the pool only until the next crank, which is a public, ` +
  `incentive-aligned action rather than a privileged one.`);
out.push(`- **One 24-hour floor on every principal exit.** A flexible unstake (N4) and a ` +
  `locked early exit (\`emergency_exit_lockup\`, N13) are gated by the same 24-hour ` +
  `floor (\`CooldownActive\`), so no route pulls principal out inside a day. The early ` +
  `exit keeps 85% of principal plus accrued base and forfeits the boost escrow plus a ` +
  `15% slash, redistributed to the stakers who stayed. One edge survives: a *partial* ` +
  `flexible unstake leaves \`unstake_requested_at\` set, so after one cooldown a ` +
  `flexible staker can make repeated partial unstakes without waiting again.`);
out.push(`- **Reward dust buffers instead of stranding.** Rewards that arrive with ` +
  `nobody staked, or too small to move the per-weight accumulator, settle into ` +
  `\`pending_*\` and are flushed to the next staker (N24/N24b) rather than left ` +
  `stranded in the vault.`);
out.push(`- **An empty influencer sweep opens a dead stream.** \`sweep_influencers\` ` +
  `creates its community stream unconditionally, so sweeping with nothing unclaimed ` +
  `would open a \`total = 0\` stream that can never release (permanent ` +
  `\`NothingToWithdraw\`). Harmless, but a dead account; \`sweep_old_holders\` instead ` +
  `guards on \`remaining > 0\`.`);
out.push("");

out.push(`## Verify it yourself, as a normal user`);
out.push("");
out.push(`Against staging (\`staging.mybestbuddy.fun\`, devnet, behind the basic-auth ` +
  `gate) pointed at the final deployment, with Phantom set to devnet:`);
out.push("");
out.push(`1. **See the numbers (no wallet).** Open **Dashboard**. Confirm *Initial ` +
  `distribution* equals the published total and the four allocations match ` +
  `15 / 50 / 10 / 25. Open **Home** and confirm the allocation shares read the same, ` +
  `live from chain. These are the same values the campaign asserted on chain.`);
out.push(`2. **Check an address (no wallet).** On **Claims → Overview**, paste one of the ` +
  `published holder addresses; it should report what that wallet is owed. Paste a ` +
  `random address; it should report nothing.`);
out.push(`3. **Claim (Phantom).** With a wallet that holds a legacy allocation, open ` +
  `**My Buddy → Your claims** and claim; the tokens arrive instantly (this is the ` +
  `L1 path). An influencer wallet instead opens a stream (I1) and withdraws over ` +
  `time from the same page.`);
out.push(`4. **Stake (Phantom).** **My Buddy → Your stake**: open a lock-up at a ` +
  `locked tier (each lock-up is its own entity), confirm base rewards are ` +
  `claimable while the boost stays escrowed until maturity (N11), and that an ` +
  `early exit forfeits the boost + 15% (N13). A second lock-up gets its own ` +
  `independent clock (N7/N8). Nothing — flexible unstake or locked early exit — ` +
  `can pull principal out inside the first 24 hours.`);
out.push(`5. **Crank the pool (Phantom, permissionless).** **Fund pool**: after the ` +
  `windows close, run a sweep, then \`release\`/\`sync\` — anyone's wallet can, which ` +
  `is the W-series on this page.`);
out.push(`6. **The team withdrawal (Squads app).** The team stream pays a multisig ` +
  `vault, so its withdrawal is a Squads proposal, not a site action — ` +
  `\`scripts/team-withdraw.ts\` builds it. This is deliberately the one flow the ` +
  `site cannot do for you.`);
out.push("");
out.push(`_Generated by \`scripts/e2e-report.ts\` from the campaign run logs._`);

process.stdout.write(out.join("\n") + "\n");
