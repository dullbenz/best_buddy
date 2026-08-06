import * as anchor from "@coral-xyz/anchor";
// See tests/helpers.ts — named imports from this CJS package break on Node 22.18+.
const { BN } = anchor;
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { buildTree, hashLeaf, MerkleTree } from "../scripts/merkle";
import {
  advanceSlot,
  airdropTo,
  createWrappedSolAccount,
  DAY,
  Env,
  ORIGINAL_SIGNER_DEADLINE,
  Tier,
  createTokenAccount,
  expectFailure,
  fundSol,
  makeBitcoinKey,
  mintTo,
  setupEnv,
  signBitcoinMessage,
  signerClaimMessage,
  solBalance,
  NATIVE_MINT,
  stakePda,
  streamPda,
  tokenBalance,
  warpBy,
  warpTo,
} from "./helpers";

const UNIT = 1_000_000n; // 6 decimals
const OLD_ALLOC = 550_000n * UNIT;
const INF_ALLOC = 150_000n * UNIT;
const SIGNER_ALLOC = 200_000n * UNIT;
const DEV_ALLOC = 100_000n * UNIT;
const TOTAL_BUCKETS = OLD_ALLOC + INF_ALLOC + SIGNER_ALLOC + DEV_ALLOC;

/** A fixed base time so every window in the tests is deterministic. */
const BASE_TS = 1_800_000_000; // 2027-01-15T08:00:00Z

interface Bootstrapped {
  env: Env;
  oldHolders: { keypair: Keypair; amount: bigint }[];
  oldTree: MerkleTree;
  influencers: { keypair: Keypair; amount: bigint }[];
  infTree: MerkleTree;
  btcKey: ReturnType<typeof makeBitcoinKey>;
  devWallet: Keypair;
  claimsStart: number;
}

