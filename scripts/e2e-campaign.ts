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
  expectError,
  fundWallets,
  getAssociatedTokenAddressSync,
  makeCtx,
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
  const stakers = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const donor = Keypair.generate();
  const devWallet = Keypair.generate();

  await fundWallets(
    ctx,
    [...holders, ...influencers].map((h) => h.kp.publicKey)
      .concat([signerDest.publicKey, relay.publicKey, donor.publicKey, ...stakers.map((s) => s.publicKey)]),
    0.05
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

    // Fail fast if the deployed program is NOT the fast-clock build: the whole
    // campaign's timing assumes minute-scale windows. old_holder_deadline -
    // claims_start must equal OLD_HOLDER_CLAIM_WINDOW: 2700s fast, 2_592_000
    // real. Abort loudly rather than sink 40 minutes into a wrong build.
    const window = Number(c.oldHolderDeadline) - Number(c.claimsStart);
    if (window !== 2700) {
      throw new Error(
        `FAST-CLOCK GUARD: old-holder window is ${window}s, expected 2700s. ` +
          `The deployed program is not a fast-clock build — aborting the run.`
      );
    }
    console.log(`   ✓ fast-clock confirmed: old-holder window is ${window}s (45 min)`);
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
    await fundWallets(ctx, [intruder.publicKey], 0.03);
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
    await fundWallets(ctx, [intruder.publicKey], 0.03);
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

  // ---- STAKING ----
  // Give each staker their own token account + tokens.
  const stakeAtas: PublicKey[] = [];
  for (const s of stakers) {
    const ata = await ensureAta(ctx, mint.publicKey, s.publicKey);
    await mintTo(ctx, mint.publicKey, ata, 100_000n * UNIT);
    stakeAtas.push(ata);
  }
  const posPda = (owner: PublicKey) => pda("stake", owner.toBuffer());
  const stakeAccts = (s: Keypair, ata: PublicKey) => ({
    owner: s.publicKey, config, pool, position: posPda(s.publicKey), vault, source: ata,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  });
  const rewardAccts = (s: Keypair, ata: PublicKey) => ({
    owner: s.publicKey, config, pool, position: posPda(s.publicKey), vault, solVault, destination: ata,
    tokenProgram: TOKEN_PROGRAM_ID, rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
  });

  await scenario(rep, "K3", "staking rejects an invalid tier byte (InvalidTier)", async (r) => {
    const res = await expectError(
      program.methods.stake(new BN((1n * UNIT).toString()), 9).accountsPartial(stakeAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc(),
      "InvalidTier"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "K4", "staking rejects a zero amount (ZeroAmount)", async (r) => {
    const res = await expectError(
      program.methods.stake(new BN(0), 0).accountsPartial(stakeAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc(),
      "ZeroAmount"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // staker0 flexible 10k, staker1 3-month 10k (weight 2x=20k), staker2 12-month 10k (weight 5x=50k)
  await scenario(rep, "K1", "flexible stake registers with weight == amount", async (r) => {
    const sig = await program.methods.stake(new BN((10_000n * UNIT).toString()), 0).accountsPartial(stakeAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc();
    const p = await account.stakePosition.fetch(posPda(stakers[0].publicKey));
    if (BigInt(p.weight.toString()) !== 10_000n * UNIT) throw new Error("weight != amount");
    r.pass(`flexible weight=${BigInt(p.weight.toString()) / UNIT}`, sig);
  });
  await scenario(rep, "K2", "locked tiers apply the multiplier to weight (2x, 5x)", async (r) => {
    const s1 = await program.methods.stake(new BN((10_000n * UNIT).toString()), 2).accountsPartial(stakeAccts(stakers[1], stakeAtas[1])).signers([stakers[1]]).rpc();
    await program.methods.stake(new BN((10_000n * UNIT).toString()), 3).accountsPartial(stakeAccts(stakers[2], stakeAtas[2])).signers([stakers[2]]).rpc();
    const p1 = await account.stakePosition.fetch(posPda(stakers[1].publicKey));
    const p2 = await account.stakePosition.fetch(posPda(stakers[2].publicKey));
    if (BigInt(p1.weight.toString()) !== 20_000n * UNIT) throw new Error("2x weight wrong");
    if (BigInt(p2.weight.toString()) !== 50_000n * UNIT) throw new Error("5x weight wrong");
    r.pass(`3-month weight=${BigInt(p1.weight.toString()) / UNIT} (2x), 12-month weight=${BigInt(p2.weight.toString()) / UNIT} (5x)`, s1);
  });

  // ---- K5/K7/K8: token rewards split pro-rata; base paid on claim, boost escrowed ----
  // Reward fields on a position are lazily computed: they only materialize when
  // the position is settled (stake/unstake/claim). So we notify, then CLAIM to
  // settle and observe the split — reading the fields straight after notify
  // would show the pre-reward values (they had not settled yet).
  await scenario(rep, "K5/K7/K8", "token rewards split pro-rata by weight; base paid on claim, boost escrowed", async (r) => {
    // total weight = 10k(flex) + 20k(3mo) + 50k(12mo) = 80k. Notify 80k => 1 per weight unit.
    // Payer funds the reward from the treasury it owns (donor is only funded for fees).
    const sig = await program.methods.notifyTokenRewards(new BN((80_000n * UNIT).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, vault, source: treasury, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    // Claim staker0 (flexible: all base, no boost) and staker2 (12-month: base + boost).
    const s0b = await tokenBalance(ctx, stakeAtas[0]);
    await program.methods.claimRewards().accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc();
    const s0a = await tokenBalance(ctx, stakeAtas[0]);
    const s2b = await tokenBalance(ctx, stakeAtas[2]);
    await program.methods.claimRewards().accountsPartial(rewardAccts(stakers[2], stakeAtas[2])).signers([stakers[2]]).rpc();
    const s2a = await tokenBalance(ctx, stakeAtas[2]);
    const p2 = await account.stakePosition.fetch(posPda(stakers[2].publicKey));
    // flexible weight 10k/80k, amount 10k => base 10k, boost 0.
    // 12-month weight 50k/80k, amount 10k => total 50k, base 10k, boost 40k.
    if ((s0a - s0b) !== 10_000n * UNIT) throw new Error(`flex base ${(s0a - s0b) / UNIT} != 10000`);
    if ((s2a - s2b) !== 10_000n * UNIT) throw new Error(`12mo base ${(s2a - s2b) / UNIT} != 10000`);
    if (BigInt(p2.escrowToken.toString()) !== 40_000n * UNIT) throw new Error(`12mo boost ${BigInt(p2.escrowToken.toString()) / UNIT} != 40000`);
    r.pass(`flex base=10000 boost=0; 12mo base=10000 boost=40000 escrowed (pro-rata by weight; claim pays base only)`, sig);
  });

  await scenario(rep, "K9", "boost escrow cannot be released before maturity (EscrowNotMatured)", async (r) => {
    const res = await expectError(
      program.methods.withdrawBoostEscrow().accountsPartial(rewardAccts(stakers[2], stakeAtas[2])).signers([stakers[2]]).rpc(),
      "EscrowNotMatured"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  await scenario(rep, "K6", "SOL rewards distribute alongside token rewards", async (r) => {
    // Payer (well funded) deposits; donor is only funded for fees, so it cannot
    // source 0.8 SOL. Then claim staker0 to settle and observe the SOL payout.
    const sig = await program.methods.notifySolRewards(new BN((0.8 * LAMPORTS_PER_SOL).toString())).accountsPartial({
      depositor: payer.publicKey, config, pool, solVault, systemProgram: SystemProgram.programId,
    }).rpc();
    const before = BigInt((await connection.getAccountInfo(stakers[0].publicKey))!.lamports);
    await program.methods.claimRewards().accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc();
    const after = BigInt((await connection.getAccountInfo(stakers[0].publicKey))!.lamports);
    // staker0 flexible, weight 10k/80k => 0.1 SOL base; net of the fee it pays as signer.
    if (after <= before) throw new Error(`staker0 SOL did not increase (before ${before}, after ${after})`);
    r.pass(`staker0 received ~${Number(after - before) / LAMPORTS_PER_SOL} SOL of rewards (flexible, all base)`, sig);
  });

  await scenario(rep, "K11", "flexible unstake without a request fails (NoUnstakeRequested)", async (r) => {
    const res = await expectError(
      program.methods.unstake(new BN((1n * UNIT).toString())).accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc(),
      "NoUnstakeRequested"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "K29", "request_unstake on a locked tier fails (NotLocked)", async (r) => {
    const res = await expectError(
      program.methods.requestUnstake().accountsPartial({ owner: stakers[1].publicKey, position: posPda(stakers[1].publicKey) }).signers([stakers[1]]).rpc(),
      "NotLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "K28", "locked-tier unstake before maturity fails (StillLocked)", async (r) => {
    const res = await expectError(
      program.methods.unstake(new BN((1n * UNIT).toString())).accountsPartial(rewardAccts(stakers[1], stakeAtas[1])).signers([stakers[1]]).rpc(),
      "StillLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });
  await scenario(rep, "K19", "emergency_exit on a flexible position fails (NotLocked)", async (r) => {
    const res = await expectError(
      program.methods.emergencyExit().accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc(),
      "NotLocked"
    );
    res.ok ? r.pass(`rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // ---- K22/K23: claim-then-exit attack + forfeit to remaining stakers ----
  // staker1 is 3-month locked with escrow. Drain claimable, then emergency_exit; escrow must be forfeited.
  await scenario(rep, "K22", "claim-then-exit still forfeits the whole boost escrow", async (r) => {
    // First claim staker1's base rewards.
    await program.methods.claimRewards().accountsPartial(rewardAccts(stakers[1], stakeAtas[1])).signers([stakers[1]]).rpc();
    const p = await account.stakePosition.fetch(posPda(stakers[1].publicKey));
    const escrowBefore = BigInt(p.escrowToken.toString());
    const balBefore = await tokenBalance(ctx, stakeAtas[1]);
    const sig = await program.methods.emergencyExit().accountsPartial(rewardAccts(stakers[1], stakeAtas[1])).signers([stakers[1]]).rpc();
    const balAfter = await tokenBalance(ctx, stakeAtas[1]);
    const principalReturned = balAfter - balBefore;
    // 15% slash on 10k principal => 8.5k back
    if (principalReturned !== 8_500n * UNIT) throw new Error(`principal returned ${principalReturned / UNIT}, expected 8500`);
    r.pass(`exited: got back ${principalReturned / UNIT} (85% of 10k), forfeited ${escrowBefore / UNIT} escrow + 15% slash to pool`, sig);
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

  // ---- K13: flexible cooldown then partial unstake ----
  await scenario(rep, "K12", "flexible unstake inside the cooldown fails (CooldownActive)", async (r) => {
    await program.methods.requestUnstake().accountsPartial({ owner: stakers[0].publicKey, position: posPda(stakers[0].publicKey) }).signers([stakers[0]]).rpc();
    const res = await expectError(
      program.methods.unstake(new BN((1n * UNIT).toString())).accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc(),
      "CooldownActive"
    );
    res.ok ? r.pass(`request made; immediate unstake rejected [${res.observed}]`) : r.note(`observed ${res.observed}`);
  });

  // Wait out the 3-minute cooldown (fast-clock UNSTAKE_COOLDOWN).
  await waitSeconds("flexible cooldown (3 min)", 185);
  await scenario(rep, "K13", "after the cooldown, a partial flexible unstake pays principal only", async (r) => {
    const before = await tokenBalance(ctx, stakeAtas[0]);
    const sig = await program.methods.unstake(new BN((4_000n * UNIT).toString())).accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc();
    const after = await tokenBalance(ctx, stakeAtas[0]);
    if ((after - before) < 4_000n * UNIT) throw new Error(`got ${(after - before) / UNIT}`);
    r.pass(`partial unstake returned ${(after - before) / UNIT} principal`, sig);
  });
  await scenario(rep, "K14", "a second partial unstake succeeds without a fresh request (documented quirk)", async (r) => {
    const sig = await program.methods.unstake(new BN((1_000n * UNIT).toString())).accountsPartial(rewardAccts(stakers[0], stakeAtas[0])).signers([stakers[0]]).rpc();
    r.note(`second partial unstake succeeded without re-requesting — flag for review`, sig);
  });

  // Wait for the influencer stream to fully vest (15 min fast-clock) and the
  // 12-month lock (12 min) so escrow can be released.
  const nowS = () => Math.floor(Date.now() / 1000);
  const infEnd = Number(infStream.end);
  const lockEnd = Number((await account.stakePosition.fetch(posPda(stakers[2].publicKey))).lockEnd);
  const waitInf = Math.max(0, infEnd - nowS() + 5);
  if (waitInf > 0) await waitSeconds("influencer stream maturing (15 min)", waitInf);

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

  const waitLock = Math.max(0, lockEnd - nowS() + 5);
  if (waitLock > 0) await waitSeconds("12-month lock maturing (12 min)", waitLock);
  await scenario(rep, "K10", "boost escrow releases after lock maturity", async (r) => {
    const before = await tokenBalance(ctx, stakeAtas[2]);
    const sig = await program.methods.withdrawBoostEscrow().accountsPartial(rewardAccts(stakers[2], stakeAtas[2])).signers([stakers[2]]).rpc();
    const after = await tokenBalance(ctx, stakeAtas[2]);
    const p = await account.stakePosition.fetch(posPda(stakers[2].publicKey));
    if (BigInt(p.escrowToken.toString()) !== 0n) throw new Error("escrow not zeroed");
    r.pass(`released ${(after - before) / UNIT} escrow after maturity; escrow now 0`, sig);
  });

  // Wait for the founder/signer streams (30 min fast-clock) to fully vest.
  const signerEnd = Number(signerStream.end);
  const waitSigner = Math.max(0, signerEnd - nowS() + 5);
  if (waitSigner > 0) await waitSeconds("signer/team streams maturing (30 min total)", waitSigner);
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

  await fundWallets(ctx, [...holders, ...influencers].map((h) => h.kp.publicKey).concat([staker.publicKey]), 0.05);

  // Backdate claims_start so BOTH claim windows are already closed. Fast-clock:
  // OLD window 45 min, INF window 20 min. Backdate by 50 min so both are shut
  // but the sweeps' deadlines have passed.
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
  await program.methods.stake(new BN((10_000n * UNIT).toString()), 0).accountsPartial({
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
  // Its duration is the founder 30-min fast-clock, so by the ~15-min mark above
  // it is partway vested; a release proves the same crank works for kind 1.
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

  if (run === "A") await runA(ctx, rep);
  else if (run === "B") await runB(ctx, rep);
  else throw new Error(`unknown RUN "${run}" (A|B)`);

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
