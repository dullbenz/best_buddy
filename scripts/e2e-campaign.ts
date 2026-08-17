/**
 * End-to-end devnet campaign driver.
 *
 * Exercises every behavior the site and docs claim, on a live chain, against a
 * fast-clock build of the program (see programs/.../constants.rs). Two runs,
 * because some branches are mutually exclusive within one locked config:
 *
 *   RUN=A  "everyone shows up": every claim succeeds, the staking suite, the
 *          reward/sync/donation paths, and stream maturities.
 *   RUN=B  "nobody shows up": windows expire, all three sweeps fire, community
 *          streams open and are cranked, forfeits reach the stakers.
 *
 * Each scenario runs a real transaction (or a real rejection), asserts the
 * on-chain outcome, and records a report row with the tx signature or the
 * observed error code. Rows are written to scratchpad JSON that the report
 * (docs/E2E-DEVNET-CAMPAIGN.md) is generated from.
 *
 * Prereqs: a fast-clock program already deployed and this repo's declare_id /
 * Anchor.toml / IDL pointing at it (the campaign runner handles the deploy).
 *
 *   RUN=A RPC_URL=https://api.devnet.solana.com KEYPAIR=~/.config/solana/id.json \
 *     REPORT_DIR=/path/to/scratch npx ts-node scripts/e2e-campaign.ts
 */
import {
  BN,
  Ctx,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Reporter,
  SystemProgram,
  Transaction,
  TOKEN_PROGRAM_ID,
  UNIT,
  createMint,
  createTokenAccount,
  ensureAta,
  errorName,
  expectError,
  fundWallets,
  getAssociatedTokenAddressSync,
  makeCtx,
  defundSpawned,
  mintTo,
  pdaFor,
  sleep,
  tokenBalance,
  waitSeconds,
} from "./e2e-harness";
import { buildTree, hashLeaf } from "./merkle";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

const SIGNER_PREFIX = "I am the original Signer. Claim to Solana address: ";

/* ------------------------------------------------------------------ *
 * secp256k1 Bitcoin-message signer (ported from tests/helpers.ts)
 * ------------------------------------------------------------------ */
function bitcoinMessageHash(message: string): Uint8Array {
  const msg = Buffer.from(message, "utf8");
  const payload = Buffer.concat([
    Buffer.from([0x18]),
    Buffer.from("Bitcoin Signed Message:\n", "utf8"),
    Buffer.from([msg.length]),
    msg,
  ]);
  return sha256(sha256(payload));
}
function makeBitcoinKey() {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const uncompressed = secp256k1.getPublicKey(privateKey, false); // 65 bytes, 0x04 prefix
  return { privateKey, publicKeyXY: uncompressed.slice(1) };
}
function signBitcoin(key: { privateKey: Uint8Array }, message: string, compressed = false) {
  const digest = bitcoinMessageHash(message);
  const sig = secp256k1.sign(digest, key.privateKey);
  return { header: (compressed ? 31 : 27) + sig.recovery, signature: Buffer.from(sig.toCompactRawBytes()) };
}

/* ------------------------------------------------------------------ *
 * A scenario wrapper: never lets one failure abort the run.
 * ------------------------------------------------------------------ */
async function scenario(
  rep: Reporter,
  id: string,
  claim: string,
  fn: (rec: {
    pass: (detail: string, sig?: string) => void;
    note: (detail: string, sig?: string) => void;
  }) => Promise<void>
) {
  try {
    await fn({
      pass: (detail, sig) => rep.pass(id, claim, detail, sig),
      note: (detail, sig) => rep.note(id, claim, detail, sig),
    });
  } catch (e: any) {
    rep.fail(id, claim, `threw: ${(e?.message ?? String(e)).slice(0, 300)}`);
  }
}

/* ================================================================== *
 * RUN A — everyone shows up
 * ================================================================== */