async function bootstrap(opts: { lock?: boolean; fundExtra?: bigint } = {}): Promise<Bootstrapped> {
  const { lock = true, fundExtra = 0n } = opts;
  const env = await setupEnv();
  await warpTo(env.context, BASE_TS);

  const oldHolders = [
    { keypair: Keypair.generate(), amount: (OLD_ALLOC * 60n) / 100n },
    { keypair: Keypair.generate(), amount: (OLD_ALLOC * 30n) / 100n },
    { keypair: Keypair.generate(), amount: OLD_ALLOC - (OLD_ALLOC * 90n) / 100n },
  ];
  const influencers = [
    { keypair: Keypair.generate(), amount: (INF_ALLOC * 50n) / 100n },
    { keypair: Keypair.generate(), amount: INF_ALLOC - (INF_ALLOC * 50n) / 100n },
  ];

  const oldTree = buildTree(
    oldHolders.map((h) => ({ address: h.keypair.publicKey.toBase58(), amount: h.amount.toString() }))
  ).tree;
  const infTree = buildTree(
    influencers.map((h) => ({ address: h.keypair.publicKey.toBase58(), amount: h.amount.toString() }))
  ).tree;

  const btcKey = makeBitcoinKey();
  const devWallet = Keypair.generate();

  for (const k of [...oldHolders, ...influencers].map((x) => x.keypair)) {
    await fundSol(env, k.publicKey, LAMPORTS_PER_SOL);
  }
  await fundSol(env, devWallet.publicKey, LAMPORTS_PER_SOL);

  await env.program.methods
    .initialize({
      oldHolderRoot: oldTree.rootArray,
      oldHolderAllocation: new BN(OLD_ALLOC.toString()),
      influencerRoot: infTree.rootArray,
      influencerAllocation: new BN(INF_ALLOC.toString()),
      originalSignerPubkey: Array.from(btcKey.publicKeyXY),
      originalSignerAllocation: new BN(SIGNER_ALLOC.toString()),
      devWallet: devWallet.publicKey,
      devAllocation: new BN(DEV_ALLOC.toString()),
      devCliffSeconds: new BN(30 * DAY),
      claimsStart: new BN(BASE_TS),
    })
    .accountsPartial({
      payer: env.payer.publicKey,
      authority: env.authority.publicKey,
      rewardMint: env.mint,
      config: env.configPda,
      pool: env.poolPda,
      vault: env.vaultPda,
      solVault: env.solVaultPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([env.payer])
    .rpc();

  // Fund the vault with every committed allocation (plus any extra the test needs).
  const treasury = await createTokenAccount(env, env.authority.publicKey);
  await mintTo(env, treasury, TOTAL_BUCKETS + fundExtra);
  await env.program.methods
    .fundVault(new BN((TOTAL_BUCKETS + fundExtra).toString()))
    .accountsPartial({
      authority: env.authority.publicKey,
      config: env.configPda,
      vault: env.vaultPda,
      pool: env.poolPda,
      source: treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([env.authority])
    .rpc();

  if (lock) {
    await env.program.methods
      .lockConfig()
      .accountsPartial({
        authority: env.authority.publicKey,
        config: env.configPda,
        vault: env.vaultPda,
      })
      .signers([env.authority])
      .rpc();
  }

  return { env, oldHolders, oldTree, influencers, infTree, btcKey, devWallet, claimsStart: BASE_TS };
}

function proofArrays(tree: MerkleTree, address: PublicKey, amount: bigint): number[][] {
  const leaf = hashLeaf(address.toBase58(), amount);
  return tree.proofFor(leaf).map((p) => Array.from(p));
}

async function claimOldHolder(b: Bootstrapped, index: number) {
  const { env } = b;
  const holder = b.oldHolders[index];
  const dest = await createTokenAccount(env, holder.keypair.publicKey);
  await env.program.methods
    .claimOldHolder(new BN(holder.amount.toString()), proofArrays(b.oldTree, holder.keypair.publicKey, holder.amount))
    .accountsPartial({
      claimant: holder.keypair.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      receipt: PublicKey.findProgramAddressSync(
        [Buffer.from("old_claim"), holder.keypair.publicKey.toBuffer()],
        env.programId
      )[0],
      vault: env.vaultPda,
      destination: dest,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([holder.keypair])
    .rpc();
  return dest;
}

async function stake(env: Env, staker: Keypair, source: PublicKey, amount: bigint, tier: number) {
  await env.program.methods
    .stake(new BN(amount.toString()), tier)
    .accountsPartial({
      owner: staker.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      position: stakePda(staker.publicKey, env.programId),
      vault: env.vaultPda,
      source,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([staker])
    .rpc();
}

async function notifyTokens(env: Env, from: Keypair, source: PublicKey, amount: bigint) {
  await env.program.methods
    .notifyTokenRewards(new BN(amount.toString()))
    .accountsPartial({
      depositor: from.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      vault: env.vaultPda,
      source,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([from])
    .rpc();
}

async function makeStaker(env: Env, amount: bigint) {
  const staker = Keypair.generate();
  await fundSol(env, staker.publicKey, LAMPORTS_PER_SOL);
  const acct = await createTokenAccount(env, staker.publicKey);
  await mintTo(env, acct, amount);
  return { staker, acct };
}

describe("buddy-distributor", () => {
  // -----------------------------------------------------------------------
  describe("setup and the config lock", () => {
    it("refuses to lock while the vault is short of the committed allocations", async () => {
      const env = await setupEnv();
      await warpTo(env.context, BASE_TS);
      const btcKey = makeBitcoinKey();
      await env.program.methods
        .initialize({
          oldHolderRoot: Array(32).fill(0),
          oldHolderAllocation: new BN(OLD_ALLOC.toString()),
          influencerRoot: Array(32).fill(0),
          influencerAllocation: new BN(0),
          originalSignerPubkey: Array.from(btcKey.publicKeyXY),
          originalSignerAllocation: new BN(0),
          devWallet: Keypair.generate().publicKey,
          devAllocation: new BN(0),
          devCliffSeconds: new BN(0),
          claimsStart: new BN(BASE_TS),
        })
        .accountsPartial({
          payer: env.payer.publicKey,
          authority: env.authority.publicKey,
          rewardMint: env.mint,
          config: env.configPda,
          pool: env.poolPda,
          vault: env.vaultPda,
          solVault: env.solVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([env.payer])
        .rpc();

      await expectFailure(
        env.program.methods
          .lockConfig()
          .accountsPartial({ authority: env.authority.publicKey, config: env.configPda, vault: env.vaultPda })
          .signers([env.authority])
          .rpc(),
        "InsufficientBucketBalance"
      );
    });

    it("blocks claims until the config is locked", async () => {
      const b = await bootstrap({ lock: false });
      await expectFailure(claimOldHolder(b, 0), "ConfigNotLocked");
    });

    it("blocks funding once locked", async () => {
      const b = await bootstrap();
      const extra = await createTokenAccount(b.env, b.env.authority.publicKey);
      await mintTo(b.env, extra, 1000n);
      await expectFailure(
        b.env.program.methods
          .fundVault(new BN(1000))
          .accountsPartial({
            authority: b.env.authority.publicKey,
            config: b.env.configPda,
            vault: b.env.vaultPda,
            source: extra,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([b.env.authority])
          .rpc(),
        "ConfigLocked"
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 2 — old Buddy holders", () => {
    it("pays out instantly with a valid proof", async () => {
      const b = await bootstrap();
      const dest = await claimOldHolder(b, 0);
      assert.equal((await tokenBalance(b.env, dest)).toString(), b.oldHolders[0].amount.toString());

      const config = await (b.env.program.account as any).config.fetch(b.env.configPda);
      assert.equal(config.oldHolderClaimed.toString(), b.oldHolders[0].amount.toString());
    });

    it("rejects a second claim from the same wallet", async () => {
      const b = await bootstrap();
      await claimOldHolder(b, 0);
      await expectFailure(claimOldHolder(b, 0), "already in use");
    });

    it("rejects a claim for the wrong amount", async () => {
      const b = await bootstrap();
      const holder = b.oldHolders[0];
      const dest = await createTokenAccount(b.env, holder.keypair.publicKey);
      const inflated = holder.amount + 1n;
      await expectFailure(
        b.env.program.methods
          .claimOldHolder(new BN(inflated.toString()), proofArrays(b.oldTree, holder.keypair.publicKey, holder.amount))
          .accountsPartial({
            claimant: holder.keypair.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            receipt: PublicKey.findProgramAddressSync(
              [Buffer.from("old_claim"), holder.keypair.publicKey.toBuffer()],
              b.env.programId
            )[0],
            vault: b.env.vaultPda,
            destination: dest,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([holder.keypair])
          .rpc(),
        "InvalidMerkleProof"
      );
    });

    it("rejects a wallet that is not in the tree", async () => {
      const b = await bootstrap();
      const intruder = Keypair.generate();
      await fundSol(b.env, intruder.publicKey, LAMPORTS_PER_SOL);
      const dest = await createTokenAccount(b.env, intruder.publicKey);
      await expectFailure(
        b.env.program.methods
          .claimOldHolder(new BN(1000), [])
          .accountsPartial({
            claimant: intruder.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            receipt: PublicKey.findProgramAddressSync(
              [Buffer.from("old_claim"), intruder.publicKey.toBuffer()],
              b.env.programId
            )[0],
            vault: b.env.vaultPda,
            destination: dest,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([intruder])
          .rpc(),
        "InvalidMerkleProof"
      );
    });

    it("closes after 30 days and sweeps the remainder into bucket 1", async () => {
      const b = await bootstrap();
      await claimOldHolder(b, 0); // 60% claimed; 40% should be swept

      await warpBy(b.env.context, 30 * DAY + 1);
      await expectFailure(claimOldHolder(b, 1), "ClaimWindowClosed");

      const before = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      await b.env.program.methods
        .sweepOldHolders()
        .accountsPartial({ cranker: b.env.payer.publicKey, config: b.env.configPda, pool: b.env.poolPda })
        .signers([b.env.payer])
        .rpc();
      const after = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);

      const expectedSweep = OLD_ALLOC - b.oldHolders[0].amount;
      assert.equal(
        (BigInt(after.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        expectedSweep.toString()
      );
    });

    it("refuses to sweep before the deadline", async () => {
      const b = await bootstrap();
      await expectFailure(
        b.env.program.methods
          .sweepOldHolders()
          .accountsPartial({ cranker: b.env.payer.publicKey, config: b.env.configPda, pool: b.env.poolPda })
          .signers([b.env.payer])
          .rpc(),
        "SweepTooEarly"
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 3 — influencers", () => {
    async function claimInfluencer(b: Bootstrapped, index: number) {
      const inf = b.influencers[index];
      await b.env.program.methods
        .claimInfluencer(new BN(inf.amount.toString()), proofArrays(b.infTree, inf.keypair.publicKey, inf.amount))
        .accountsPartial({
          claimant: inf.keypair.publicKey,
          config: b.env.configPda,
          receipt: PublicKey.findProgramAddressSync(
            [Buffer.from("inf_claim"), inf.keypair.publicKey.toBuffer()],
            b.env.programId
          )[0],
          stream: streamPda(inf.keypair.publicKey, b.env.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([inf.keypair])
        .rpc();
    }

    it("opens a 30-day stream rather than transferring immediately", async () => {
      const b = await bootstrap();
      const inf = b.influencers[0];
      const dest = await createTokenAccount(b.env, inf.keypair.publicKey);
      await claimInfluencer(b, 0);

      assert.equal((await tokenBalance(b.env, dest)).toString(), "0", "nothing should transfer on claim");

      const stream = await (b.env.program.account as any).stream.fetch(streamPda(inf.keypair.publicKey, b.env.programId));
      assert.equal(stream.total.toString(), inf.amount.toString());
      assert.equal(Number(stream.end) - Number(stream.start), 30 * DAY);
    });

    it("vests linearly and pays out the full amount by the end", async () => {
      const b = await bootstrap();
      const inf = b.influencers[0];
      const dest = await createTokenAccount(b.env, inf.keypair.publicKey);
      await claimInfluencer(b, 0);

      const withdraw = () =>
        b.env.program.methods
          .streamWithdraw()
          .accountsPartial({
            beneficiary: inf.keypair.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            stream: streamPda(inf.keypair.publicKey, b.env.programId),
            vault: b.env.vaultPda,
            destination: dest,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([inf.keypair])
          .rpc();

      await warpBy(b.env.context, 15 * DAY);
      await withdraw();
      const half = await tokenBalance(b.env, dest);
      const expectedHalf = inf.amount / 2n;
      const drift = half > expectedHalf ? half - expectedHalf : expectedHalf - half;
      assert.isBelow(Number(drift), Number(inf.amount / 1000n), "halfway payout should be ~50%");

      await warpBy(b.env.context, 20 * DAY);
      await withdraw();
      assert.equal((await tokenBalance(b.env, dest)).toString(), inf.amount.toString());

      await advanceSlot(b.env.context);
      await expectFailure(withdraw(), "NothingToWithdraw");
    });

    it("closes after 72 hours and sweeps the unclaimed remainder to bucket 1", async () => {
      const b = await bootstrap();
      await claimInfluencer(b, 0);

      await warpBy(b.env.context, 3 * DAY + 1);
      await expectFailure(claimInfluencer(b, 1), "ClaimWindowClosed");

      const before = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      await b.env.program.methods
        .sweepInfluencers()
        .accountsPartial({ cranker: b.env.payer.publicKey, config: b.env.configPda, pool: b.env.poolPda })
        .signers([b.env.payer])
        .rpc();
      const after = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);

      assert.equal(
        (BigInt(after.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        b.influencers[1].amount.toString(),
        "the influencer who never showed up funds the community"
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 4 — founders", () => {
    it("honours the dev cliff, then streams over 12 months", async () => {
      const b = await bootstrap();
      await b.env.program.methods
        .createDevStream(new BN(30 * DAY))
        .accountsPartial({
          payer: b.env.payer.publicKey,
          config: b.env.configPda,
          stream: streamPda(b.devWallet.publicKey, b.env.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();

      const dest = await createTokenAccount(b.env, b.devWallet.publicKey);
      const withdraw = () =>
        b.env.program.methods
          .streamWithdraw()
          .accountsPartial({
            beneficiary: b.devWallet.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            stream: streamPda(b.devWallet.publicKey, b.env.programId),
            vault: b.env.vaultPda,
            destination: dest,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([b.devWallet])
          .rpc();

      await warpBy(b.env.context, 20 * DAY);
      await expectFailure(withdraw(), "NothingToWithdraw");

      await warpBy(b.env.context, 20 * DAY); // now day 40, past the 30-day cliff
      await withdraw();
      const paid = await tokenBalance(b.env, dest);
      assert.isAbove(Number(paid), 0, "should release after the cliff");
      assert.isBelow(Number(paid), Number(DEV_ALLOC / 5n), "only ~40/365 should have vested");
    });

    it("lets the 2014 signer prove ownership and open a 12-month stream", async () => {
      const b = await bootstrap();
      const destinationOwner = Keypair.generate();
      await fundSol(b.env, destinationOwner.publicKey, LAMPORTS_PER_SOL);

      const { header, signature } = signBitcoinMessage(b.btcKey, signerClaimMessage(destinationOwner.publicKey));

      await b.env.program.methods
        .claimOriginalSigner(destinationOwner.publicKey, header, Array.from(signature))
        .accountsPartial({
          payer: b.env.payer.publicKey,
          config: b.env.configPda,
          stream: streamPda(destinationOwner.publicKey, b.env.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();

      const stream = await (b.env.program.account as any).stream.fetch(streamPda(destinationOwner.publicKey, b.env.programId));
      assert.equal(stream.total.toString(), SIGNER_ALLOC.toString());
      assert.equal(Number(stream.end) - Number(stream.start), 365 * DAY);

      const dest = await createTokenAccount(b.env, destinationOwner.publicKey);
      await warpBy(b.env.context, 365 * DAY + 1);
      await b.env.program.methods
        .streamWithdraw()
        .accountsPartial({
          beneficiary: destinationOwner.publicKey,
          config: b.env.configPda,
            pool: b.env.poolPda,
          stream: streamPda(destinationOwner.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          destination: dest,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([destinationOwner])
        .rpc();
      assert.equal((await tokenBalance(b.env, dest)).toString(), SIGNER_ALLOC.toString());
    });

    it("accepts the compressed-key header form too", async () => {
      const b = await bootstrap();
      const destinationOwner = Keypair.generate();
      const { header, signature } = signBitcoinMessage(
        b.btcKey,
        signerClaimMessage(destinationOwner.publicKey),
        true
      );
      await b.env.program.methods
        .claimOriginalSigner(destinationOwner.publicKey, header, Array.from(signature))
        .accountsPartial({
          payer: b.env.payer.publicKey,
          config: b.env.configPda,
          stream: streamPda(destinationOwner.publicKey, b.env.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();
      const stream = await (b.env.program.account as any).stream.fetch(streamPda(destinationOwner.publicKey, b.env.programId));
      assert.equal(stream.total.toString(), SIGNER_ALLOC.toString());
    });

    it("cannot be replayed to a different destination", async () => {
      const b = await bootstrap();
      const intended = Keypair.generate();
      const attacker = Keypair.generate();
      const { header, signature } = signBitcoinMessage(b.btcKey, signerClaimMessage(intended.publicKey));

      // The signature is valid, but it authorises `intended` and nothing else.
      await expectFailure(
        b.env.program.methods
          .claimOriginalSigner(attacker.publicKey, header, Array.from(signature))
          .accountsPartial({
            payer: b.env.payer.publicKey,
            config: b.env.configPda,
            stream: streamPda(attacker.publicKey, b.env.programId),
            systemProgram: SystemProgram.programId,
          })
          .signers([b.env.payer])
          .rpc(),
        "SignerMismatch"
      );
    });

    it("rejects a signature from any other key", async () => {
      const b = await bootstrap();
      const impostor = makeBitcoinKey();
      const destinationOwner = Keypair.generate();
      const { header, signature } = signBitcoinMessage(impostor, signerClaimMessage(destinationOwner.publicKey));

      await expectFailure(
        b.env.program.methods
          .claimOriginalSigner(destinationOwner.publicKey, header, Array.from(signature))
          .accountsPartial({
            payer: b.env.payer.publicKey,
            config: b.env.configPda,
            stream: streamPda(destinationOwner.publicKey, b.env.programId),
            systemProgram: SystemProgram.programId,
          })
          .signers([b.env.payer])
          .rpc(),
        "SignerMismatch"
      );
    });

    it("returns the allocation to the community after the 2030 deadline", async () => {
      const b = await bootstrap();
      await warpTo(b.env.context, ORIGINAL_SIGNER_DEADLINE + 10);

      const destinationOwner = Keypair.generate();
      const { header, signature } = signBitcoinMessage(b.btcKey, signerClaimMessage(destinationOwner.publicKey));
      await expectFailure(
        b.env.program.methods
          .claimOriginalSigner(destinationOwner.publicKey, header, Array.from(signature))
          .accountsPartial({
            payer: b.env.payer.publicKey,
            config: b.env.configPda,
            stream: streamPda(destinationOwner.publicKey, b.env.programId),
            systemProgram: SystemProgram.programId,
          })
          .signers([b.env.payer])
          .rpc(),
        "ClaimWindowClosed"
      );

      const before = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      await b.env.program.methods
        .sweepOriginalSigner()
        .accountsPartial({ cranker: b.env.payer.publicKey, config: b.env.configPda, pool: b.env.poolPda })
        .signers([b.env.payer])
        .rpc();
      const after = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);

      assert.equal(
        (BigInt(after.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        SIGNER_ALLOC.toString()
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 1 — staking, base/boost split", () => {
    it("pays base immediately and escrows the boost for a locked tier", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.ThreeMonth); // 2.0x

      const donor = await makeStaker(b.env, 600n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 600n * UNIT);

      // Sole staker with weight 2000 receives the entire 600. Base is the
      // amount x 1.0 share (300), boost is the remainder (300).
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([staker])
        .rpc();

      assert.equal((await tokenBalance(b.env, acct)).toString(), (300n * UNIT).toString(), "base half paid out");

      const pos = await (b.env.program.account as any).stakePosition.fetch(stakePda(staker.publicKey, b.env.programId));
      assert.equal(pos.escrowToken.toString(), (300n * UNIT).toString(), "boost half escrowed");
    });

    it("refuses to release the boost escrow before maturity, and releases it after", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.ThreeMonth);

      const donor = await makeStaker(b.env, 600n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 600n * UNIT);

      const withdrawEscrow = () =>
        b.env.program.methods
          .withdrawBoostEscrow()
          .accountsPartial({
            owner: staker.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            position: stakePda(staker.publicKey, b.env.programId),
            vault: b.env.vaultPda,
            solVault: b.env.solVaultPda,
            destination: acct,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([staker])
          .rpc();

      await expectFailure(withdrawEscrow(), "EscrowNotMatured");

      await warpBy(b.env.context, 90 * DAY + 1);
      await withdrawEscrow();
      const pos = await (b.env.program.account as any).stakePosition.fetch(stakePda(staker.publicKey, b.env.programId));
      assert.equal(pos.escrowToken.toString(), "0");
    });

    it("forfeits the whole boost escrow even when rewards are claimed first — the claim-then-exit attack", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const attacker = await makeStaker(b.env, 1_000n * UNIT);
      const loyal = await makeStaker(b.env, 1_000n * UNIT);

      await stake(b.env, attacker.staker, attacker.acct, 1_000n * UNIT, Tier.TwelveMonth); // 3.0x
      await stake(b.env, loyal.staker, loyal.acct, 1_000n * UNIT, Tier.Flexible); // 1.0x

      const donor = await makeStaker(b.env, 4_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 4_000n * UNIT);

      // Attacker drains everything claimable, then immediately breaks the lock.
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: attacker.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(attacker.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: attacker.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker.staker])
        .rpc();

      const afterClaim = await tokenBalance(b.env, attacker.acct);
      const posBefore = await (b.env.program.account as any).stakePosition.fetch(
        stakePda(attacker.staker.publicKey, b.env.programId)
      );
      const escrowed = BigInt(posBefore.escrowToken.toString());
      assert.isAbove(Number(escrowed), 0, "boost must have accrued");

      const poolBefore = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);

      await b.env.program.methods
        .emergencyExit()
        .accountsPartial({
          owner: attacker.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(attacker.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: attacker.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker.staker])
        .rpc();

      const finalBalance = await tokenBalance(b.env, attacker.acct);
      const principalReturned = finalBalance - afterClaim;
      const expectedPrincipal = (1_000n * UNIT * 90n) / 100n; // 10% slashed

      assert.equal(
        principalReturned.toString(),
        expectedPrincipal.toString(),
        "attacker gets 90% of principal and not one unit of the escrow"
      );

      const poolAfter = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      const redistributed =
        BigInt(poolAfter.lifetimeTokenRewards.toString()) - BigInt(poolBefore.lifetimeTokenRewards.toString());
      const expectedRedistribution = escrowed + (1_000n * UNIT) / 10n;
      assert.equal(
        redistributed.toString(),
        expectedRedistribution.toString(),
        "forfeited boost plus the slash both flow back to bucket 1"
      );
    });

    it("gives the forfeited amount to the stakers who stayed, not the one who left", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const quitter = await makeStaker(b.env, 1_000n * UNIT);
      const loyal = await makeStaker(b.env, 1_000n * UNIT);

      await stake(b.env, quitter.staker, quitter.acct, 1_000n * UNIT, Tier.TwelveMonth);
      await stake(b.env, loyal.staker, loyal.acct, 1_000n * UNIT, Tier.Flexible);

      const donor = await makeStaker(b.env, 4_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 4_000n * UNIT);

      await b.env.program.methods
        .emergencyExit()
        .accountsPartial({
          owner: quitter.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(quitter.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: quitter.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([quitter.staker])
        .rpc();

      // The loyal staker is now the only weight in the pool, so every forfeited
      // unit lands on them.
      const before = await tokenBalance(b.env, loyal.acct);
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: loyal.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(loyal.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: loyal.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([loyal.staker])
        .rpc();
      const gained = (await tokenBalance(b.env, loyal.acct)) - before;

      // 1/4 of the original 4000 (weight 1000 of 4000) plus the entire forfeit.
      assert.isAbove(Number(gained), Number(1_000n * UNIT), "loyal staker collects their share plus the forfeit");
    });

    it("escrows nothing for the flexible tier and enforces the cooldown", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.Flexible);

      const donor = await makeStaker(b.env, 500n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 500n * UNIT);

      const positionPda = stakePda(staker.publicKey, b.env.programId);
      const doUnstake = () =>
        b.env.program.methods
          .unstake(new BN((1_000n * UNIT).toString()))
          .accountsPartial({
            owner: staker.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            position: positionPda,
            vault: b.env.vaultPda,
            solVault: b.env.solVaultPda,
            destination: acct,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([staker])
          .rpc();

      await expectFailure(doUnstake(), "NoUnstakeRequested");

      await b.env.program.methods
        .requestUnstake()
        .accountsPartial({ owner: staker.publicKey, position: positionPda })
        .signers([staker])
        .rpc();

      await expectFailure(doUnstake(), "CooldownActive");

      await warpBy(b.env.context, 3 * DAY + 1);
      await doUnstake();

      // Flexible weight equals the amount, so the whole 500 was base — nothing
      // was ever escrowed.
      const pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.equal(pos.escrowToken.toString(), "0");
      assert.equal((await tokenBalance(b.env, acct)).toString(), (1_500n * UNIT).toString());
    });

    it("refuses to break an emergency exit out of a flexible position", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 100n * UNIT);
      await stake(b.env, staker, acct, 100n * UNIT, Tier.Flexible);

      await expectFailure(
        b.env.program.methods
          .emergencyExit()
          .accountsPartial({
            owner: staker.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            position: stakePda(staker.publicKey, b.env.programId),
            vault: b.env.vaultPda,
            solVault: b.env.solVaultPda,
            destination: acct,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([staker])
          .rpc(),
        "NotLocked"
      );
    });

    it("rejects a tier downgrade on top-up", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 200n * UNIT);
      await stake(b.env, staker, acct, 100n * UNIT, Tier.ThreeMonth);
      await expectFailure(stake(b.env, staker, acct, 100n * UNIT, Tier.OneMonth), "InvalidTier");
    });

    it("weights rewards by tier across concurrent stakers", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const flex = await makeStaker(b.env, 1_000n * UNIT);
      const locked = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, flex.staker, flex.acct, 1_000n * UNIT, Tier.Flexible); // weight 1000
      await stake(b.env, locked.staker, locked.acct, 1_000n * UNIT, Tier.TwelveMonth); // weight 3000

      const donor = await makeStaker(b.env, 4_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 4_000n * UNIT);

      const flexPos = await (b.env.program.account as any).stakePosition.fetch(stakePda(flex.staker.publicKey, b.env.programId));
      const lockedPos = await (b.env.program.account as any).stakePosition.fetch(
        stakePda(locked.staker.publicKey, b.env.programId)
      );
      // Settlement is lazy, so read the pool accumulator and compute expectations.
      const pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.totalWeight.toString(), (4_000n * UNIT).toString());

      // Flexible: 1/4 of 4000 = 1000, all of it base.
      // Locked:   3/4 of 4000 = 3000, of which 1000 base and 2000 boost.
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: flex.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(flex.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: flex.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([flex.staker])
        .rpc();
      assert.equal((await tokenBalance(b.env, flex.acct)).toString(), (1_000n * UNIT).toString());

      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: locked.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(locked.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: locked.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([locked.staker])
        .rpc();
      assert.equal(
        (await tokenBalance(b.env, locked.acct)).toString(),
        (1_000n * UNIT).toString(),
        "locked staker's immediately-claimable part equals the 1.0x base"
      );
      const lockedAfter = await (b.env.program.account as any).stakePosition.fetch(
        stakePda(locked.staker.publicKey, b.env.programId)
      );
      assert.equal(lockedAfter.escrowToken.toString(), (2_000n * UNIT).toString(), "the 2.0x boost is escrowed");
    });

    it("buffers rewards that arrive with nobody staked, then flushes them", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const donor = await makeStaker(b.env, 1_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 1_000n * UNIT);

      let pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.pendingTokenRewards.toString(), (1_000n * UNIT).toString(), "buffered, not dropped");
      assert.equal(pool.accTokenPerWeight.toString(), "0");

      const { staker, acct } = await makeStaker(b.env, 500n * UNIT);
      await stake(b.env, staker, acct, 500n * UNIT, Tier.Flexible);

      await b.env.program.methods
        .flushPending()
        .accountsPartial({ pool: b.env.poolPda })
        .rpc();

      pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.pendingTokenRewards.toString(), "0");
      assert.isAbove(Number(pool.accTokenPerWeight.toString()), 0);
    });

    it("distributes SOL rewards alongside token rewards", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.Flexible);

      const lamports = 2 * LAMPORTS_PER_SOL;
      await b.env.program.methods
        .notifySolRewards(new BN(lamports))
        .accountsPartial({
          depositor: b.env.payer.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          solVault: b.env.solVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();

      const before = await solBalance(b.env, staker.publicKey);
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([staker])
        .rpc();
      const after = await solBalance(b.env, staker.publicKey);
      assert.isAbove(Number(after - before), lamports * 0.9, "flexible sole staker receives the SOL rewards");
    });
  });
  // -----------------------------------------------------------------------
  describe("sync — funds that arrive from outside", () => {
    // Value can be credited to an account without this program's involvement:
    // a pump.fun fee distribution, a donation to an address we publish, a
    // mistake. `notify_*` cannot book those, because it only credits what it
    // transfers itself. Without `sync_*` they would be visible, unowned and —
    // the program being immutable — frozen for good.

    const syncSol = (b: Bootstrapped) =>
      b.env.program.methods
        .syncSolRewards()
        .accountsPartial({
          config: b.env.configPda,
          pool: b.env.poolPda,
          solVault: b.env.solVaultPda,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

    const syncToken = (b: Bootstrapped) =>
      b.env.program.methods
        .syncTokenRewards()
        .accountsPartial({
          config: b.env.configPda,
          pool: b.env.poolPda,
          vault: b.env.vaultPda,
        })
        .rpc();

    it("ignores lamports sent directly, until someone syncs them", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.Flexible);

      const gift = 3 * LAMPORTS_PER_SOL;
      await airdropTo(b.env, b.env.solVaultPda, gift);

      let pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.lifetimeSolRewards.toString(), "0", "not credited on arrival");

      await syncSol(b);

      pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(
        pool.lifetimeSolRewards.toString(),
        gift.toString(),
        "sync credits exactly what was untracked"
      );

      // And it is genuinely payable, not just booked.
      const before = await solBalance(b.env, staker.publicKey);
      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([staker])
        .rpc();
      assert.isAbove(Number((await solBalance(b.env, staker.publicKey)) - before), gift * 0.9);
    });

    it("refuses to sync when nothing is untracked", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      await expectFailure(syncSol(b), "NothingToWithdraw");
      await expectFailure(syncToken(b), "NothingToWithdraw");
    });

    it("never counts the rent-exempt floor as a reward", async () => {
      const b = await bootstrap();
      // The vault is funded to rent exemption at init and nothing more.
      await expectFailure(syncSol(b), "NothingToWithdraw");
    });

    it("ignores tokens sent directly, until someone syncs them", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.Flexible);

      // fundExtra was deposited through fund_vault, so it is already reserved.
      await expectFailure(syncToken(b), "NothingToWithdraw");

      const gift = 500n * UNIT;
      await mintTo(b.env, b.env.vaultPda, gift);

      let pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.lifetimeTokenRewards.toString(), "0");

      // The failed sync above is byte-identical to this one and still landed,
      // so without a new slot the bank rejects this as already-processed and
      // the program is never entered.
      await advanceSlot(b.env.context);
      await syncToken(b);

      pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(pool.lifetimeTokenRewards.toString(), gift.toString());
    });

    it("buffers a sync that lands while nobody is staked", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      await airdropTo(b.env, b.env.solVaultPda, 2 * LAMPORTS_PER_SOL);
      await syncSol(b);

      const pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(
        pool.pendingSolRewards.toString(),
        (2 * LAMPORTS_PER_SOL).toString(),
        "held for the first stakers rather than dropped"
      );
      assert.equal(pool.accSolPerWeight.toString(), "0");
    });

    it("unwraps vault-held wrapped SOL and credits it", async () => {
      // What pump.fun pays into once a coin graduates to the AMM. Without this
      // the vault could receive fees it was structurally unable to distribute.
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT, Tier.Flexible);

      const wrapped = BigInt(4 * LAMPORTS_PER_SOL);
      const wsol = await createWrappedSolAccount(b.env, b.env.solVaultPda, wrapped);

      await b.env.program.methods
        .unwrapWsol()
        .accountsPartial({
          config: b.env.configPda,
          pool: b.env.poolPda,
          solVault: b.env.solVaultPda,
          wsolAccount: wsol,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.isAtLeast(
        Number(pool.lifetimeSolRewards.toString()),
        Number(wrapped),
        "the wrapped balance became credited rewards"
      );
      assert.isNull(
        await b.env.context.banksClient.getAccount(wsol),
        "the wSOL account is closed"
      );
    });

    it("rejects a wSOL account the vault does not own", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const stranger = Keypair.generate();
      const wsol = await createWrappedSolAccount(b.env, stranger.publicKey, 1_000_000n);

      await expectFailure(
        b.env.program.methods
          .unwrapWsol()
          .accountsPartial({
            config: b.env.configPda,
            pool: b.env.poolPda,
            solVault: b.env.solVaultPda,
            wsolAccount: wsol,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc(),
        "InvalidWsolAccount"
      );
    });

    it("keeps the counters untouched when a forfeit is only reclassified", async () => {
      // emergency_exit moves value between owners without moving it out of the
      // vault. If that touched the counters, a later sync would double-count.
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const quitter = await makeStaker(b.env, 1_000n * UNIT);
      const loyal = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, quitter.staker, quitter.acct, 1_000n * UNIT, Tier.TwelveMonth);
      await stake(b.env, loyal.staker, loyal.acct, 1_000n * UNIT, Tier.Flexible);

      const donor = await makeStaker(b.env, 4_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 4_000n * UNIT);

      await b.env.program.methods
        .emergencyExit()
        .accountsPartial({
          owner: quitter.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(quitter.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: quitter.acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([quitter.staker])
        .rpc();

      // The slash and forfeited boost stayed in the vault and are already
      // reserved, so there is nothing for a sync to find.
      await expectFailure(syncToken(b), "NothingToWithdraw");
    });

    it("holds the invariant: vault balances never fall below what is reserved", async () => {
      const b = await bootstrap({ fundExtra: 50_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 2_000n * UNIT);
      await stake(b.env, staker, acct, 2_000n * UNIT, Tier.ThreeMonth);

      const donor = await makeStaker(b.env, 3_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 3_000n * UNIT);
      await claimOldHolder(b, 0);

      await b.env.program.methods
        .claimRewards()
        .accountsPartial({
          owner: staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          solVault: b.env.solVaultPda,
          destination: acct,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([staker])
        .rpc();

      const pool = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      const vaultTokens = await tokenBalance(b.env, b.env.vaultPda);
      const vaultLamports = await solBalance(b.env, b.env.solVaultPda);

      assert.isTrue(
        vaultTokens >= BigInt(pool.reservedToken.toString()),
        `token vault ${vaultTokens} < reserved ${pool.reservedToken}`
      );
      assert.isTrue(
        vaultLamports >= BigInt(pool.reservedSol.toString()),
        `sol vault ${vaultLamports} < reserved ${pool.reservedSol}`
      );
    });
  });
});
