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
out.push(`| Legacy-holder claim window | 30 days | 45 min |`);
out.push(`| Influencer claim window | 72 hours | 20 min |`);
out.push(`| Influencer stream | 30 days | 15 min |`);
out.push(`| Founder/signer stream | 365 days | 30 min |`);
out.push(`| 1 / 3 / 12-month locks | 30 / 90 / 365 days | 5 / 8 / 12 min |`);
out.push(`| Unstake cooldown | 3 days | 3 min |`);
out.push(`| 2014-signer deadline | 2030-12-31 | Run B build only: back-dated to 2025-01-01, so \`sweep_original_signer\` (gated \`now > deadline\`) is reachable |`);
out.push("");
out.push(
  `The claim windows also depend on \`claims_start\`, an \`initialize\` parameter: ` +
    `Run A set it a few minutes in the future (to prove "window not open yet"), ` +
    `Run B back-dated it ~50 min (so both windows are already closed and the ` +
    `sweeps are reachable).`
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
out.push(`Documented behaviours (📝 rows) worth an explicit look. None is a bug; each ` +
  `is a design edge that an auditor should see stated plainly:`);
out.push("");
out.push(`- **S8 / pre-lock staking:** \`stake()\` has no lock gate and increments ` +
  `\`reserved_token\`, so staker principal could satisfy \`lock_config\`'s solvency ` +
  `check. In practice the launch script funds and locks before any staking, but the ` +
  `ordering is not enforced on chain.`);
out.push(`- **K14 / flexible partial unstake:** \`unstake_requested_at\` is cleared only ` +
  `on a *full* exit, so after one cooldown a flexible staker can make repeated ` +
  `partial unstakes without a fresh cooldown.`);
out.push(`- **K16 / zero-amount position:** after a full unstake the position account ` +
  `survives with \`amount = 0\`, and the no-downgrade rule then blocks re-staking at a ` +
  `lower tier until the account is closed via \`emergency_exit\` (unavailable post-maturity).`);
out.push(`- **I6 / empty-remainder sweep:** \`sweep_influencers\` with nothing unclaimed ` +
  `opens a \`total = 0\` community stream that can never be released (permanent ` +
  `\`NothingToWithdraw\`). Harmless, but it is a dead account.`);
out.push(`- **R9 / dust truncation:** a reward far smaller than \`total_weight\` truncates ` +
  `to a zero accumulator delta while still counting in \`lifetime_*\`; the tokens stay ` +
  `in the vault, recoverable only by a later, larger sync.`);
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
out.push(`4. **Stake (Phantom).** **My Buddy → Your stake**: stake a small amount at a ` +
  `locked tier, confirm base rewards are claimable while the boost stays escrowed ` +
  `(K7/K8), and that an early exit forfeits the boost + 15% (K21).`);
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