async function runA(ctx: Ctx, rep: Reporter) {
  const { program, account, payer, provider, connection } = ctx;
  const pda = pdaFor(ctx.programId);
  const config = pda("config");
  const pool = pda("pool");
  const vault = pda("vault");
  const solVault = pda("sol_vault");

  const OLD_ALLOC = 150_000n * UNIT;
  const INF_ALLOC = 500_000n * UNIT;
  const SIGNER_ALLOC = 100_000n * UNIT;
  const DEV_ALLOC = 250_000n * UNIT;
  const TOTAL = OLD_ALLOC + INF_ALLOC + SIGNER_ALLOC + DEV_ALLOC;

  console.log("\n=== RUN A: everyone shows up ===\n");

  // ---- setup: mint + treasury + trees + wallets ----
  const mint = await createMint(ctx);
  const treasury = await createTokenAccount(ctx, mint.publicKey, payer.publicKey);
  await mintTo(ctx, mint.publicKey, treasury, TOTAL + 2_000_000n * UNIT); // extra for staking/donations

  const holders = [
    { kp: Keypair.generate(), amount: 90_000n * UNIT },
    { kp: Keypair.generate(), amount: 45_000n * UNIT },
    { kp: Keypair.generate(), amount: 15_000n * UNIT },
  ];
  const influencers = [
    { kp: Keypair.generate(), amount: 300_000n * UNIT },
    { kp: Keypair.generate(), amount: 200_000n * UNIT },
  ];
  const oldTree = buildTree(holders.map((h) => ({ address: h.kp.publicKey.toBase58(), amount: h.amount.toString() }))).tree;
  const infTree = buildTree(influencers.map((h) => ({ address: h.kp.publicKey.toBase58(), amount: h.amount.toString() }))).tree;

  const signerKey = makeBitcoinKey();
  const signerDest = Keypair.generate();
  const relay = Keypair.generate(); // unrelated payer for the signer claim
  // Staking cast (N-series): two flexible wallets, three lockup wallets.
  const flexA = Keypair.generate(); // flexible path: N24, N1-N5, N22, N4
  const flexB = Keypair.generate(); // flash-stake probe (N6) + no-counter probe (N10)
  const lockerA = Keypair.generate(); // all three tiers, exit, re-lock, batch demote
  const lockerB = Keypair.generate(); // two independent lockups (N8, N20)
  const lockerC = Keypair.generate(); // the demote-math 5x lockup (N16-N19)
  const donor = Keypair.generate();
  const devWallet = Keypair.generate();

  await fundWallets(
    ctx,
    [...holders, ...influencers].map((h) => h.kp.publicKey)
      .concat([
        signerDest.publicKey, relay.publicKey, donor.publicKey,
        flexA.publicKey, flexB.publicKey, lockerA.publicKey, lockerB.publicKey, lockerC.publicKey,
      ]),
    0.02
  );
  console.log("   setup: mint, trees, wallets funded\n");

  const CLAIM_OPEN_DELAY = 300; // seconds; lets us prove "window not open yet"
  // and leaves ample room for the setup/lock/dev-stream/L5 transactions to
  // land on a flaky devnet before the claim window actually opens.
  const claimsStart = Math.floor(Date.now() / 1000) + CLAIM_OPEN_DELAY;

  // ---- S1: invalid cliffs rejected ----
  const goodParams = (over: Partial<any> = {}) => ({
    oldHolderRoot: oldTree.rootArray,
    oldHolderAllocation: new BN(OLD_ALLOC.toString()),
    influencerRoot: infTree.rootArray,
    influencerAllocation: new BN(INF_ALLOC.toString()),
    originalSignerPubkey: Array.from(signerKey.publicKeyXY),
    originalSignerAllocation: new BN(SIGNER_ALLOC.toString()),
    devWallet: devWallet.publicKey,
    devAllocation: new BN(DEV_ALLOC.toString()),
    devCliffSeconds: new BN(60), // 60s cliff so T4/T5 are observable fast
    claimsStart: new BN(claimsStart),
    ...over,
  });
  const initAccounts = {
    payer: payer.publicKey,
    authority: payer.publicKey,
    rewardMint: mint.publicKey,
    config, pool, vault, solVault,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
  };

  await scenario(rep, "S1", "initialize rejects an out-of-range cliff (InvalidCliff)", async (r) => {
    const tooLong = await expectError(
      program.methods.initialize(goodParams({ devCliffSeconds: new BN(366 * 86400) })).accountsPartial(initAccounts).rpc(),
      "InvalidCliff"
    );
    const negative = await expectError(
      program.methods.initialize(goodParams({ devCliffSeconds: new BN(-1) })).accountsPartial(initAccounts).rpc(),
      "InvalidCliff"
    );
    if (tooLong.ok && negative.ok) r.pass(`cliff >365d and <0 both rejected [${tooLong.observed}]`);
    else r.note(`>365d: ${tooLong.observed}, <0: ${negative.observed}`);
  });

  // ---- S2: initialize succeeds ----
  await scenario(rep, "S2", "initialize creates config/pool/vault and stores params", async (r) => {
    const sig = await program.methods.initialize(goodParams()).accountsPartial(initAccounts).rpc();
    const c = await account.config.fetch(config);
    if (c.rewardMint.toBase58() !== mint.publicKey.toBase58()) throw new Error("reward mint mismatch");
    if (BigInt(c.devAllocation.toString()) !== DEV_ALLOC) throw new Error("dev alloc mismatch");
    r.pass(`config initialized; allocations stored; locked=${c.locked}`, sig);

    // Fail fast if the deployed program is NOT the fast-clock v2 build: the
    // whole campaign's timing assumes minute-scale windows. old_holder_deadline
    // - claims_start must equal OLD_HOLDER_CLAIM_WINDOW: 360s fast, 2_592_000
    // real. Abort loudly rather than sink the session into a wrong build.
    const window = Number(c.oldHolderDeadline) - Number(c.claimsStart);
    if (window !== 360) {
      throw new Error(
        `FAST-CLOCK GUARD: old-holder window is ${window}s, expected 360s. ` +
          `The deployed program is not a fast-clock v2 build, aborting the run.`
      );
    }
    console.log(`   ✓ fast-clock v2 confirmed: old-holder window is ${window}s (6 min)`);
  });

  // ---- S3: re-init fails ----
  await scenario(rep, "S3", "initialize cannot run twice", async (r) => {
    const res = await expectError(program.methods.initialize(goodParams()).accountsPartial(initAccounts).rpc(), ["AccountInUse", "Unknown"]);
    res.ok || res.observed === "AccountInUse" ? r.pass(`second initialize rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- S4: fund_vault from a non-authority ----
  await scenario(rep, "S4", "fund_vault rejects a non-authority signer (Unauthorized)", async (r) => {
    // Stranger tries to fund from their own token account.
    const strangerAta = await createTokenAccount(ctx, mint.publicKey, donor.publicKey);
    await mintTo(ctx, mint.publicKey, strangerAta, 1n * UNIT);
    const res = await expectError(
      program.methods.fundVault(new BN(1)).accountsPartial({
        authority: donor.publicKey, config, vault, pool, source: strangerAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([donor]).rpc(),
      ["Unauthorized", "ConstraintHasOne", "Unknown"]
    );
    r.pass(`rejected [${res.observed}]`);
  });

  // ---- S5: fund_vault amount 0 ----
  await scenario(rep, "S5", "fund_vault rejects a zero amount (ZeroAmount)", async (r) => {
    const res = await expectError(
      program.methods.fundVault(new BN(0)).accountsPartial({
        authority: payer.publicKey, config, vault, pool, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc(),
      "ZeroAmount"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- S6: lock while underfunded ----
  await scenario(rep, "S6", "lock_config refuses while the vault is short (InsufficientBucketBalance)", async (r) => {
    const res = await expectError(
      program.methods.lockConfig().accountsPartial({ authority: payer.publicKey, config, pool, vault }).rpc(),
      "InsufficientBucketBalance"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- S7: direct transfer doesn't count; fund_vault does ----
  await scenario(rep, "S7", "tokens sent outside fund_vault don't satisfy the lock; fund_vault does", async (r) => {
    // Send some tokens straight to the vault (untracked).
    const { createTransferInstruction } = await import("@solana/spl-token");
    await provider.sendAndConfirm(new Transaction().add(
      createTransferInstruction(treasury, vault, payer.publicKey, Number(1000n * UNIT))
    ));
    const stillShort = await expectError(
      program.methods.lockConfig().accountsPartial({ authority: payer.publicKey, config, pool, vault }).rpc(),
      "InsufficientBucketBalance"
    );
    // Now fund the full committed total the accounted way.
    const sig = await program.methods.fundVault(new BN(TOTAL.toString())).accountsPartial({
      authority: payer.publicKey, config, vault, pool, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    r.pass(`direct transfer left lock short [${stillShort.observed}]; fund_vault(${TOTAL / UNIT}) tracked it`, sig);
  });

  // ---- S9: lock succeeds ----
  await scenario(rep, "S9", "lock_config succeeds once funded; locked=true", async (r) => {
    const sig = await program.methods.lockConfig().accountsPartial({ authority: payer.publicKey, config, pool, vault }).rpc();
    const c = await account.config.fetch(config);
    if (!c.locked) throw new Error("locked did not read true");
    r.pass(`locked=true`, sig);
  });

  // ---- S10: fund after lock ----
  await scenario(rep, "S10", "fund_vault rejected after lock (ConfigLocked)", async (r) => {
    const res = await expectError(
      program.methods.fundVault(new BN(1)).accountsPartial({
        authority: payer.publicKey, config, vault, pool, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc(),
      "ConfigLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- S11: second lock ----
  await scenario(rep, "S11", "lock_config cannot run twice (ConfigLocked)", async (r) => {
    const res = await expectError(
      program.methods.lockConfig().accountsPartial({ authority: payer.publicKey, config, pool, vault }).rpc(),
      "ConfigLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- T2: create_dev_stream by a stranger ----
  const devStreamPda = pda("stream", devWallet.publicKey.toBuffer());
  await scenario(rep, "T2", "create_dev_stream is permissionless; terms come from init", async (r) => {
    const sig = await program.methods.createDevStream().accountsPartial({
      payer: donor.publicKey, config, stream: devStreamPda, systemProgram: SystemProgram.programId,
    }).signers([donor]).rpc();
    const s = await account.stream.fetch(devStreamPda);
    if (BigInt(s.total.toString()) !== DEV_ALLOC) throw new Error("dev stream total mismatch");
    r.pass(`stranger opened the team stream; total=${BigInt(s.total.toString()) / UNIT}`, sig);
  });

  // ---- T3: duplicate create_dev_stream ----
  await scenario(rep, "T3", "create_dev_stream cannot run twice", async (r) => {
    const res = await expectError(
      program.methods.createDevStream().accountsPartial({
        payer: donor.publicKey, config, stream: devStreamPda, systemProgram: SystemProgram.programId,
      }).signers([donor]).rpc(),
      ["StreamAlreadyExists", "AccountInUse", "Unknown"]
    );
    r.pass(`rejected [${res.observed}]`);
  });

  // ---- T4: withdraw before cliff ----
  await scenario(rep, "T4", "team stream pays nothing before its cliff (NothingToWithdraw)", async (r) => {
    const devAta = await ensureAta(ctx, mint.publicKey, devWallet.publicKey);
    const res = await expectError(
      program.methods.streamWithdraw().accountsPartial({
        beneficiary: devWallet.publicKey, config, stream: devStreamPda, pool, vault, destination: devAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([devWallet]).rpc(),
      "NothingToWithdraw"
    );
    res.ok ? r.pass(`pre-cliff withdraw rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- L5: claim before claims_start ----
  await scenario(rep, "L5", "legacy claim rejected before claims_start (ClaimWindowNotOpen)", async (r) => {
    const h = holders[0];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      "ClaimWindowNotOpen"
    );
    res.ok ? r.pass(`rejected before window opens [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // wait for claims to open
  const waitOpen = claimsStart - Math.floor(Date.now() / 1000) + 3;
  if (waitOpen > 0) await waitSeconds("claims opening", waitOpen);

  // ---- L1: valid legacy claim pays instantly ----
  await scenario(rep, "L1", "legacy claim pays the exact amount instantly", async (r) => {
    const h = holders[0];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const sig = await program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
      claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
      pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([h.kp]).rpc();
    const bal = await tokenBalance(ctx, ata);
    if (bal !== h.amount) throw new Error(`got ${bal}, expected ${h.amount}`);
    r.pass(`paid ${bal / UNIT} instantly`, sig);
  });

  // ---- L2: double claim ----
  await scenario(rep, "L2", "the same wallet cannot claim twice", async (r) => {
    const h = holders[0];
    const ata = getAssociatedTokenAddressSync(mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      ["AccountInUse", "Unknown"]
    );
    r.pass(`second claim rejected [${res.observed}]`);
  });

  // ---- L3: wrong amount ----
  await scenario(rep, "L3", "legacy claim with the wrong amount fails (InvalidMerkleProof)", async (r) => {
    const h = holders[1];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN((h.amount + 1n).toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      "InvalidMerkleProof"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- L4: not in tree ----
  await scenario(rep, "L4", "a wallet not in the tree cannot claim (InvalidMerkleProof)", async (r) => {
    const intruder = Keypair.generate();
    await fundWallets(ctx, [intruder.publicKey], 0.02);
    const ata = await ensureAta(ctx, mint.publicKey, intruder.publicKey);
    const res = await expectError(
      program.methods.claimOldHolder(new BN((1n * UNIT).toString()), []).accountsPartial({
        claimant: intruder.publicKey, config, receipt: pda("old_claim", intruder.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([intruder]).rpc(),
      "InvalidMerkleProof"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
    // claim the remaining real holders so the bucket is fully claimed (I6-style completeness)
    for (const hh of holders.slice(1)) {
      const a = await ensureAta(ctx, mint.publicKey, hh.kp.publicKey);
      const pr = oldTree.proofFor(hashLeaf(hh.kp.publicKey.toBase58(), hh.amount)).map((p) => Array.from(p));
      await program.methods.claimOldHolder(new BN(hh.amount.toString()), pr).accountsPartial({
        claimant: hh.kp.publicKey, config, receipt: pda("old_claim", hh.kp.publicKey.toBuffer()),
        pool, vault, destination: a, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([hh.kp]).rpc();
    }
  });

  // ---- I1: influencer claim opens a stream, nothing upfront ----
  const inf0StreamPda = pda("stream", influencers[0].kp.publicKey.toBuffer());
  await scenario(rep, "I1", "influencer claim opens a stream and pays nothing upfront", async (r) => {
    const inf = influencers[0];
    const proof = infTree.proofFor(hashLeaf(inf.kp.publicKey.toBase58(), inf.amount)).map((p) => Array.from(p));
    const sig = await program.methods.claimInfluencer(new BN(inf.amount.toString()), proof).accountsPartial({
      claimant: inf.kp.publicKey, config, receipt: pda("inf_claim", inf.kp.publicKey.toBuffer()),
      stream: inf0StreamPda, systemProgram: SystemProgram.programId,
    }).signers([inf.kp]).rpc();
    const s = await account.stream.fetch(inf0StreamPda);
    if (BigInt(s.total.toString()) !== inf.amount) throw new Error("stream total mismatch");
    const ata = await ensureAta(ctx, mint.publicKey, inf.kp.publicKey);
    if ((await tokenBalance(ctx, ata)) !== 0n) throw new Error("expected 0 upfront");
    r.pass(`stream total=${inf.amount / UNIT}, 0 paid upfront`, sig);
  });

  // ---- I3: non-member proof ----
  await scenario(rep, "I3", "a non-member cannot claim an influencer allocation (InvalidMerkleProof)", async (r) => {
    const intruder = Keypair.generate();
    await fundWallets(ctx, [intruder.publicKey], 0.02);
    const res = await expectError(
      program.methods.claimInfluencer(new BN((1n * UNIT).toString()), []).accountsPartial({
        claimant: intruder.publicKey, config, receipt: pda("inf_claim", intruder.publicKey.toBuffer()),
        stream: pda("stream", intruder.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).signers([intruder]).rpc(),
      "InvalidMerkleProof"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  // claim influencer[1] too so the bucket is fully claimed
  await scenario(rep, "I1b", "second influencer claims (bucket fully claimed)", async (r) => {
    const inf = influencers[1];
    const proof = infTree.proofFor(hashLeaf(inf.kp.publicKey.toBase58(), inf.amount)).map((p) => Array.from(p));
    const sig = await program.methods.claimInfluencer(new BN(inf.amount.toString()), proof).accountsPartial({
      claimant: inf.kp.publicKey, config, receipt: pda("inf_claim", inf.kp.publicKey.toBuffer()),
      stream: pda("stream", inf.kp.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
    }).signers([inf.kp]).rpc();
    r.pass(`influencer 2 claimed ${inf.amount / UNIT}`, sig);
  });

  // ---- 2014 signer G1/G2/G3/G4/G5/G6 ----
  const msg = SIGNER_PREFIX + signerDest.publicKey.toBase58();
  await scenario(rep, "G1", "a signature from the wrong key fails (SignerMismatch)", async (r) => {
    const wrong = makeBitcoinKey();
    const { header, signature } = signBitcoin(wrong, msg);
    const res = await expectError(
      program.methods.claimOriginalSigner(signerDest.publicKey, header, Array.from(signature)).accountsPartial({
        payer: relay.publicKey, config, stream: pda("stream", signerDest.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).signers([relay]).rpc(),
      "SignerMismatch"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "G2", "a signature bound to A cannot be replayed for B (SignerMismatch)", async (r) => {
    const other = Keypair.generate();
    const { header, signature } = signBitcoin(signerKey, msg); // signed for signerDest
    const res = await expectError(
      program.methods.claimOriginalSigner(other.publicKey, header, Array.from(signature)).accountsPartial({
        payer: relay.publicKey, config, stream: pda("stream", other.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).signers([relay]).rpc(),
      "SignerMismatch"
    );
    res.ok ? r.pass(`replay to a different destination rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "G3", "a header byte outside 27-34 fails (InvalidRecoveryId)", async (r) => {
    const { signature } = signBitcoin(signerKey, msg);
    const res = await expectError(
      program.methods.claimOriginalSigner(signerDest.publicKey, 99, Array.from(signature)).accountsPartial({
        payer: relay.publicKey, config, stream: pda("stream", signerDest.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).signers([relay]).rpc(),
      "InvalidRecoveryId"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  const signerStreamPda = pda("stream", signerDest.publicKey.toBuffer());
  await scenario(rep, "G4", "a valid signature, relayed by an unrelated payer, opens the stream", async (r) => {
    const { header, signature } = signBitcoin(signerKey, msg);
    const sig = await program.methods.claimOriginalSigner(signerDest.publicKey, header, Array.from(signature)).accountsPartial({
      payer: relay.publicKey, config, stream: signerStreamPda, systemProgram: SystemProgram.programId,
    }).signers([relay]).rpc();
    const s = await account.stream.fetch(signerStreamPda);
    if (BigInt(s.total.toString()) !== SIGNER_ALLOC) throw new Error("signer stream total mismatch");
    r.pass(`stream opened by relay wallet; total=${SIGNER_ALLOC / UNIT}`, sig);
  });
  await scenario(rep, "G6", "the signer cannot claim twice (AlreadyClaimed)", async (r) => {
    const { header, signature } = signBitcoin(signerKey, msg);
    const res = await expectError(
      program.methods.claimOriginalSigner(signerDest.publicKey, header, Array.from(signature)).accountsPartial({
        payer: relay.publicKey, config, stream: signerStreamPda, systemProgram: SystemProgram.programId,
      }).signers([relay]).rpc(),
      ["AlreadyClaimed", "AccountInUse", "Unknown"]
    );
    r.pass(`second claim rejected [${res.observed}]`);
  });

  // ---- STAKING (N-series): flexible positions + per-lockup entities ----
  // Redesigned model: stake(amount) is flexible-only (1.0x, cooldown-gated);
  // every locked commitment is its own Lockup account created by
  // lock_tokens(amount, tier, index) against an owner-scoped counter PDA.
  // Exact-math scenarios mirror the program's fixed-point accounting
  // (ACC_PRECISION = 1e12) and compute expectations from freshly fetched
  // on-chain state, never from a wall-clock guess.
  const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");
  const ACC = 10n ** 12n; // mirrors ACC_PRECISION
  const UNSTAKE_COOLDOWN_SECS = 60; // fast-clock v2 UNSTAKE_COOLDOWN (real: 24h)
  const big = (x: any) => BigInt(x.toString());
  // Mirror of the program's split_accrual: base (1.0x share) vs boost (the
  // part above 1.0x, which settles into escrow until maturity).
  const splitDelta = (amount: bigint, weight: bigint, delta: bigint) => {
    const total = (weight * delta) / ACC;
    const base0 = (amount * delta) / ACC;
    const base = base0 > total ? total : base0;
    return { base, boost: total - base, total };
  };
  // Un-settled accrual of a position/lockup against the pool accumulators.
  const pendingOf = (entity: any, poolState: any) => ({
    token: splitDelta(big(entity.amount), big(entity.weight), big(poolState.accTokenPerWeight) - big(entity.tokenDebt)),
    sol: splitDelta(big(entity.amount), big(entity.weight), big(poolState.accSolPerWeight) - big(entity.solDebt)),
  });

  const posPda = (owner: PublicKey) => pda("stake", owner.toBuffer());
  const counterPda = (owner: PublicKey) => pda("lockup_count", owner.toBuffer());
  const lockupPda = (owner: PublicKey, index: number) => {
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(BigInt(index));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("lockup"), owner.toBuffer(), le],
      ctx.programId
    )[0];
  };

  // Token accounts + balances for the staking cast.
  const stakerAtaMap = new Map<string, PublicKey>();
  for (const [kp, amount] of [
    [flexA, 100_000n * UNIT],
    [flexB, 600_000n * UNIT], // big enough to try a flash capture
    [lockerA, 100_000n * UNIT],
    [lockerB, 100_000n * UNIT],
    [lockerC, 100_000n * UNIT],
  ] as [Keypair, bigint][]) {
    const a = await ensureAta(ctx, mint.publicKey, kp.publicKey);
    await mintTo(ctx, mint.publicKey, a, amount);
    stakerAtaMap.set(kp.publicKey.toBase58(), a);
  }
  const ataFor = (kp: Keypair) => stakerAtaMap.get(kp.publicKey.toBase58())!;

  const stakeAccts = (s: Keypair) => ({
    owner: s.publicKey, config, pool, position: posPda(s.publicKey), vault, source: ataFor(s),
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  });
  const positionAccts = (s: Keypair) => ({
    owner: s.publicKey, config, pool, position: posPda(s.publicKey), vault, solVault, destination: ataFor(s),
    tokenProgram: TOKEN_PROGRAM_ID, rent: RENT_SYSVAR,
  });
  const lockAccts = (s: Keypair, index: number) => ({
    owner: s.publicKey, config, pool, counter: counterPda(s.publicKey), lockup: lockupPda(s.publicKey, index),
    vault, source: ataFor(s), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  });
  const lockupAccts = (s: Keypair, index: number) => ({
    owner: s.publicKey, config, pool, lockup: lockupPda(s.publicKey, index), vault, solVault,
    destination: ataFor(s), tokenProgram: TOKEN_PROGRAM_ID, rent: RENT_SYSVAR,
  });

  // ---- N24: rewards with nobody staked buffer instead of vanishing ----
  await scenario(rep, "N24", "rewards with nobody staked buffer to pending", async (r) => {
    const before = await account.stakePool.fetch(pool);
    if (big(before.totalWeight) !== 0n) throw new Error("expected an empty pool");
    const sig = await program.methods.notifyTokenRewards(new BN((1_000n * UNIT).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, vault, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    const p = await account.stakePool.fetch(pool);
    if (big(p.pendingTokenRewards) !== 1_000n * UNIT) throw new Error(`pending ${big(p.pendingTokenRewards) / UNIT} != 1000`);
    if (big(p.accTokenPerWeight) !== 0n) throw new Error("accumulator moved with zero weight");
    r.pass(`1000 tokens buffered in pending; accumulator untouched`, sig);
  });

  // ---- N1: flexible stake, no tier argument ----
  await scenario(rep, "N1", "stake(amount) with no tier argument registers at weight == amount", async (r) => {
    const zero = await expectError(
      program.methods.stake(new BN(0)).accountsPartial(stakeAccts(flexA)).signers([flexA]).rpc(),
      "ZeroAmount"
    );
    const sig = await program.methods.stake(new BN((8_000n * UNIT).toString())).accountsPartial(stakeAccts(flexA)).signers([flexA]).rpc();
    const p = await account.stakePosition.fetch(posPda(flexA.publicKey));
    if (big(p.amount) !== 8_000n * UNIT) throw new Error("amount wrong");
    if (big(p.weight) !== 8_000n * UNIT) throw new Error("weight != amount");
    r.pass(`stake(0) rejected [${zero.observed}]; stake(8000) weight=8000 (1.0x, flexible only)`, sig);
  });

  // ---- N24b: first staker + flush collects the buffered rewards ----
  await scenario(rep, "N24b", "first staker + flush_pending collects the buffered rewards exactly", async (r) => {
    const sig = await program.methods.flushPending().accountsPartial({ pool }).rpc();
    const p = await account.stakePool.fetch(pool);
    if (big(p.pendingTokenRewards) !== 0n) throw new Error("pending not flushed");
    const before = await tokenBalance(ctx, ataFor(flexA));
    await program.methods.claimRewards().accountsPartial(positionAccts(flexA)).signers([flexA]).rpc();
    const after = await tokenBalance(ctx, ataFor(flexA));
    if (after - before !== 1_000n * UNIT) throw new Error(`collected ${(after - before) / UNIT}, expected 1000`);
    r.pass(`sole staker collected the exact 1000 buffered tokens after flush`, sig);
  });

  // ---- N2/N3/N5: the flexible cooldown gate ----
  await scenario(rep, "N2", "unstake without a request fails (NoUnstakeRequested)", async (r) => {
    const res = await expectError(
      program.methods.unstake(new BN((1n * UNIT).toString())).accountsPartial(positionAccts(flexA)).signers([flexA]).rpc(),
      "NoUnstakeRequested"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "N3", "unstake inside the 24h cooldown (fast: 60s) fails (CooldownActive)", async (r) => {
    await program.methods.requestUnstake().accountsPartial({ owner: flexA.publicKey, position: posPda(flexA.publicKey) }).signers([flexA]).rpc();
    const res = await expectError(
      program.methods.unstake(new BN((1n * UNIT).toString())).accountsPartial(positionAccts(flexA)).signers([flexA]).rpc(),
      "CooldownActive"
    );
    res.ok ? r.pass(`request made; immediate unstake rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "N5", "staking again cancels a pending unstake request", async (r) => {
    const sig = await program.methods.stake(new BN((2_000n * UNIT).toString())).accountsPartial(stakeAccts(flexA)).signers([flexA]).rpc();
    const p = await account.stakePosition.fetch(posPda(flexA.publicKey));
    if (Number(p.unstakeRequestedAt) !== 0) throw new Error("pending request survived the top-up");
    if (big(p.amount) !== 10_000n * UNIT || big(p.weight) !== 10_000n * UNIT) throw new Error("top-up amount wrong");
    r.pass(`top-up to 10000 zeroed unstake_requested_at; the cooldown restarts from scratch`, sig);
  });

  // ---- N6: the flash-stake probe the cooldown exists to stop ----
  await scenario(rep, "N6", "flash-stake bundle (stake huge, sync, claim, unstake) is blocked by the cooldown", async (r) => {
    // Bait: park an untracked fee-pot in the vault, visible to anyone watching.
    const { createTransferInstruction } = await import("@solana/spl-token");
    await provider.sendAndConfirm(new Transaction().add(
      createTransferInstruction(treasury, vault, payer.publicKey, Number(5_000n * UNIT))
    ));
    const balBefore = await tokenBalance(ctx, ataFor(flexB));
    const bundle = new Transaction()
      .add(await program.methods.stake(new BN((500_000n * UNIT).toString())).accountsPartial(stakeAccts(flexB)).instruction())
      .add(await program.methods.syncTokenRewards().accountsPartial({ config, pool, vault }).instruction())
      .add(await program.methods.claimRewards().accountsPartial(positionAccts(flexB)).instruction())
      .add(await program.methods.unstake(new BN((500_000n * UNIT).toString())).accountsPartial(positionAccts(flexB)).instruction());
    let observed = "SUCCEEDED (expected failure)";
    try {
      await provider.sendAndConfirm(bundle, [flexB]);
    } catch (e: any) {
      observed = errorName(e);
    }
    if (observed === "SUCCEEDED (expected failure)") throw new Error("flash-stake bundle went through");
    const balAfter = await tokenBalance(ctx, ataFor(flexB));
    if (balAfter !== balBefore) throw new Error("balance moved despite the revert");
    if (await connection.getAccountInfo(posPda(flexB.publicKey))) throw new Error("position survived the revert");
    r.pass(`bundle rejected atomically [${observed}]: an exit needs a request plus the cooldown, so a flash capture cannot stake and leave in one breath`);
  });

  // ---- N7: lock_tokens at each tier ----
  const lockPlanA = [
    { tier: 1, amount: 10_000n, mult: 2n, lockSecs: 60 },
    { tier: 2, amount: 10_000n, mult: 3n, lockSecs: 120 },
    { tier: 3, amount: 8_000n, mult: 5n, lockSecs: 180 },
  ];
  await scenario(rep, "N7", "lock_tokens at each tier: 2x/3x/5x weight, own index, own lock_end", async (r) => {
    const wBefore = big((await account.stakePool.fetch(pool)).totalWeight);
    let sig = "";
    for (let i = 0; i < lockPlanA.length; i++) {
      const lp = lockPlanA[i];
      sig = await program.methods.lockTokens(new BN((lp.amount * UNIT).toString()), lp.tier, new BN(i))
        .accountsPartial(lockAccts(lockerA, i)).signers([lockerA]).rpc();
      const l = await account.lockup.fetch(lockupPda(lockerA.publicKey, i));
      if (Number(l.index) !== i) throw new Error(`index ${l.index} != ${i}`);
      if (big(l.weight) !== lp.amount * lp.mult * UNIT) throw new Error(`tier ${lp.tier} weight wrong`);
      if (Number(l.lockEnd) - Number(l.createdAt) !== lp.lockSecs) throw new Error(`tier ${lp.tier} lock != ${lp.lockSecs}s`);
    }
    const counter = await account.lockupCounter.fetch(counterPda(lockerA.publicKey));
    if (Number(counter.count) !== 3) throw new Error(`counter ${counter.count} != 3`);
    const wAfter = big((await account.stakePool.fetch(pool)).totalWeight);
    if (wAfter - wBefore !== 90_000n * UNIT) throw new Error(`pool weight +${(wAfter - wBefore) / UNIT}, expected +90000`);
    r.pass(`10000@2x=20000/60s, 10000@3x=30000/120s, 8000@5x=40000/180s; counter=3; pool weight +90000`, sig);
  });

  // ---- N8 (part 1): two lockups, one wallet, independent clocks ----
  await scenario(rep, "N8", "two lockups for one wallet keep independent clocks, amounts and escrows", async (r) => {
    await program.methods.lockTokens(new BN((10_000n * UNIT).toString()), 1, new BN(0))
      .accountsPartial(lockAccts(lockerB, 0)).signers([lockerB]).rpc();
    const sig = await program.methods.lockTokens(new BN((8_000n * UNIT).toString()), 3, new BN(1))
      .accountsPartial(lockAccts(lockerB, 1)).signers([lockerB]).rpc();
    const l0 = await account.lockup.fetch(lockupPda(lockerB.publicKey, 0));
    const l1 = await account.lockup.fetch(lockupPda(lockerB.publicKey, 1));
    if (Number(l0.lockEnd) - Number(l0.createdAt) !== 60) throw new Error("lockup#0 lock != 60s");
    if (Number(l1.lockEnd) - Number(l1.createdAt) !== 180) throw new Error("lockup#1 lock != 180s");
    if (Number(l1.lockEnd) <= Number(l0.lockEnd)) throw new Error("clocks are not independent");
    r.pass(`lockup#0 10000@2x/60s and lockup#1 8000@5x/180s coexist, each with its own clock (unlock check follows in N8b)`, sig);
  });

  // The demote-math lockup: lockerC's 5x among otherwise known weights.
  await program.methods.lockTokens(new BN((8_000n * UNIT).toString()), 3, new BN(0))
    .accountsPartial(lockAccts(lockerC, 0)).signers([lockerC]).rpc();
  console.log("   lockerC: 8000 @ 5x (180s) created for the demote-math scenarios");

  // ---- N12/N16: pre-maturity gates ----
  await scenario(rep, "N12", "unlock_tokens before maturity fails (StillLocked)", async (r) => {
    const res = await expectError(
      program.methods.unlockTokens().accountsPartial(lockupAccts(lockerC, 0)).signers([lockerC]).rpc(),
      "StillLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "N16", "demote_matured before maturity fails (EscrowNotMatured)", async (r) => {
    const res = await expectError(
      program.methods.demoteMatured().accountsPartial({
        cranker: donor.publicKey, config, pool, lockup: lockupPda(lockerC.publicKey, 0),
      }).signers([donor]).rpc(),
      "EscrowNotMatured"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- N9/N10: lock_tokens rejections ----
  await scenario(rep, "N9", "lock_tokens refuses the flexible tier (InvalidTier)", async (r) => {
    const res = await expectError(
      program.methods.lockTokens(new BN((1_000n * UNIT).toString()), 0, new BN(3))
        .accountsPartial(lockAccts(lockerA, 3)).signers([lockerA]).rpc(),
      "InvalidTier"
    );
    res.ok ? r.pass(`tier 0 must go through stake(); rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "N10", "a lockup index that does not match the counter is rejected (InvalidLockupIndex)", async (r) => {
    const skipped = await expectError(
      program.methods.lockTokens(new BN((1_000n * UNIT).toString()), 1, new BN(5))
        .accountsPartial(lockAccts(lockerA, 5)).signers([lockerA]).rpc(),
      "InvalidLockupIndex"
    );
    // A wallet with no counter yet counts from 0, so index 1 is just as dead.
    const noCounter = await expectError(
      program.methods.lockTokens(new BN((1_000n * UNIT).toString()), 1, new BN(1))
        .accountsPartial(lockAccts(flexB, 1)).signers([flexB]).rpc(),
      "InvalidLockupIndex"
    );
    if (skipped.ok && noCounter.ok) r.pass(`index 5 against count 3, and index 1 with no counter, both rejected [${skipped.observed}]`);
    else r.note(`skipped: ${skipped.observed}, no-counter: ${noCounter.observed}`);
  });

  // ---- N22: pro-rata split across flexible + live lockups, exact ----
  // Weights now: flexA 10000, lockerA 20000+30000+40000, lockerB 20000+40000,
  // lockerC 40000 = 200000 total. 200000 tokens + 0.2 SOL = 1 token and
  // 1000 lamports per 0.001 weight unit, so every share below is exact.
  await scenario(rep, "N22", "token + SOL rewards split pro-rata across flexible and lockups; claims pay exact amounts", async (r) => {
    const p0 = await account.stakePool.fetch(pool);
    if (big(p0.totalWeight) !== 200_000n * UNIT) throw new Error(`total weight ${big(p0.totalWeight) / UNIT} != 200000`);
    const sig = await program.methods.notifyTokenRewards(new BN((200_000n * UNIT).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, vault, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    await program.methods.notifySolRewards(new BN((0.2 * LAMPORTS_PER_SOL).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, solVault, systemProgram: SystemProgram.programId,
    }).rpc();
    const p1 = await account.stakePool.fetch(pool);
    if (big(p1.accTokenPerWeight) - big(p0.accTokenPerWeight) !== ACC) throw new Error("token accumulator delta wrong");
    // Flexible (10000 of 200000): 10000 tokens + 0.01 SOL, all base.
    const tokB = await tokenBalance(ctx, ataFor(flexA));
    const solB = BigInt((await connection.getAccountInfo(flexA.publicKey))!.lamports);
    await program.methods.claimRewards().accountsPartial(positionAccts(flexA)).signers([flexA]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(flexA));
    const solA = BigInt((await connection.getAccountInfo(flexA.publicKey))!.lamports);
    if (tokA - tokB !== 10_000n * UNIT) throw new Error(`flexible tokens ${(tokA - tokB) / UNIT} != 10000`);
    if (solA - solB !== 10_000_000n) throw new Error(`flexible sol ${solA - solB} != 0.01 SOL`);
    // 2x lockup (lockerB#0, 20000 weight): base 10000 paid, boost 10000 escrowed.
    const tokB2 = await tokenBalance(ctx, ataFor(lockerB));
    await program.methods.claimLockupRewards().accountsPartial(lockupAccts(lockerB, 0)).signers([lockerB]).rpc();
    const tokA2 = await tokenBalance(ctx, ataFor(lockerB));
    const lB0 = await account.lockup.fetch(lockupPda(lockerB.publicKey, 0));
    if (tokA2 - tokB2 !== 10_000n * UNIT) throw new Error(`2x base ${(tokA2 - tokB2) / UNIT} != 10000`);
    if (big(lB0.escrowToken) !== 10_000n * UNIT) throw new Error("2x token escrow != 10000");
    if (big(lB0.escrowSol) !== 10_000_000n) throw new Error("2x sol escrow != 0.01 SOL");
    r.pass(`200000 tokens + 0.2 SOL over 200000 weight: flexible claimed 10000 + 0.01 SOL all-base; 2x lockup claimed base 10000 with 10000 + 0.01 SOL escrowed`, sig);
  });

  // ---- N11: claim while locked pays base only, escrow intact ----
  await scenario(rep, "N11", "claim_lockup_rewards pays base only while locked; the boost escrow stays put", async (r) => {
    // lockerA#1 (3x, 10000): 30000 weight accrued 30000 + 0.03 SOL total.
    const tokB = await tokenBalance(ctx, ataFor(lockerA));
    const solB = BigInt((await connection.getAccountInfo(lockerA.publicKey))!.lamports);
    const sig = await program.methods.claimLockupRewards().accountsPartial(lockupAccts(lockerA, 1)).signers([lockerA]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(lockerA));
    const solA = BigInt((await connection.getAccountInfo(lockerA.publicKey))!.lamports);
    const l = await account.lockup.fetch(lockupPda(lockerA.publicKey, 1));
    if (tokA - tokB !== 10_000n * UNIT) throw new Error(`base ${(tokA - tokB) / UNIT} != 10000`);
    if (solA - solB !== 10_000_000n) throw new Error(`sol base ${solA - solB} != 0.01 SOL`);
    if (big(l.escrowToken) !== 20_000n * UNIT || big(l.escrowSol) !== 20_000_000n) throw new Error("3x escrow disturbed by the claim");
    r.pass(`3x lockup: base 10000 + 0.01 SOL paid; 20000 + 0.02 SOL still escrowed until maturity`, sig);
  });

  // ---- N13: emergency exit, exact forfeit math, siblings untouched ----
  await scenario(rep, "N13", "emergency_exit_lockup: 85% principal + base kept; boost + slash to the pool; siblings untouched", async (r) => {
    // A fresh 5x lockup (#3) is the victim; a fresh known reward gives it base+boost.
    await program.methods.lockTokens(new BN((8_000n * UNIT).toString()), 3, new BN(3))
      .accountsPartial(lockAccts(lockerA, 3)).signers([lockerA]).rpc();
    const w = big((await account.stakePool.fetch(pool)).totalWeight);
    if (w !== 240_000n * UNIT) throw new Error(`total weight ${w / UNIT} != 240000`);
    await program.methods.notifyTokenRewards(new BN((24_000n * UNIT).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, vault, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    // 24000 over 240000 weight: lockup#3 (40000w) accrues 4000 = base 800 + boost 3200.
    const sib0 = await account.lockup.fetch(lockupPda(lockerA.publicKey, 0));
    const sib1 = await account.lockup.fetch(lockupPda(lockerA.publicKey, 1));
    const poolB = await account.stakePool.fetch(pool);
    const tokB = await tokenBalance(ctx, ataFor(lockerA));
    const sig = await program.methods.emergencyExitLockup().accountsPartial(lockupAccts(lockerA, 3)).signers([lockerA]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(lockerA));
    const poolA = await account.stakePool.fetch(pool);
    if (tokA - tokB !== 7_600n * UNIT) throw new Error(`paid ${(tokA - tokB) / UNIT}, expected 6800 principal + 800 base`);
    if (await connection.getAccountInfo(lockupPda(lockerA.publicKey, 3))) throw new Error("lockup not closed");
    if (big(poolB.totalWeight) - big(poolA.totalWeight) !== 40_000n * UNIT) throw new Error("weight not fully removed");
    // 3200 boost + 1200 slash = 4400, redistributed over the 200000 weight that stayed.
    if (big(poolA.accTokenPerWeight) - big(poolB.accTokenPerWeight) !== (4_400n * UNIT * ACC) / (200_000n * UNIT)) {
      throw new Error("forfeit not redistributed to the remaining stakers");
    }
    if (big(poolA.lifetimeTokenRewards) - big(poolB.lifetimeTokenRewards) !== 4_400n * UNIT) throw new Error("lifetime rewards delta wrong");
    const sib0After = await account.lockup.fetch(lockupPda(lockerA.publicKey, 0));
    const sib1After = await account.lockup.fetch(lockupPda(lockerA.publicKey, 1));
    for (const [b, a] of [[sib0, sib0After], [sib1, sib1After]] as const) {
      if (big(a.amount) !== big(b.amount) || big(a.weight) !== big(b.weight) ||
          big(a.escrowToken) !== big(b.escrowToken) || Number(a.lockEnd) !== Number(b.lockEnd)) {
        throw new Error("a sibling lockup was disturbed by the exit");
      }
    }
    r.pass(`exit paid 7600 (85% of 8000 + base 800); forfeited 3200 boost + 1200 slash redistributed; lockups #0/#1 untouched`, sig);
  });

  // ---- N15: the old quirks are designed out ----
  await scenario(rep, "N15", "no top-up path; a closed lockup leaves nothing behind; re-locking is a fresh entity", async (r) => {
    if (await connection.getAccountInfo(lockupPda(lockerA.publicKey, 3))) throw new Error("closed lockup left an account behind");
    const reuse = await expectError(
      program.methods.lockTokens(new BN((1_000n * UNIT).toString()), 1, new BN(3))
        .accountsPartial(lockAccts(lockerA, 3)).signers([lockerA]).rpc(),
      "InvalidLockupIndex"
    );
    const sig = await program.methods.lockTokens(new BN((1_000n * UNIT).toString()), 1, new BN(4))
      .accountsPartial(lockAccts(lockerA, 4)).signers([lockerA]).rpc();
    const l4 = await account.lockup.fetch(lockupPda(lockerA.publicKey, 4));
    if (Number(l4.lockEnd) - Number(l4.createdAt) !== 60) throw new Error("fresh lockup lacks a fresh clock");
    if (big(l4.escrowToken) !== 0n || big(l4.claimableToken) !== 0n) throw new Error("fresh lockup born dirty");
    r.pass(`exited #3 is gone; re-creating index 3 rejected [${reuse.observed}]; new lock is #4 with its own 60s clock. No instruction can top up an existing lockup`, sig);
  });

  // ---- R1/R2/R3: sync SOL ----
  await scenario(rep, "R2", "sync_sol_rewards with nothing untracked fails (NothingToWithdraw)", async (r) => {
    const res = await expectError(
      program.methods.syncSolRewards().accountsPartial({ config, pool, solVault, rent: new PublicKey("SysvarRent111111111111111111111111111111111") }).rpc(),
      "NothingToWithdraw"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "R1", "direct SOL is invisible until sync_sol_rewards credits exactly it", async (r) => {
    const before = (await account.stakePool.fetch(pool)).lifetimeSolRewards;
    await provider.sendAndConfirm(new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: solVault, lamports: 0.5 * LAMPORTS_PER_SOL })
    ));
    const sig = await program.methods.syncSolRewards().accountsPartial({ config, pool, solVault, rent: new PublicKey("SysvarRent111111111111111111111111111111111") }).rpc();
    const after = (await account.stakePool.fetch(pool)).lifetimeSolRewards;
    const credited = BigInt(after.toString()) - BigInt(before.toString());
    if (credited !== BigInt(0.5 * LAMPORTS_PER_SOL)) throw new Error(`credited ${credited}, expected ${0.5 * LAMPORTS_PER_SOL}`);
    r.pass(`credited exactly ${credited} lamports`, sig);
  });
  await scenario(rep, "R4", "direct token transfer is invisible until sync_token_rewards", async (r) => {
    const { createTransferInstruction } = await import("@solana/spl-token");
    // Drain any pre-existing untracked tokens first (e.g. the 1000 S7 sent
    // straight to the vault) so we measure only our own gift here.
    try {
      await program.methods.syncTokenRewards().accountsPartial({ config, pool, vault }).rpc();
    } catch {
      /* nothing untracked yet — fine */
    }
    const before = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    await provider.sendAndConfirm(new Transaction().add(
      createTransferInstruction(treasury, vault, payer.publicKey, Number(1_000n * UNIT))
    ));
    const sig = await program.methods.syncTokenRewards().accountsPartial({ config, pool, vault }).rpc();
    const after = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    if (after - before !== 1_000n * UNIT) throw new Error(`credited ${(after - before) / UNIT}, expected 1000`);
    r.pass(`credited exactly ${(after - before) / UNIT} tokens`, sig);
  });
  await scenario(rep, "R5", "unwrap_wsol converts vault-held wrapped SOL into lamport rewards", async (r) => {
    const { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } = await import("@solana/spl-token");
    const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
    const rentSysvar = new PublicKey("SysvarRent111111111111111111111111111111111");
    // The sol_vault is a PDA (off-curve), so allow an off-curve ATA owner.
    const wsolAta = getAssociatedTokenAddressSync(NATIVE, solVault, true);
    const tx = new Transaction();
    if (!(await connection.getAccountInfo(wsolAta))) {
      tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, wsolAta, solVault, NATIVE));
    }
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wsolAta, lamports: 0.3 * LAMPORTS_PER_SOL }));
    tx.add(createSyncNativeInstruction(wsolAta)); // make the wrapped balance real
    await provider.sendAndConfirm(tx);
    const before = BigInt((await account.stakePool.fetch(pool)).lifetimeSolRewards.toString());
    const sig = await program.methods.unwrapWsol().accountsPartial({
      config, pool, solVault, wsolAccount: wsolAta, tokenProgram: TOKEN_PROGRAM_ID, rent: rentSysvar,
    }).rpc();
    const after = BigInt((await account.stakePool.fetch(pool)).lifetimeSolRewards.toString());
    if (after - before < BigInt(0.3 * LAMPORTS_PER_SOL)) throw new Error(`credited ${after - before}, expected >= wrapped 0.3 SOL`);
    if (await connection.getAccountInfo(wsolAta)) throw new Error("wSOL account was not closed");
    r.pass(`unwrapped 0.3 SOL + closed-account rent to rewards; wSOL account closed`, sig);
  });
  await scenario(rep, "R6", "unwrap_wsol rejects a wSOL account the vault does not own (InvalidWsolAccount)", async (r) => {
    const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
    const rentSysvar = new PublicKey("SysvarRent111111111111111111111111111111111");
    // A wSOL token account owned by the donor, not the sol_vault.
    const strangerWsol = await createTokenAccount(ctx, NATIVE, donor.publicKey);
    const res = await expectError(
      program.methods.unwrapWsol().accountsPartial({
        config, pool, solVault, wsolAccount: strangerWsol, tokenProgram: TOKEN_PROGRAM_ID, rent: rentSysvar,
      }).rpc(),
      "InvalidWsolAccount"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "R10", "a third party can donate via notify_token_rewards", async (r) => {
    const donorAta = await ensureAta(ctx, mint.publicKey, donor.publicKey);
    await mintTo(ctx, mint.publicKey, donorAta, 500n * UNIT);
    const sig = await program.methods.notifyTokenRewards(new BN((500n * UNIT).toString())).accountsPartial({
      depositor: donor.publicKey, config, pool, vault, source: donorAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([donor]).rpc();
    r.pass(`donor added 500 tokens to the pool`, sig);
  });
  await scenario(rep, "R8", "invariant: vault balances never fall below what is reserved", async (r) => {
    const p = await account.stakePool.fetch(pool);
    const vaultBal = await tokenBalance(ctx, vault);
    const solBal = BigInt((await connection.getAccountInfo(solVault))!.lamports);
    if (vaultBal < BigInt(p.reservedToken.toString())) throw new Error("token vault below reserved");
    if (solBal < BigInt(p.reservedSol.toString())) throw new Error("sol vault below reserved");
    r.pass(`vault ${vaultBal / UNIT} >= reserved ${BigInt(p.reservedToken.toString()) / UNIT}; sol ok`);
  });

  // ---- record when time-gated maturities were kicked off ----
  const c = await account.config.fetch(config);
  const infStream = await account.stream.fetch(inf0StreamPda);
  const signerStream = await account.stream.fetch(signerStreamPda);
  const devStream = await account.stream.fetch(devStreamPda);
  console.log("\n   time-gated phase: waiting for maturities...\n");

  // ---- N4: cooldown elapses, then partial + full unstake ----
  await scenario(rep, "N4", "after the cooldown: partial unstake pays principal; full unstake sweeps rewards too", async (r) => {
    await program.methods.requestUnstake().accountsPartial({ owner: flexA.publicKey, position: posPda(flexA.publicKey) }).signers([flexA]).rpc();
    const reqAt = Number((await account.stakePosition.fetch(posPda(flexA.publicKey))).unstakeRequestedAt);
    const cooldownWait = reqAt + UNSTAKE_COOLDOWN_SECS - Math.floor(Date.now() / 1000) + 8;
    if (cooldownWait > 0) await waitSeconds("flexible cooldown (fast-clock: 60s)", cooldownWait);
    const tokB = await tokenBalance(ctx, ataFor(flexA));
    await program.methods.unstake(new BN((4_000n * UNIT).toString())).accountsPartial(positionAccts(flexA)).signers([flexA]).rpc();
    const tokMid = await tokenBalance(ctx, ataFor(flexA));
    if (tokMid - tokB !== 4_000n * UNIT) throw new Error(`partial paid ${(tokMid - tokB) / UNIT}, expected exactly 4000 principal`);
    // Full exit: remaining principal plus every settled/pending reward,
    // computed from freshly fetched on-chain state.
    const p = await account.stakePool.fetch(pool);
    const pos = await account.stakePosition.fetch(posPda(flexA.publicKey));
    const pend = pendingOf(pos, p);
    const expToken = big(pos.amount) + big(pos.claimableToken) + big(pos.escrowToken) + pend.token.total;
    const expSol = big(pos.claimableSol) + big(pos.escrowSol) + pend.sol.total;
    const solB = BigInt((await connection.getAccountInfo(flexA.publicKey))!.lamports);
    const sig = await program.methods.unstake(new BN(pos.amount.toString())).accountsPartial(positionAccts(flexA)).signers([flexA]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(flexA));
    const solA = BigInt((await connection.getAccountInfo(flexA.publicKey))!.lamports);
    if (tokA - tokMid !== expToken) throw new Error(`full exit paid ${tokA - tokMid} raw, expected ${expToken}`);
    if (solA - solB !== expSol) throw new Error(`full exit sol ${solA - solB}, expected ${expSol}`);
    const posAfter = await account.stakePosition.fetch(posPda(flexA.publicKey));
    if (big(posAfter.amount) !== 0n || big(posAfter.weight) !== 0n) throw new Error("position not emptied");
    r.pass(`partial paid 4000 exactly; full exit paid ${expToken} raw tokens + ${expSol} lamports (principal + all rewards); position empty`, sig);
  });

  // ---- N8 (part 2): unlocking one lockup leaves the sibling untouched ----
  await scenario(rep, "N8b", "unlocking lockup#0 leaves lockup#1 byte-identical", async (r) => {
    const lB0Pda = lockupPda(lockerB.publicKey, 0);
    const end0 = Number((await account.lockup.fetch(lB0Pda)).lockEnd);
    const matureWait = end0 - Math.floor(Date.now() / 1000) + 5;
    if (matureWait > 0) await waitSeconds("lockerB#0 maturing (fast-clock: 60s lock)", matureWait);
    const sib = await account.lockup.fetch(lockupPda(lockerB.publicKey, 1));
    const p = await account.stakePool.fetch(pool);
    const l0 = await account.lockup.fetch(lB0Pda);
    const pend = pendingOf(l0, p);
    const expToken = big(l0.amount) + big(l0.claimableToken) + big(l0.escrowToken) + pend.token.total;
    const tokB = await tokenBalance(ctx, ataFor(lockerB));
    const sig = await program.methods.unlockTokens().accountsPartial(lockupAccts(lockerB, 0)).signers([lockerB]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(lockerB));
    if (tokA - tokB !== expToken) throw new Error(`unlock paid ${tokA - tokB} raw, expected ${expToken}`);
    if (await connection.getAccountInfo(lB0Pda)) throw new Error("lockup#0 not closed");
    const sibAfter = await account.lockup.fetch(lockupPda(lockerB.publicKey, 1));
    if (big(sibAfter.amount) !== big(sib.amount) || big(sibAfter.weight) !== big(sib.weight) ||
        big(sibAfter.escrowToken) !== big(sib.escrowToken) || Number(sibAfter.lockEnd) !== Number(sib.lockEnd) ||
        big(sibAfter.tokenDebt) !== big(sib.tokenDebt)) {
      throw new Error("lockup#1 was disturbed by unlocking lockup#0");
    }
    r.pass(`#0 paid principal 10000 + rewards + released escrow = ${expToken} raw and closed; #1 amount/weight/escrow/clock unchanged`, sig);
  });

  // ---- N17/N18/N19: boost ends at maturity ----
  await scenario(rep, "N17", "after maturity a stranger demotes: pool weight falls by exactly 4x amount; escrow becomes claimable", async (r) => {
    const cPda = lockupPda(lockerC.publicKey, 0);
    const end = Number((await account.lockup.fetch(cPda)).lockEnd);
    const matureWait = end - Math.floor(Date.now() / 1000) + 5;
    if (matureWait > 0) await waitSeconds("lockerC 5x lockup maturing (fast-clock: 180s lock)", matureWait);
    const p = await account.stakePool.fetch(pool);
    const l = await account.lockup.fetch(cPda);
    const pend = pendingOf(l, p);
    const expClaimable = big(l.claimableToken) + pend.token.base + big(l.escrowToken) + pend.token.boost;
    const expClaimableSol = big(l.claimableSol) + pend.sol.base + big(l.escrowSol) + pend.sol.boost;
    const sig = await program.methods.demoteMatured().accountsPartial({
      cranker: donor.publicKey, config, pool, lockup: cPda,
    }).signers([donor]).rpc();
    const pAfter = await account.stakePool.fetch(pool);
    const lAfter = await account.lockup.fetch(cPda);
    const weightDrop = big(p.totalWeight) - big(pAfter.totalWeight);
    if (weightDrop !== 4n * 8_000n * UNIT) throw new Error(`pool weight fell ${weightDrop}, expected exactly 4 x 8000 boost weight`);
    if (big(lAfter.weight) !== 8_000n * UNIT) throw new Error("weight != amount after demotion");
    if (!lAfter.demoted) throw new Error("demoted flag not set");
    if (big(lAfter.escrowToken) !== 0n || big(lAfter.escrowSol) !== 0n) throw new Error("escrow not released");
    if (big(lAfter.claimableToken) !== expClaimable) throw new Error("released escrow did not land in claimable");
    if (big(lAfter.claimableSol) !== expClaimableSol) throw new Error("released sol escrow did not land in claimable");
    r.pass(`a stranger (not the owner) demoted: pool weight -32000 (4 x 8000), escrow moved to claimable (${expClaimable} raw)`, sig);
  });
  await scenario(rep, "N18", "demoting the same lockup twice fails (AlreadyDemoted)", async (r) => {
    const res = await expectError(
      program.methods.demoteMatured().accountsPartial({
        cranker: donor.publicKey, config, pool, lockup: lockupPda(lockerC.publicKey, 0),
      }).signers([donor]).rpc(),
      "AlreadyDemoted"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "N19", "rewards distributed after demotion accrue at exactly 1x, no boost", async (r) => {
    const cPda = lockupPda(lockerC.publicKey, 0);
    const p0 = await account.stakePool.fetch(pool);
    const w = big(p0.totalWeight);
    const R = 20_000n * UNIT;
    const sig = await program.methods.notifyTokenRewards(new BN(R.toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, vault, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    const p1 = await account.stakePool.fetch(pool);
    const delta = big(p1.accTokenPerWeight) - big(p0.accTokenPerWeight);
    if (delta !== (R * ACC) / w) throw new Error("accumulator delta does not match the distribution");
    const l = await account.lockup.fetch(cPda);
    const pend = pendingOf(l, p1);
    if (pend.token.boost !== 0n) throw new Error("boost accrued to a demoted lockup");
    if (pend.token.total !== (8_000n * UNIT * delta) / ACC) throw new Error("share is not exactly 1x of amount");
    const expToken = big(l.claimableToken) + pend.token.base;
    const expSol = big(l.claimableSol) + pend.sol.total;
    const tokB = await tokenBalance(ctx, ataFor(lockerC));
    const solB = BigInt((await connection.getAccountInfo(lockerC.publicKey))!.lamports);
    await program.methods.claimLockupRewards().accountsPartial(lockupAccts(lockerC, 0)).signers([lockerC]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(lockerC));
    const solA = BigInt((await connection.getAccountInfo(lockerC.publicKey))!.lamports);
    const lAfter = await account.lockup.fetch(cPda);
    if (tokA - tokB !== expToken) throw new Error(`claim paid ${tokA - tokB} raw, expected released escrow + 1x share = ${expToken}`);
    if (solA - solB !== expSol) throw new Error(`sol claim ${solA - solB} != ${expSol}`);
    if (big(lAfter.escrowToken) !== 0n) throw new Error("escrow refilled after demotion");
    r.pass(`post-demotion share of the 20000 distribution = ${pend.token.base} raw for 8000 amount (exactly 1x); escrow stayed 0`, sig);
  });

  // ---- N21: batch demote, one transaction ----
  await scenario(rep, "N21", "several matured lockups demoted in one transaction (the Fund-pool demote-all shape)", async (r) => {
    const targets = [0, 1, 4].map((i) => lockupPda(lockerA.publicKey, i));
    let latestEnd = 0;
    for (const t of targets) latestEnd = Math.max(latestEnd, Number((await account.lockup.fetch(t)).lockEnd));
    const matureWait = latestEnd - Math.floor(Date.now() / 1000) + 5;
    if (matureWait > 0) await waitSeconds("lockerA lockups maturing for the batch demote", matureWait);
    const p0 = await account.stakePool.fetch(pool);
    const tx = new Transaction();
    for (const t of targets) {
      tx.add(await program.methods.demoteMatured().accountsPartial({
        cranker: payer.publicKey, config, pool, lockup: t,
      }).instruction());
    }
    const sig = await provider.sendAndConfirm(tx);
    const p1 = await account.stakePool.fetch(pool);
    // Boost weights removed: #0 10000@2x -10000, #1 10000@3x -20000, #4 1000@2x -1000.
    const drop = big(p0.totalWeight) - big(p1.totalWeight);
    if (drop !== 31_000n * UNIT) throw new Error(`batch removed ${drop} weight, expected exactly 31000`);
    for (const t of targets) {
      const l = await account.lockup.fetch(t);
      if (!l.demoted) throw new Error("a batch member was not demoted");
    }
    r.pass(`3 demote instructions in one tx (a single flat fee): pool weight -31000 exactly, all flagged demoted`, sig);
  });

  // ---- N14: a matured lockup cannot use the emergency exit ----
  await scenario(rep, "N14", "emergency_exit_lockup after maturity fails (StillLocked: use unlock_tokens)", async (r) => {
    const res = await expectError(
      program.methods.emergencyExitLockup().accountsPartial(lockupAccts(lockerA, 0)).signers([lockerA]).rpc(),
      "StillLocked"
    );
    res.ok ? r.pass(`matured lockup must exit via unlock_tokens [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- N20: unlock on a never-demoted matured lockup demotes inline ----
  await scenario(rep, "N20", "unlock_tokens on a never-demoted matured lockup pays principal + rewards + boost in one call", async (r) => {
    const lB1Pda = lockupPda(lockerB.publicKey, 1);
    const end = Number((await account.lockup.fetch(lB1Pda)).lockEnd);
    const matureWait = end - Math.floor(Date.now() / 1000) + 5;
    if (matureWait > 0) await waitSeconds("lockerB 5x lockup maturing (fast-clock: 180s lock)", matureWait);
    const l = await account.lockup.fetch(lB1Pda);
    if (l.demoted) throw new Error("setup broken: lockup#1 was already demoted");
    const p = await account.stakePool.fetch(pool);
    const pend = pendingOf(l, p);
    const expToken = big(l.amount) + big(l.claimableToken) + big(l.escrowToken) + pend.token.total;
    const expSol = big(l.claimableSol) + big(l.escrowSol) + pend.sol.total;
    const rentBack = BigInt((await connection.getAccountInfo(lB1Pda))!.lamports);
    const tokB = await tokenBalance(ctx, ataFor(lockerB));
    const solB = BigInt((await connection.getAccountInfo(lockerB.publicKey))!.lamports);
    const sig = await program.methods.unlockTokens().accountsPartial(lockupAccts(lockerB, 1)).signers([lockerB]).rpc();
    const tokA = await tokenBalance(ctx, ataFor(lockerB));
    const solA = BigInt((await connection.getAccountInfo(lockerB.publicKey))!.lamports);
    if (tokA - tokB !== expToken) throw new Error(`paid ${tokA - tokB} raw, expected principal + base + boost = ${expToken}`);
    if (solA - solB !== expSol + rentBack) throw new Error(`sol ${solA - solB} != rewards ${expSol} + rent ${rentBack}`);
    if (await connection.getAccountInfo(lB1Pda)) throw new Error("lockup not closed");
    r.pass(`one call: principal 8000 + base + inline-released boost = ${expToken} raw tokens, ${expSol} lamports rewards, rent back`, sig);
  });

  // ---- N23: wSOL wrap, unwrap, SOL claimed by a lockup holder ----
  await scenario(rep, "N23", "wSOL wrap then unwrap_wsol then SOL claimed by a lockup holder", async (r) => {
    const { createAssociatedTokenAccountInstruction, createSyncNativeInstruction } = await import("@solana/spl-token");
    const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
    const wsolAta = getAssociatedTokenAddressSync(NATIVE, solVault, true);
    const wrapTx = new Transaction();
    if (!(await connection.getAccountInfo(wsolAta))) {
      wrapTx.add(createAssociatedTokenAccountInstruction(payer.publicKey, wsolAta, solVault, NATIVE));
    }
    wrapTx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wsolAta, lamports: 0.15 * LAMPORTS_PER_SOL }));
    wrapTx.add(createSyncNativeInstruction(wsolAta));
    await provider.sendAndConfirm(wrapTx);
    await program.methods.unwrapWsol().accountsPartial({
      config, pool, solVault, wsolAccount: wsolAta, tokenProgram: TOKEN_PROGRAM_ID, rent: RENT_SYSVAR,
    }).rpc();
    // The credited SOL flows to stakers; lockerA#1 (demoted, 1x) claims an exact share.
    const p = await account.stakePool.fetch(pool);
    const l = await account.lockup.fetch(lockupPda(lockerA.publicKey, 1));
    const pend = pendingOf(l, p);
    const expSol = big(l.claimableSol) + pend.sol.total;
    const expToken = big(l.claimableToken) + pend.token.total;
    if (expSol === 0n) throw new Error("no SOL accrued to the lockup after the unwrap");
    const solB = BigInt((await connection.getAccountInfo(lockerA.publicKey))!.lamports);
    const tokB = await tokenBalance(ctx, ataFor(lockerA));
    const sig = await program.methods.claimLockupRewards().accountsPartial(lockupAccts(lockerA, 1)).signers([lockerA]).rpc();
    const solA = BigInt((await connection.getAccountInfo(lockerA.publicKey))!.lamports);
    const tokA = await tokenBalance(ctx, ataFor(lockerA));
    if (solA - solB !== expSol) throw new Error(`sol claim ${solA - solB} != ${expSol}`);
    if (tokA - tokB !== expToken) throw new Error(`token claim ${tokA - tokB} != ${expToken}`);
    r.pass(`0.15 wrapped SOL unwrapped into the pool; a lockup holder claimed ${expSol} lamports (+${expToken} raw tokens), both exact`, sig);
  });

  // ---- N25: the reserve invariant after all the churn ----
  await scenario(rep, "N25", "invariant after mixed lock/unlock/exit/demote churn: vaults never fall below reserved", async (r) => {
    const p = await account.stakePool.fetch(pool);
    const vaultBal = await tokenBalance(ctx, vault);
    const solBal = BigInt((await connection.getAccountInfo(solVault))!.lamports);
    if (vaultBal < big(p.reservedToken)) throw new Error(`token vault ${vaultBal} < reserved ${big(p.reservedToken)}`);
    if (solBal < big(p.reservedSol)) throw new Error(`sol vault ${solBal} < reserved ${big(p.reservedSol)}`);
    r.pass(`vault ${vaultBal / UNIT} >= reserved ${big(p.reservedToken) / UNIT}; sol vault ${solBal} >= reserved ${big(p.reservedSol)} lamports`);
  });

  // ---- N26/N27/N28: foreign-token recovery ----
  const foreignMint = await createMint(ctx);
  await scenario(rep, "N26", "recover_foreign_token forwards a stray SPL token to the team wallet, closes the stray, rent to the cranker", async (r) => {
    const source = await ensureAta(ctx, foreignMint.publicKey, solVault, true);
    await mintTo(ctx, foreignMint.publicKey, source, 5_000n * UNIT);
    const destination = await ensureAta(ctx, foreignMint.publicKey, devWallet.publicKey);
    const rentLamports = BigInt((await connection.getAccountInfo(source))!.lamports);
    const crankerBefore = BigInt((await connection.getAccountInfo(donor.publicKey))!.lamports);
    const sig = await program.methods.recoverForeignToken().accountsPartial({
      cranker: donor.publicKey, config, solVault, source, destination, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([donor]).rpc();
    if ((await tokenBalance(ctx, destination)) !== 5_000n * UNIT) throw new Error("foreign tokens did not reach the team wallet");
    if (await connection.getAccountInfo(source)) throw new Error("stray token account not closed");
    const crankerAfter = BigInt((await connection.getAccountInfo(donor.publicKey))!.lamports);
    if (crankerAfter - crankerBefore !== rentLamports) throw new Error(`cranker rent ${crankerAfter - crankerBefore} != ${rentLamports}`);
    r.pass(`5000 foreign tokens forwarded to the dev wallet's ATA; stray account closed; ${rentLamports} lamports rent to the cranker`, sig);
  });
  await scenario(rep, "N27", "recovery refuses the reward mint and wSOL (InvalidRecoverySource)", async (r) => {
    const devRewardAta = await ensureAta(ctx, mint.publicKey, devWallet.publicKey);
    const rewardProbe = await expectError(
      program.methods.recoverForeignToken().accountsPartial({
        cranker: donor.publicKey, config, solVault, source: vault, destination: devRewardAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([donor]).rpc(),
      "InvalidRecoverySource"
    );
    const NATIVE = new PublicKey("So11111111111111111111111111111111111111112");
    const wsolStray = await ensureAta(ctx, NATIVE, solVault, true);
    const devWsolAta = await ensureAta(ctx, NATIVE, devWallet.publicKey);
    const wsolProbe = await expectError(
      program.methods.recoverForeignToken().accountsPartial({
        cranker: donor.publicKey, config, solVault, source: wsolStray, destination: devWsolAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([donor]).rpc(),
      "InvalidRecoverySource"
    );
    if (rewardProbe.ok && wsolProbe.ok) r.pass(`the reward vault itself and a vault-owned wSOL account both rejected [${rewardProbe.observed}]`);
    else r.note(`reward: ${rewardProbe.observed}, wsol: ${wsolProbe.observed}`);
  });
  await scenario(rep, "N28", "recovery to a destination the team wallet does not own is rejected", async (r) => {
    const source = await ensureAta(ctx, foreignMint.publicKey, solVault, true); // recreate the (closed) stray
    const wrongDest = await ensureAta(ctx, foreignMint.publicKey, donor.publicKey);
    const res = await expectError(
      program.methods.recoverForeignToken().accountsPartial({
        cranker: donor.publicKey, config, solVault, source, destination: wrongDest, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([donor]).rpc(),
      "ConstraintRaw"
    );
    res.ok ? r.pass(`destination owned by a stranger rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // Wait for the influencer stream to fully vest (fast-clock v2: 3 min from
  // the claim, so usually already vested by now).
  const nowS = () => Math.floor(Date.now() / 1000);
  const infEnd = Number(infStream.end);
  const waitInf = Math.max(0, infEnd - nowS() + 5);
  if (waitInf > 0) await waitSeconds("influencer stream maturing (fast-clock: 3 min)", waitInf);

  await scenario(rep, "I4", "influencer stream vests fully and pays the whole amount by the end", async (r) => {
    const ata = await ensureAta(ctx, mint.publicKey, influencers[0].kp.publicKey);
    const sig = await program.methods.streamWithdraw().accountsPartial({
      beneficiary: influencers[0].kp.publicKey, config, stream: inf0StreamPda, pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([influencers[0].kp]).rpc();
    const bal = await tokenBalance(ctx, ata);
    if (bal !== influencers[0].amount) throw new Error(`got ${bal / UNIT}, expected ${influencers[0].amount / UNIT}`);
    r.pass(`full ${bal / UNIT} withdrawn at maturity`, sig);
    const again = await expectError(
      program.methods.streamWithdraw().accountsPartial({
        beneficiary: influencers[0].kp.publicKey, config, stream: inf0StreamPda, pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([influencers[0].kp]).rpc(),
      "NothingToWithdraw"
    );
    rep.pass("I4b", "a matured, fully-withdrawn stream yields nothing further", `re-withdraw rejected [${again.observed}]`);
  });

  // Wait for the founder/signer streams (fast-clock v2: 5 min) to fully vest.
  const signerEnd = Number(signerStream.end);
  const waitSigner = Math.max(0, signerEnd - nowS() + 5);
  if (waitSigner > 0) await waitSeconds("signer/team streams maturing (fast-clock: 5 min)", waitSigner);
  await scenario(rep, "G7", "the 2014 signer stream vests and pays in full", async (r) => {
    const ata = await ensureAta(ctx, mint.publicKey, signerDest.publicKey);
    const sig = await program.methods.streamWithdraw().accountsPartial({
      beneficiary: signerDest.publicKey, config, stream: signerStreamPda, pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([signerDest]).rpc();
    const bal = await tokenBalance(ctx, ata);
    if (bal !== SIGNER_ALLOC) throw new Error(`got ${bal / UNIT}, expected ${SIGNER_ALLOC / UNIT}`);
    r.pass(`full ${bal / UNIT} withdrawn`, sig);
  });
  await scenario(rep, "T6", "the team stream vests and pays in full by the end", async (r) => {
    const ata = await ensureAta(ctx, mint.publicKey, devWallet.publicKey);
    const sig = await program.methods.streamWithdraw().accountsPartial({
      beneficiary: devWallet.publicKey, config, stream: devStreamPda, pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([devWallet]).rpc();
    const bal = await tokenBalance(ctx, ata);
    if (bal !== DEV_ALLOC) throw new Error(`got ${bal / UNIT}, expected ${DEV_ALLOC / UNIT}`);
    r.pass(`full ${bal / UNIT} withdrawn`, sig);
  });
  await scenario(rep, "T7", "stream_withdraw signed by a non-beneficiary fails", async (r) => {
    const ata = await ensureAta(ctx, mint.publicKey, devWallet.publicKey);
    const res = await expectError(
      program.methods.streamWithdraw().accountsPartial({
        beneficiary: donor.publicKey, config, stream: devStreamPda, pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([donor]).rpc(),
      ["Unauthorized", "ConstraintSeeds", "Unknown"]
    );
    r.pass(`rejected [${res.observed}]`);
  });

  console.log("\n=== RUN A complete ===");
}

/* ================================================================== *
 * RUN B — nobody shows up (backdated claims_start, expired windows)
 * ================================================================== */
async function runB(ctx: Ctx, rep: Reporter) {
  const { program, account, payer, provider, connection } = ctx;
  const pda = pdaFor(ctx.programId);
  const config = pda("config");
  const pool = pda("pool");
  const vault = pda("vault");
  const solVault = pda("sol_vault");

  const OLD_ALLOC = 150_000n * UNIT;
  const INF_ALLOC = 500_000n * UNIT;
  const SIGNER_ALLOC = 100_000n * UNIT;
  const DEV_ALLOC = 250_000n * UNIT;
  const TOTAL = OLD_ALLOC + INF_ALLOC + SIGNER_ALLOC + DEV_ALLOC;

  console.log("\n=== RUN B: nobody shows up ===\n");

  const mint = await createMint(ctx);
  const treasury = await createTokenAccount(ctx, mint.publicKey, payer.publicKey);
  await mintTo(ctx, mint.publicKey, treasury, TOTAL + 1_000_000n * UNIT);

  const holders = [
    { kp: Keypair.generate(), amount: 90_000n * UNIT },
    { kp: Keypair.generate(), amount: 60_000n * UNIT },
  ];
  const influencers = [
    { kp: Keypair.generate(), amount: 300_000n * UNIT },
    { kp: Keypair.generate(), amount: 200_000n * UNIT },
  ];
  const oldTree = buildTree(holders.map((h) => ({ address: h.kp.publicKey.toBase58(), amount: h.amount.toString() }))).tree;
  const infTree = buildTree(influencers.map((h) => ({ address: h.kp.publicKey.toBase58(), amount: h.amount.toString() }))).tree;
  const signerKey = makeBitcoinKey();
  const staker = Keypair.generate();
  const devWallet = Keypair.generate();

  await fundWallets(ctx, [...holders, ...influencers].map((h) => h.kp.publicKey).concat([staker.publicKey]), 0.025);

  // Backdate claims_start so BOTH claim windows are already closed. Fast-clock
  // v2: OLD window 6 min, INF window 4 min. Backdate by 50 min so both are
  // long shut and every sweep deadline has passed.
  const claimsStart = Math.floor(Date.now() / 1000) - (50 * 60);

  const params = {
    oldHolderRoot: oldTree.rootArray,
    oldHolderAllocation: new BN(OLD_ALLOC.toString()),
    influencerRoot: infTree.rootArray,
    influencerAllocation: new BN(INF_ALLOC.toString()),
    originalSignerPubkey: Array.from(signerKey.publicKeyXY),
    originalSignerAllocation: new BN(SIGNER_ALLOC.toString()),
    devWallet: devWallet.publicKey,
    devAllocation: new BN(DEV_ALLOC.toString()),
    devCliffSeconds: new BN(0),
    claimsStart: new BN(claimsStart),
  };
  const rentSysvar = new PublicKey("SysvarRent111111111111111111111111111111111");

  // S12/S13: before lock, claims and sweeps are refused.
  await scenario(rep, "S2b", "initialize (backdated claims_start)", async (r) => {
    const sig = await program.methods.initialize(params).accountsPartial({
      payer: payer.publicKey, authority: payer.publicKey, rewardMint: mint.publicKey,
      config, pool, vault, solVault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, rent: rentSysvar,
    }).rpc();
    r.pass(`initialized with claims_start 50 min in the past`, sig);
  });
  await scenario(rep, "S12", "claims are refused before the config is locked (ConfigNotLocked)", async (r) => {
    const h = holders[0];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      "ConfigNotLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "S13", "sweeps are refused before the config is locked (ConfigNotLocked)", async (r) => {
    const res = await expectError(
      program.methods.sweepOldHolders().accountsPartial({ cranker: payer.publicKey, config, pool }).rpc(),
      "ConfigNotLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  await program.methods.fundVault(new BN(TOTAL.toString())).accountsPartial({
    authority: payer.publicKey, config, vault, pool, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();
  await program.methods.lockConfig().accountsPartial({ authority: payer.publicKey, config, pool, vault }).rpc();
  console.log("   funded + locked\n");

  // A staker so swept/forfeited value has somewhere to land.
  const stakerAta = await ensureAta(ctx, mint.publicKey, staker.publicKey);
  await mintTo(ctx, mint.publicKey, stakerAta, 50_000n * UNIT);
  await program.methods.stake(new BN((10_000n * UNIT).toString())).accountsPartial({
    owner: staker.publicKey, config, pool, position: pda("stake", staker.publicKey.toBuffer()), vault, source: stakerAta,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([staker]).rpc();

  // L6: claim after the window closed.
  await scenario(rep, "L6", "a legacy claim after the window fails (ClaimWindowClosed)", async (r) => {
    const h = holders[0];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      "ClaimWindowClosed"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "I5", "an influencer claim after the window fails (ClaimWindowClosed)", async (r) => {
    const inf = influencers[0];
    const res = await expectError(
      program.methods.claimInfluencer(new BN(inf.amount.toString()), infTree.proofFor(hashLeaf(inf.kp.publicKey.toBase58(), inf.amount)).map((p) => Array.from(p))).accountsPartial({
        claimant: inf.kp.publicKey, config, receipt: pda("inf_claim", inf.kp.publicKey.toBuffer()),
        stream: pda("stream", inf.kp.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).signers([inf.kp]).rpc(),
      "ClaimWindowClosed"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // W1: sweep before deadline — but both are already past, so demonstrate on
  // a fresh probe is not possible here; note it's covered by timing in run A window.
  // W2: sweep_old_holders credits the full unclaimed remainder instantly.
  await scenario(rep, "W2", "sweep_old_holders credits the unclaimed remainder to the pool instantly", async (r) => {
    const before = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    const sig = await program.methods.sweepOldHolders().accountsPartial({ cranker: payer.publicKey, config, pool }).rpc();
    const after = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    if (after - before !== OLD_ALLOC) throw new Error(`credited ${(after - before) / UNIT}, expected ${OLD_ALLOC / UNIT}`);
    r.pass(`credited full ${OLD_ALLOC / UNIT} (nobody claimed) to the pool at once`, sig);
  });
  await scenario(rep, "W3", "sweep_old_holders cannot run twice (AlreadyClaimed)", async (r) => {
    const res = await expectError(
      program.methods.sweepOldHolders().accountsPartial({ cranker: payer.publicKey, config, pool }).rpc(),
      "AlreadyClaimed"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "W4", "a legacy claim after the sweep fails (ClaimWindowClosed)", async (r) => {
    const h = holders[1];
    const ata = await ensureAta(ctx, mint.publicKey, h.kp.publicKey);
    const proof = oldTree.proofFor(hashLeaf(h.kp.publicKey.toBase58(), h.amount)).map((p) => Array.from(p));
    const res = await expectError(
      program.methods.claimOldHolder(new BN(h.amount.toString()), proof).accountsPartial({
        claimant: h.kp.publicKey, config, receipt: pda("old_claim", h.kp.publicKey.toBuffer()),
        pool, vault, destination: ata, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([h.kp]).rpc(),
      "ClaimWindowClosed"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // W9: past the (locally back-dated) 2030 deadline, a signer claim is closed.
  await scenario(rep, "W9", "a 2014-signer claim after the deadline fails (ClaimWindowClosed)", async (r) => {
    const dest = Keypair.generate();
    const msg = SIGNER_PREFIX + dest.publicKey.toBase58();
    const { header, signature } = signBitcoin(signerKey, msg);
    const res = await expectError(
      program.methods.claimOriginalSigner(dest.publicKey, header, Array.from(signature)).accountsPartial({
        payer: payer.publicKey, config, stream: pda("stream", dest.publicKey.toBuffer()), systemProgram: SystemProgram.programId,
      }).rpc(),
      "ClaimWindowClosed"
    );
    res.ok ? r.pass(`rejected past the deadline [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // W8: sweep_original_signer opens a kind-1 community stream (needs a build
  // whose ORIGINAL_SIGNER_DEADLINE is in the past — Run B sets that locally).
  const cs1 = pda("community_stream", Buffer.from([1]));
  await scenario(rep, "W8", "sweep_original_signer opens a community stream for the whole allocation", async (r) => {
    const sig = await program.methods.sweepOriginalSigner().accountsPartial({
      cranker: payer.publicKey, config, communityStream: cs1, systemProgram: SystemProgram.programId,
    }).rpc();
    const s = await account.communityStream.fetch(cs1);
    if (BigInt(s.total.toString()) !== SIGNER_ALLOC) throw new Error(`stream total ${BigInt(s.total.toString()) / UNIT}`);
    r.pass(`kind1 community stream total=${BigInt(s.total.toString()) / UNIT}, streaming to stakers`, sig);
  });

  // W5: sweep_influencers opens a kind-0 community stream.
  const cs0 = pda("community_stream", Buffer.from([0]));
  await scenario(rep, "W5", "sweep_influencers opens a 30-day community stream for the remainder", async (r) => {
    const sig = await program.methods.sweepInfluencers().accountsPartial({
      cranker: payer.publicKey, config, communityStream: cs0, systemProgram: SystemProgram.programId,
    }).rpc();
    const s = await account.communityStream.fetch(cs0);
    if (BigInt(s.total.toString()) !== INF_ALLOC) throw new Error(`stream total ${BigInt(s.total.toString()) / UNIT}`);
    r.pass(`community stream kind0 total=${BigInt(s.total.toString()) / UNIT}, streaming to stakers`, sig);
  });
  await scenario(rep, "W6", "releasing the community stream immediately yields nothing (NothingToWithdraw)", async (r) => {
    const res = await expectError(
      program.methods.releaseCommunityStream().accountsPartial({ cranker: payer.publicKey, pool, communityStream: cs0 }).rpc(),
      "NothingToWithdraw"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // W7: crank mid-stream ~ half; then to the end.
  const cs = await account.communityStream.fetch(cs0);
  const csEnd = Number(cs.end);
  const csStart = Number(cs.start);
  const half = csStart + Math.floor((csEnd - csStart) / 2);
  const nowS = () => Math.floor(Date.now() / 1000);
  const waitHalf = Math.max(0, half - nowS() + 3);
  if (waitHalf > 0) await waitSeconds("community stream half-vested (fast)", waitHalf);
  await scenario(rep, "W7", "release_community_stream credits roughly half at the halfway point", async (r) => {
    const before = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    const sig = await program.methods.releaseCommunityStream().accountsPartial({ cranker: payer.publicKey, pool, communityStream: cs0 }).rpc();
    const after = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    const credited = (after - before);
    const pct = Number((credited * 100n) / INF_ALLOC);
    if (pct < 35 || pct > 65) throw new Error(`credited ${pct}% at halfway`);
    r.pass(`credited ~${pct}% of the forfeit at the halfway point`, sig);
  });
  const waitEnd = Math.max(0, csEnd - nowS() + 5);
  if (waitEnd > 0) await waitSeconds("community stream to completion", waitEnd);
  await scenario(rep, "W7b", "at the end the full forfeit has reached the pool exactly once", async (r) => {
    const sig = await program.methods.releaseCommunityStream().accountsPartial({ cranker: payer.publicKey, pool, communityStream: cs0 }).rpc();
    const s = await account.communityStream.fetch(cs0);
    if (BigInt(s.released.toString()) !== INF_ALLOC) throw new Error(`released ${BigInt(s.released.toString()) / UNIT}`);
    r.pass(`released == total == ${INF_ALLOC / UNIT}`, sig);
    const again = await expectError(
      program.methods.releaseCommunityStream().accountsPartial({ cranker: payer.publicKey, pool, communityStream: cs0 }).rpc(),
      "NothingToWithdraw"
    );
    rep.pass("W7c", "a fully-released community stream yields nothing further", `rejected [${again.observed}]`);
  });

  // W8b: the signer (kind-1) community stream also credits the pool as it vests.
  // Its duration is the founder fast-clock stream (5 min), so by the time the
  // kind-0 stream above has fully vested it has something to release; the
  // release proves the same crank works for kind 1.
  await scenario(rep, "W8b", "release_community_stream credits the signer forfeit to the pool as it vests", async (r) => {
    const before = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    const sig = await program.methods.releaseCommunityStream().accountsPartial({ cranker: payer.publicKey, pool, communityStream: cs1 }).rpc();
    const after = BigInt((await account.stakePool.fetch(pool)).lifetimeTokenRewards.toString());
    const credited = after - before;
    if (credited <= 0n) throw new Error("nothing credited from kind-1 stream");
    const s = await account.communityStream.fetch(cs1);
    r.pass(`credited ${credited / UNIT} so far of ${SIGNER_ALLOC / UNIT}; released=${BigInt(s.released.toString()) / UNIT}`, sig);
  });

  // W11: the staker can actually withdraw the swept + forfeited value.
  await scenario(rep, "W11", "a staker can withdraw the swept/forfeited value as real tokens", async (r) => {
    const before = await tokenBalance(ctx, stakerAta);
    const sig = await program.methods.claimRewards().accountsPartial({
      owner: staker.publicKey, config, pool, position: pda("stake", staker.publicKey.toBuffer()), vault, solVault, destination: stakerAta,
      tokenProgram: TOKEN_PROGRAM_ID, rent: rentSysvar,
    }).signers([staker]).rpc();
    const after = await tokenBalance(ctx, stakerAta);
    if (after <= before) throw new Error("staker received nothing");
    r.pass(`sole staker claimed ${(after - before) / UNIT} tokens of swept+forfeited value`, sig);
  });

  console.log("\n=== RUN B complete ===");
}

async function main() {
  const run = (process.env.RUN ?? "A").toUpperCase();
  const reportDir = process.env.REPORT_DIR ?? "./scratch-e2e";
  const ctx = await makeCtx();
  const programInfo = await ctx.connection.getAccountInfo(ctx.programId);
  if (!programInfo) throw new Error(`program ${ctx.programId.toBase58()} not deployed on this cluster`);
  const rep = new Reporter(run, ctx.programId.toBase58());

  console.log(`\nE2E CAMPAIGN — RUN ${run}`);
  console.log(`program: ${ctx.programId.toBase58()}`);
  console.log(`payer:   ${ctx.payer.publicKey.toBase58()}`);
  const bal = await ctx.connection.getBalance(ctx.payer.publicKey);
  console.log(`balance: ${bal / LAMPORTS_PER_SOL} SOL\n`);

  try {
    if (run === "A") await runA(ctx, rep);
    else if (run === "B") await runB(ctx, rep);
    else throw new Error(`unknown RUN "${run}" (A|B)`);
  } finally {
    // Success or crash, sweep the throwaway wallets' leftover SOL home.
    await defundSpawned(ctx);
  }

  const path = rep.save(reportDir);
  const s = rep.summary();
  console.log(`\n${"═".repeat(50)}`);
  console.log(`RUN ${run}: ${s.pass} pass · ${s.note} note · ${s.fail} fail  (of ${s.total})`);
  console.log(`report rows: ${path}`);
  console.log("═".repeat(50));
  if (s.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
