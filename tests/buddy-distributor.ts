import * as anchor from "@coral-xyz/anchor";
// See tests/helpers.ts: named imports from this CJS package break on Node 22.18+.
const { BN } = anchor;
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { buildTree, hashLeaf, MerkleTree } from "../scripts/merkle";
import {
  advanceSlot,
  airdropTo,
  createMint,
  createWrappedSolAccount,
  DAY,
  Env,
  LOCK_DURATION,
  ORIGINAL_SIGNER_DEADLINE,
  Tier,
  UNSTAKE_COOLDOWN,
  createTokenAccount,
  expectFailure,
  fundSol,
  lockupCounterPda,
  lockupPda,
  makeBitcoinKey,
  mintTo,
  setupEnv,
  signBitcoinMessage,
  signerClaimMessage,
  solBalance,
  NATIVE_MINT,
  REWARD_TOKEN_PROGRAM,
  stakePda,
  streamPda,
  communityStreamPda,
  tokenBalance,
  warpBy,
  warpTo,
} from "./helpers";

const UNIT = 1_000_000n; // 6 decimals

// Mirrors EMERGENCY_EXIT_SLASH_BPS in programs/buddy-distributor/src/constants.rs.
// Kept as a named constant because two separate assertions depend on it, and
// hard-coding the fraction meant changing the slash silently broke the suite.
const EMERGENCY_EXIT_SLASH_BPS = 1_500n; // 15%
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
      tokenProgram: REWARD_TOKEN_PROGRAM,
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
      rewardMint: env.mint,
      tokenProgram: REWARD_TOKEN_PROGRAM,
    })
    .signers([env.authority])
    .rpc();

  if (lock) {
    await env.program.methods
      .lockConfig()
      .accountsPartial({
        authority: env.authority.publicKey,
        config: env.configPda,
        pool: env.poolPda,
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
      rewardMint: env.mint,
      tokenProgram: REWARD_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .signers([holder.keypair])
    .rpc();
  return dest;
}

/** Flexible staking: one position per wallet, no tier argument, 1.0x always. */
async function stake(env: Env, staker: Keypair, source: PublicKey, amount: bigint) {
  await env.program.methods
    .stake(new BN(amount.toString()))
    .accountsPartial({
      owner: staker.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      position: stakePda(staker.publicKey, env.programId),
      vault: env.vaultPda,
      source,
      rewardMint: env.mint,
      tokenProgram: REWARD_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .signers([staker])
    .rpc();
}

/** Open a lockup at a locked tier. `index` must equal the counter's count. */
async function lockTokens(
  env: Env,
  owner: Keypair,
  source: PublicKey,
  amount: bigint,
  tier: number,
  index: number,
) {
  await env.program.methods
    .lockTokens(new BN(amount.toString()), tier, new BN(index))
    .accountsPartial({
      owner: owner.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      counter: lockupCounterPda(owner.publicKey, env.programId),
      lockup: lockupPda(owner.publicKey, index, env.programId),
      vault: env.vaultPda,
      source,
      rewardMint: env.mint,
      tokenProgram: REWARD_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner])
    .rpc();
}

/** The account set shared by unstake / claim_rewards on a flexible position. */
function positionAccounts(env: Env, owner: Keypair, destination: PublicKey) {
  return {
    owner: owner.publicKey,
    config: env.configPda,
    pool: env.poolPda,
    position: stakePda(owner.publicKey, env.programId),
    vault: env.vaultPda,
    solVault: env.solVaultPda,
    destination,
    rewardMint: env.mint,
    tokenProgram: REWARD_TOKEN_PROGRAM,
    rent: SYSVAR_RENT_PUBKEY,
  };
}

/** The account set shared by claim/unlock/emergency-exit on one lockup. */
function lockupAccounts(env: Env, owner: Keypair, index: number, destination: PublicKey) {
  return {
    owner: owner.publicKey,
    config: env.configPda,
    pool: env.poolPda,
    lockup: lockupPda(owner.publicKey, index, env.programId),
    vault: env.vaultPda,
    solVault: env.solVaultPda,
    destination,
    rewardMint: env.mint,
    tokenProgram: REWARD_TOKEN_PROGRAM,
    rent: SYSVAR_RENT_PUBKEY,
  };
}

async function claimRewards(env: Env, owner: Keypair, destination: PublicKey) {
  await env.program.methods
    .claimRewards()
    .accountsPartial(positionAccounts(env, owner, destination))
    .signers([owner])
    .rpc();
}

async function claimLockupRewards(env: Env, owner: Keypair, index: number, destination: PublicKey) {
  await env.program.methods
    .claimLockupRewards()
    .accountsPartial(lockupAccounts(env, owner, index, destination))
    .signers([owner])
    .rpc();
}

async function unlockTokens(env: Env, owner: Keypair, index: number, destination: PublicKey) {
  await env.program.methods
    .unlockTokens()
    .accountsPartial(lockupAccounts(env, owner, index, destination))
    .signers([owner])
    .rpc();
}

async function emergencyExitLockup(env: Env, owner: Keypair, index: number, destination: PublicKey) {
  await env.program.methods
    .emergencyExitLockup()
    .accountsPartial(lockupAccounts(env, owner, index, destination))
    .signers([owner])
    .rpc();
}

/** Permissionless demote of a matured lockup; `cranker` may be anyone. */
async function demoteMatured(env: Env, cranker: Keypair, owner: PublicKey, index: number) {
  await env.program.methods
    .demoteMatured()
    .accountsPartial({
      cranker: cranker.publicKey,
      config: env.configPda,
      pool: env.poolPda,
      lockup: lockupPda(owner, index, env.programId),
    })
    .signers([cranker])
    .rpc();
}

async function fetchLockup(env: Env, owner: PublicKey, index: number) {
  return (env.program.account as any).lockup.fetch(lockupPda(owner, index, env.programId));
}

async function fetchPool(env: Env) {
  return (env.program.account as any).stakePool.fetch(env.poolPda);
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
      rewardMint: env.mint,
      tokenProgram: REWARD_TOKEN_PROGRAM,
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
          tokenProgram: REWARD_TOKEN_PROGRAM,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([env.payer])
        .rpc();

      await expectFailure(
        env.program.methods
          .lockConfig()
          .accountsPartial({ authority: env.authority.publicKey, config: env.configPda, pool: env.poolPda, vault: env.vaultPda })
          .signers([env.authority])
          .rpc(),
        "InsufficientBucketBalance"
      );
    });

    it("refuses to lock when tokens arrived outside fund_vault, even though the vault balance looks right", async () => {
      // The realistic version of this is not fraud, it is a slip: someone
      // sends the last tranche to the published vault address with an
      // ordinary wallet transfer, or a supporter donates before launch. The
      // balance then reads exactly right while `reserved_token` is short.
      //
      // Locking there would be unrecoverable. `fund_vault` asserts the config
      // is unlocked, so no top-up is ever possible again, and the untracked
      // remainder is destined for the staking pool via `sync_token_rewards`,
      // which would hand the same tokens to stakers that the buckets are
      // already promising to claimants.
      const env = await setupEnv();
      await warpTo(env.context, BASE_TS);
      const btcKey = makeBitcoinKey();
      const SHORTFALL = 5_000_000n;

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
          tokenProgram: REWARD_TOKEN_PROGRAM,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([env.payer])
        .rpc();

      // Short by SHORTFALL through the front door.
      const treasury = await createTokenAccount(env, env.authority.publicKey);
      await mintTo(env, treasury, OLD_ALLOC);
      await env.program.methods
        .fundVault(new BN((OLD_ALLOC - SHORTFALL).toString()))
        .accountsPartial({
          authority: env.authority.publicKey,
          config: env.configPda,
          vault: env.vaultPda,
          pool: env.poolPda,
          source: treasury,
          rewardMint: env.mint,
          tokenProgram: REWARD_TOKEN_PROGRAM,
        })
        .signers([env.authority])
        .rpc();

      // ...and made up the difference by transferring straight to the vault.
      await mintTo(env, env.vaultPda, SHORTFALL);

      const vault = await tokenBalance(env, env.vaultPda);
      const pool = await (env.program.account as any).stakePool.fetch(env.poolPda);
      assert.equal(vault.toString(), OLD_ALLOC.toString(), "balance is exactly the committed total");
      assert.equal(pool.reservedToken.toString(), (OLD_ALLOC - SHORTFALL).toString());

      await expectFailure(
        env.program.methods
          .lockConfig()
          .accountsPartial({
            authority: env.authority.publicKey,
            config: env.configPda,
            pool: env.poolPda,
            vault: env.vaultPda,
          })
          .signers([env.authority])
          .rpc(),
        "InsufficientBucketBalance"
      );

      // Routing the same shortfall through fund_vault clears it. The donated
      // tokens stay untracked and remain the staking pool's, which is the
      // whole point: they are counted once, not twice.
      await env.program.methods
        .fundVault(new BN(SHORTFALL.toString()))
        .accountsPartial({
          authority: env.authority.publicKey,
          config: env.configPda,
          vault: env.vaultPda,
          pool: env.poolPda,
          source: treasury,
          rewardMint: env.mint,
          tokenProgram: REWARD_TOKEN_PROGRAM,
        })
        .signers([env.authority])
        .rpc();

      await env.program.methods
        .lockConfig()
        .accountsPartial({
          authority: env.authority.publicKey,
          config: env.configPda,
          pool: env.poolPda,
          vault: env.vaultPda,
        })
        .signers([env.authority])
        .rpc();

      const locked = await (env.program.account as any).config.fetch(env.configPda);
      assert.equal(locked.locked, true);

      // The stray SHORTFALL is still untracked and still belongs to stakers.
      const after = await (env.program.account as any).stakePool.fetch(env.poolPda);
      const bal = BigInt((await tokenBalance(env, env.vaultPda)).toString());
      assert.equal((bal - BigInt(after.reservedToken.toString())).toString(), SHORTFALL.toString());
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
            rewardMint: b.env.mint,
            tokenProgram: REWARD_TOKEN_PROGRAM,
          })
          .signers([b.env.authority])
          .rpc(),
        "ConfigLocked"
      );
    });

    it("refuses to initialize from a caller who is not the upgrade authority", async () => {
      // The config PDA is a singleton with no re-create path, so a front-runner
      // who saw the freshly-deployed program id must not be able to seize it.
      // Only the program's upgrade authority (the deployer) may initialize.
      const env = await setupEnv();
      const attacker = Keypair.generate();
      await fundSol(env, attacker.publicKey, 5 * LAMPORTS_PER_SOL);
      const tree = buildTree([
        { address: attacker.publicKey.toBase58(), amount: "1" },
      ]).tree;
      await expectFailure(
        env.program.methods
          .initialize({
            oldHolderRoot: tree.rootArray,
            oldHolderAllocation: new BN(1),
            influencerRoot: tree.rootArray,
            influencerAllocation: new BN(1),
            originalSignerPubkey: Array.from(makeBitcoinKey().publicKeyXY),
            originalSignerAllocation: new BN(1),
            devWallet: attacker.publicKey,
            devAllocation: new BN(1),
            devCliffSeconds: new BN(0),
            claimsStart: new BN(BASE_TS),
          })
          .accountsPartial({
            payer: attacker.publicKey,
            authority: attacker.publicKey,
            rewardMint: env.mint,
            config: env.configPda,
            pool: env.poolPda,
            vault: env.vaultPda,
            solVault: env.solVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: REWARD_TOKEN_PROGRAM,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });

    it("refuses to stake, notify or sync before the config is locked", async () => {
      // The reserved_token counter lock_config trusts as a solvency proof must
      // be raisable only through fund_vault before the lock; otherwise staker
      // principal or a synced donation could pre-satisfy the check and freeze
      // an under-funded config.
      const b = await bootstrap({ lock: false });
      const { staker, acct } = await makeStaker(b.env, 10_000n * UNIT);
      await expectFailure(stake(b.env, staker, acct, 1_000n * UNIT), "ConfigNotLocked");
      await expectFailure(notifyTokens(b.env, staker, acct, 1_000n * UNIT), "ConfigNotLocked");
      // A direct transfer then a sync attempt: the sync is refused pre-lock too.
      await mintTo(b.env, b.env.vaultPda, 1_000n * UNIT);
      await expectFailure(
        b.env.program.methods
          .syncTokenRewards()
          .accountsPartial({ config: b.env.configPda, pool: b.env.poolPda, vault: b.env.vaultPda })
          .rpc(),
        "ConfigNotLocked"
      );
    });

    it("refuses to lock a config whose claim window has already closed", async () => {
      const b = await bootstrap({ lock: false });
      // Warp past the 72-hour influencer window before locking.
      await warpBy(b.env.context, 3 * DAY + 1);
      await expectFailure(
        b.env.program.methods
          .lockConfig()
          .accountsPartial({
            authority: b.env.authority.publicKey,
            config: b.env.configPda,
            pool: b.env.poolPda,
            vault: b.env.vaultPda,
          })
          .signers([b.env.authority])
          .rpc(),
        "ClaimWindowClosed"
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 2: old Buddy holders", () => {
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
            rewardMint: b.env.mint,
            tokenProgram: REWARD_TOKEN_PROGRAM,
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
            rewardMint: b.env.mint,
            tokenProgram: REWARD_TOKEN_PROGRAM,
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
  describe("bucket 3: influencers", () => {
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
            rewardMint: b.env.mint,
            tokenProgram: REWARD_TOKEN_PROGRAM,
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

    it("closes after 72 hours and streams the unclaimed remainder to bucket 1", async () => {
      const b = await bootstrap();
      await claimInfluencer(b, 0);

      await warpBy(b.env.context, 3 * DAY + 1);
      await expectFailure(claimInfluencer(b, 1), "ClaimWindowClosed");

      const csPda = communityStreamPda(0, b.env.programId);
      const before = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      await b.env.program.methods
        .sweepInfluencers()
        .accountsPartial({
          cranker: b.env.payer.publicKey,
          config: b.env.configPda,
          communityStream: csPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();
      const after = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);

      // The sweep itself pays the community nothing. Forfeiting a stream must
      // not turn it into a lump sum; the pool is only credited by the
      // release crank, on the schedule the influencer would have had.
      assert.equal(
        after.lifetimeTokenRewards.toString(),
        before.lifetimeTokenRewards.toString(),
        "sweeping alone must not credit the pool"
      );

      const cs = await (b.env.program.account as any).communityStream.fetch(csPda);
      assert.equal(cs.total.toString(), b.influencers[1].amount.toString());
      assert.equal(cs.released.toString(), "0");
      assert.equal(Number(cs.end) - Number(cs.start), 30 * DAY, "same 30-day schedule a claimant would have had");

      const release = () =>
        b.env.program.methods
          .releaseCommunityStream()
          .accountsPartial({
            cranker: b.env.payer.publicKey,
            pool: b.env.poolPda,
            communityStream: csPda,
          })
          .signers([b.env.payer])
          .rpc();

      // Nothing has vested in the same second the sweep ran.
      await advanceSlot(b.env.context);
      await expectFailure(release(), "NothingToWithdraw");

      // Half the schedule -> exactly half the tokens, credited to the pool.
      await warpBy(b.env.context, 15 * DAY);
      await release();
      const mid = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      const total = BigInt(cs.total.toString());
      assert.equal(
        (BigInt(mid.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        (total / 2n).toString(),
        "halfway through the schedule, half the forfeit has reached the pool"
      );

      // Past the end -> the remainder, and then never anything again.
      await warpBy(b.env.context, 16 * DAY);
      await release();
      const done = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(
        (BigInt(done.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        total.toString(),
        "the full forfeit arrives, exactly once"
      );
      const csFinal = await (b.env.program.account as any).communityStream.fetch(csPda);
      assert.equal(csFinal.released.toString(), csFinal.total.toString());

      await advanceSlot(b.env.context);
      await expectFailure(release(), "NothingToWithdraw");
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 4: founders", () => {
    it("gives a stranger the cliff fixed at init, not one of their choosing", async () => {
      // `create_dev_stream` is permissionless so the team cannot withhold
      // their own lockup. That is only safe while the terms are not the
      // caller's to pick. The cliff used to be an argument, which meant the
      // first caller in the gap between lock_config and this instruction
      // chose the team's vesting schedule, permanently and for everyone.
      const b = await bootstrap();
      const stranger = Keypair.generate();
      await fundSol(b.env, stranger.publicKey, LAMPORTS_PER_SOL);

      await b.env.program.methods
        .createDevStream()
        .accountsPartial({
          payer: stranger.publicKey,
          config: b.env.configPda,
          stream: streamPda(b.devWallet.publicKey, b.env.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc();

      const config = await (b.env.program.account as any).config.fetch(b.env.configPda);
      const stream = await (b.env.program.account as any).stream.fetch(
        streamPda(b.devWallet.publicKey, b.env.programId)
      );
      assert.equal(
        Number(stream.cliff) - Number(stream.start),
        Number(config.devCliffSeconds),
        "the cliff comes from the config, whoever paid for the account"
      );
      assert.equal(Number(config.devCliffSeconds), 30 * DAY);
      assert.equal(Number(stream.end) - Number(stream.start), 365 * DAY);
    });

    it("refuses a cliff longer than the stream itself", async () => {
      // A cliff past the end date would read as a lockup while withholding
      // everything until it passed, since `vested` returns zero before the
      // cliff no matter how much of the schedule has elapsed.
      const env = await setupEnv();
      await warpTo(env.context, BASE_TS);
      const btcKey = makeBitcoinKey();
      const init = (cliffSeconds: number) =>
        env.program.methods
          .initialize({
            oldHolderRoot: Array(32).fill(0),
            oldHolderAllocation: new BN(0),
            influencerRoot: Array(32).fill(0),
            influencerAllocation: new BN(0),
            originalSignerPubkey: Array.from(btcKey.publicKeyXY),
            originalSignerAllocation: new BN(0),
            devWallet: Keypair.generate().publicKey,
            devAllocation: new BN(DEV_ALLOC.toString()),
            devCliffSeconds: new BN(cliffSeconds),
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
            tokenProgram: REWARD_TOKEN_PROGRAM,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([env.payer])
          .rpc();

      await expectFailure(init(366 * DAY), "InvalidCliff");
      await expectFailure(init(-1), "InvalidCliff");

      // The boundary is allowed: a cliff exactly as long as the stream means
      // the whole allocation lands in one go at the end, which is strictly
      // harsher on the team than dripping and is theirs to choose.
      await init(365 * DAY);
      const config = await (env.program.account as any).config.fetch(env.configPda);
      assert.equal(Number(config.devCliffSeconds), 365 * DAY);
    });

    it("honours the dev cliff, then streams over 12 months", async () => {
      const b = await bootstrap();
      await b.env.program.methods
        .createDevStream()
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
            rewardMint: b.env.mint,
            tokenProgram: REWARD_TOKEN_PROGRAM,
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
          rewardMint: b.env.mint,
          tokenProgram: REWARD_TOKEN_PROGRAM,
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

      const csPda = communityStreamPda(1, b.env.programId);
      const before = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      await b.env.program.methods
        .sweepOriginalSigner()
        .accountsPartial({
          cranker: b.env.payer.publicKey,
          config: b.env.configPda,
          communityStream: csPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([b.env.payer])
        .rpc();
      const after = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(
        after.lifetimeTokenRewards.toString(),
        before.lifetimeTokenRewards.toString(),
        "the signer's forfeit streams; sweeping alone credits nothing"
      );

      // The signer would have received this over a year; the community does too.
      const cs = await (b.env.program.account as any).communityStream.fetch(csPda);
      assert.equal(cs.total.toString(), SIGNER_ALLOC.toString());
      assert.equal(Number(cs.end) - Number(cs.start), 365 * DAY);

      await warpBy(b.env.context, 365 * DAY + 1);
      await b.env.program.methods
        .releaseCommunityStream()
        .accountsPartial({
          cranker: b.env.payer.publicKey,
          pool: b.env.poolPda,
          communityStream: csPda,
        })
        .signers([b.env.payer])
        .rpc();
      const released = await (b.env.program.account as any).stakePool.fetch(b.env.poolPda);
      assert.equal(
        (BigInt(released.lifetimeTokenRewards.toString()) - BigInt(before.lifetimeTokenRewards.toString())).toString(),
        SIGNER_ALLOC.toString()
      );
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 1: flexible staking", () => {
    it("registers at weight == amount and walks the request/cooldown/unstake path", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT);

      const positionPda = stakePda(staker.publicKey, b.env.programId);
      let pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.equal(pos.weight.toString(), (1_000n * UNIT).toString(), "flexible weight is the amount itself, 1.0x");
      assert.equal(pos.amount.toString(), (1_000n * UNIT).toString());

      const donor = await makeStaker(b.env, 500n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 500n * UNIT);

      const doUnstake = (amount: bigint) =>
        b.env.program.methods
          .unstake(new BN(amount.toString()))
          .accountsPartial(positionAccounts(b.env, staker, acct))
          .signers([staker])
          .rpc();

      await expectFailure(doUnstake(400n * UNIT), "NoUnstakeRequested");

      await b.env.program.methods
        .requestUnstake()
        .accountsPartial({ owner: staker.publicKey, position: positionPda })
        .signers([staker])
        .rpc();

      // Byte-identical to the attempt above; without a new slot the bank
      // rejects it as a duplicate instead of re-executing it.
      await advanceSlot(b.env.context);
      await expectFailure(doUnstake(400n * UNIT), "CooldownActive");

      await warpBy(b.env.context, UNSTAKE_COOLDOWN + 1);

      // A partial withdrawal pays principal only; the settled rewards stay
      // on the position.
      await doUnstake(400n * UNIT);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (400n * UNIT).toString(), "principal only on a partial");
      pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.equal(pos.claimableToken.toString(), (500n * UNIT).toString(), "the settled rewards stayed behind");

      // A second partial rides the same request; no fresh cooldown starts.
      await doUnstake(250n * UNIT);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (650n * UNIT).toString());

      // The full exit sweeps the remaining principal plus every settled
      // reward, and spends the request.
      await doUnstake(350n * UNIT);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (1_500n * UNIT).toString(), "350 principal + 500 rewards");
      pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.equal(pos.amount.toString(), "0");
      assert.equal(pos.claimableToken.toString(), "0");
      assert.equal(pos.escrowToken.toString(), "0", "flexible never escrows anything");
      assert.equal(pos.unstakeRequestedAt.toString(), "0", "the request is spent");
    });

    it("cancels a pending unstake request when the owner stakes again", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 600n * UNIT);

      const positionPda = stakePda(staker.publicKey, b.env.programId);
      await b.env.program.methods
        .requestUnstake()
        .accountsPartial({ owner: staker.publicKey, position: positionPda })
        .signers([staker])
        .rpc();

      let pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.notEqual(pos.unstakeRequestedAt.toString(), "0");

      // A deposit restarts the clock that separates a withdrawal from the
      // rewards it would capture, so the pending request is wiped.
      await stake(b.env, staker, acct, 400n * UNIT);
      pos = await (b.env.program.account as any).stakePosition.fetch(positionPda);
      assert.equal(pos.unstakeRequestedAt.toString(), "0", "topping up cancels the request");

      // Even far past the old cooldown, the spent request cannot be ridden.
      await warpBy(b.env.context, UNSTAKE_COOLDOWN + 1);
      await expectFailure(
        b.env.program.methods
          .unstake(new BN((1_000n * UNIT).toString()))
          .accountsPartial(positionAccounts(b.env, staker, acct))
          .signers([staker])
          .rpc(),
        "NoUnstakeRequested"
      );
    });

    it("gives a same-transaction stake-then-claim nothing to capture", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const early = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, early.staker, early.acct, 1_000n * UNIT);

      const donor = await makeStaker(b.env, 500n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 500n * UNIT);

      // A newcomer bundles stake + claim into one transaction, hoping to
      // capture a slice of rewards distributed before they arrived. The debt
      // snapshot taken at stake time prices them at exactly zero, so the
      // claim has nothing to withdraw and the whole bundle fails.
      const sniper = await makeStaker(b.env, 10_000n * UNIT);
      const stakeIx = await b.env.program.methods
        .stake(new BN((10_000n * UNIT).toString()))
        .accountsPartial({
          owner: sniper.staker.publicKey,
          config: b.env.configPda,
          pool: b.env.poolPda,
          position: stakePda(sniper.staker.publicKey, b.env.programId),
          vault: b.env.vaultPda,
          source: sniper.acct,
          rewardMint: b.env.mint,
          tokenProgram: REWARD_TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      const claimIx = await b.env.program.methods
        .claimRewards()
        .accountsPartial(positionAccounts(b.env, sniper.staker, sniper.acct))
        .instruction();

      await expectFailure(
        b.env.provider.sendAndConfirm(new Transaction().add(stakeIx, claimIx), [sniper.staker]),
        "NothingToWithdraw"
      );

      // And the staker who was actually there keeps their exact share.
      await claimRewards(b.env, early.staker, early.acct);
      assert.equal((await tokenBalance(b.env, early.acct)).toString(), (500n * UNIT).toString());
    });

    it("buffers rewards that arrive with nobody staked, then flushes them", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const donor = await makeStaker(b.env, 1_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 1_000n * UNIT);

      let pool = await fetchPool(b.env);
      assert.equal(pool.pendingTokenRewards.toString(), (1_000n * UNIT).toString(), "buffered, not dropped");
      assert.equal(pool.accTokenPerWeight.toString(), "0");

      const { staker, acct } = await makeStaker(b.env, 500n * UNIT);
      await stake(b.env, staker, acct, 500n * UNIT);

      await b.env.program.methods
        .flushPending()
        .accountsPartial({ pool: b.env.poolPda })
        .rpc();

      pool = await fetchPool(b.env);
      assert.equal(pool.pendingTokenRewards.toString(), "0");
      assert.isAbove(Number(pool.accTokenPerWeight.toString()), 0);
    });

    it("buffers a reward too small to move the accumulator instead of stranding it", async () => {
      // total_weight = 5e12, so a reward below 5e12/ACC_PRECISION = 5 base
      // units rounds the per-weight delta to zero. It must stay in pending (it
      // was already booked into reserved_token) rather than be lost forever.
      const b = await bootstrap({ fundExtra: 6_000_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 5_000_000n * UNIT);
      await stake(b.env, staker, acct, 5_000_000n * UNIT); // weight 5e12

      const donor = await makeStaker(b.env, 100n);
      await notifyTokens(b.env, donor.staker, donor.acct, 3n); // rounds to 0

      let pool = await fetchPool(b.env);
      assert.equal(pool.accTokenPerWeight.toString(), "0", "3 units cannot move the accumulator");
      assert.equal(pool.pendingTokenRewards.toString(), "3", "but they are buffered, not dropped");

      // A larger reward folds the dust in and distributes whole units; the
      // sub-unit remainder stays buffered. 13 total → 10 distributed, 3 kept.
      await notifyTokens(b.env, donor.staker, donor.acct, 10n);
      pool = await fetchPool(b.env);
      assert.equal(pool.pendingTokenRewards.toString(), "3", "sub-unit remainder still buffered");

      const before = await tokenBalance(b.env, acct);
      await claimRewards(b.env, staker, acct);
      const after = await tokenBalance(b.env, acct);
      assert.equal((after - before).toString(), "10", "the distributable portion reaches the staker exactly");
    });

    it("distributes SOL rewards alongside token rewards", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, staker, acct, 1_000n * UNIT);

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
      await claimRewards(b.env, staker, acct);
      const after = await solBalance(b.env, staker.publicKey);
      assert.isAbove(Number(after - before), lamports * 0.9, "flexible sole staker receives the SOL rewards");
    });
  });

  // -----------------------------------------------------------------------
  describe("bucket 1: lockups", () => {
    it("creates an independent entity per lock, weighted 2x/3x/5x by tier", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 3_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 0);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.ThreeMonth, 1);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.FiveMonth, 2);

      const expectations = [
        { index: 0, weight: 2_000n * UNIT, duration: LOCK_DURATION[Tier.OneMonth] },
        { index: 1, weight: 3_000n * UNIT, duration: LOCK_DURATION[Tier.ThreeMonth] },
        { index: 2, weight: 5_000n * UNIT, duration: LOCK_DURATION[Tier.FiveMonth] },
      ];
      for (const e of expectations) {
        const lockup = await fetchLockup(b.env, staker.publicKey, e.index);
        assert.equal(lockup.weight.toString(), e.weight.toString(), `lockup #${e.index} weight`);
        assert.equal(Number(lockup.lockEnd) - Number(lockup.createdAt), e.duration, `lockup #${e.index} duration`);
        assert.equal(lockup.demoted, false);
      }

      const pool = await fetchPool(b.env);
      assert.equal(pool.totalWeight.toString(), (10_000n * UNIT).toString(), "2x + 3x + 5x of 1000 each");
      assert.equal(pool.totalStaked.toString(), (3_000n * UNIT).toString(), "principal counts unweighted");

      const counter = await (b.env.program.account as any).lockupCounter.fetch(
        lockupCounterPda(staker.publicKey, b.env.programId)
      );
      assert.equal(counter.count.toString(), "3");
    });

    it("rejects a skipped index, the flexible tier, and a spent index", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);

      // The counter says the next index is 0; claiming 1 would fragment the sequence.
      await expectFailure(lockTokens(b.env, staker, acct, 100n * UNIT, Tier.OneMonth, 1), "InvalidLockupIndex");

      // Flexible principal belongs in `stake`; a zero-duration lockup would
      // dodge the unstake cooldown.
      await expectFailure(lockTokens(b.env, staker, acct, 100n * UNIT, Tier.Flexible, 0), "InvalidTier");

      // The true index still works after the failed attempts...
      await lockTokens(b.env, staker, acct, 100n * UNIT, Tier.OneMonth, 0);

      // ...and cannot be spent twice: the PDA already exists. (New slot, or
      // the byte-identical retry is rejected as a duplicate before running.)
      await advanceSlot(b.env.context);
      await expectFailure(lockTokens(b.env, staker, acct, 100n * UNIT, Tier.OneMonth, 0), "already in use");

      const counter = await (b.env.program.account as any).lockupCounter.fetch(
        lockupCounterPda(staker.publicKey, b.env.programId)
      );
      assert.equal(counter.count.toString(), "1", "only the one real lock advanced the counter");
    });

    it("pays base only through claim_lockup_rewards, escrow intact (sole 5x staker: 500 -> 100 base, 400 escrow)", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.FiveMonth, 0);

      const donor = await makeStaker(b.env, 500n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 500n * UNIT);

      await claimLockupRewards(b.env, staker, 0, acct);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (100n * UNIT).toString(), "the 1.0x share of a 5x weight");
      const lockup = await fetchLockup(b.env, staker.publicKey, 0);
      assert.equal(lockup.escrowToken.toString(), (400n * UNIT).toString(), "the boost stays escrowed");
      assert.equal(lockup.claimableToken.toString(), "0");

      // Nothing settled remains, so the next claim refuses.
      await advanceSlot(b.env.context);
      await expectFailure(claimLockupRewards(b.env, staker, 0, acct), "NothingToWithdraw");
    });

    it("splits rewards pro-rata across a flexible stake and lockups of different tiers", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const flex = await makeStaker(b.env, 1_000n * UNIT);
      const locker = await makeStaker(b.env, 2_000n * UNIT);
      await stake(b.env, flex.staker, flex.acct, 1_000n * UNIT); // weight 1000
      await lockTokens(b.env, locker.staker, locker.acct, 1_000n * UNIT, Tier.OneMonth, 0); // weight 2000
      await lockTokens(b.env, locker.staker, locker.acct, 1_000n * UNIT, Tier.ThreeMonth, 1); // weight 3000

      const donor = await makeStaker(b.env, 6_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 6_000n * UNIT);

      const pool = await fetchPool(b.env);
      assert.equal(pool.totalWeight.toString(), (6_000n * UNIT).toString());

      await claimRewards(b.env, flex.staker, flex.acct);
      assert.equal((await tokenBalance(b.env, flex.acct)).toString(), (1_000n * UNIT).toString(), "1/6 of the pot, all of it base");

      await claimLockupRewards(b.env, locker.staker, 0, locker.acct);
      const oneMonth = await fetchLockup(b.env, locker.staker.publicKey, 0);
      assert.equal((await tokenBalance(b.env, locker.acct)).toString(), (1_000n * UNIT).toString(), "2x lock accrued 2/6; half is base");
      assert.equal(oneMonth.escrowToken.toString(), (1_000n * UNIT).toString());

      await claimLockupRewards(b.env, locker.staker, 1, locker.acct);
      const threeMonth = await fetchLockup(b.env, locker.staker.publicKey, 1);
      assert.equal((await tokenBalance(b.env, locker.acct)).toString(), (2_000n * UNIT).toString(), "3x lock accrued 3/6; a third is base");
      assert.equal(threeMonth.escrowToken.toString(), (2_000n * UNIT).toString());
    });

    it("keeps two lockups of one wallet fully independent", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 2_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 0);
      const first = await fetchLockup(b.env, staker.publicKey, 0);

      await warpBy(b.env.context, 10 * DAY);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 1);
      const second = await fetchLockup(b.env, staker.publicKey, 1);
      assert.equal(Number(second.lockEnd) - Number(first.lockEnd), 10 * DAY, "each lock keeps its own clock");

      // 4000 over equal weights: 2000 to each lock, 1000 base + 1000 boost.
      const donor = await makeStaker(b.env, 4_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 4_000n * UNIT);

      // Exit the first lock early, on day 10 of its 30.
      const before = await tokenBalance(b.env, acct);
      await emergencyExitLockup(b.env, staker, 0, acct);
      const got = (await tokenBalance(b.env, acct)) - before;
      assert.equal(got.toString(), (1_850n * UNIT).toString(), "850 principal after the 15% slash + 1000 settled base");
      assert.isNull(
        await b.env.context.banksClient.getAccount(lockupPda(staker.publicKey, 0, b.env.programId)),
        "the exited lockup account is closed"
      );

      // Its forfeit (1000 boost + 150 slash) lands only on the surviving
      // lock: weight 2000 alone -> +1150 accrued, 575 base and 575 boost.
      const afterExit = await tokenBalance(b.env, acct);
      await claimLockupRewards(b.env, staker, 1, acct);
      const claimed = (await tokenBalance(b.env, acct)) - afterExit;
      assert.equal(claimed.toString(), (1_575n * UNIT).toString(), "1000 base from the first pot + 575 from the forfeit");

      const survivor = await fetchLockup(b.env, staker.publicKey, 1);
      assert.equal(survivor.amount.toString(), (1_000n * UNIT).toString(), "the surviving lock's principal is untouched");
      assert.equal(survivor.escrowToken.toString(), (1_575n * UNIT).toString(), "its escrow took the boost side of both pots");

      const pool = await fetchPool(b.env);
      assert.equal(pool.totalStaked.toString(), (1_000n * UNIT).toString());
      assert.equal(pool.totalWeight.toString(), (2_000n * UNIT).toString());
    });

    it("lets a stranger demote a matured lockup, exactly once, and it earns 1x thereafter", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 0);

      const donor = await makeStaker(b.env, 1_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 600n * UNIT);

      const stranger = Keypair.generate();
      await fundSol(b.env, stranger.publicKey, LAMPORTS_PER_SOL);

      // Not matured: the escrow is still being earned.
      await expectFailure(demoteMatured(b.env, stranger, staker.publicKey, 0), "EscrowNotMatured");

      await warpBy(b.env.context, LOCK_DURATION[Tier.OneMonth] + 1);
      const poolBefore = await fetchPool(b.env);
      await demoteMatured(b.env, stranger, staker.publicKey, 0);
      const poolAfter = await fetchPool(b.env);
      const lockup = await fetchLockup(b.env, staker.publicKey, 0);

      assert.equal(lockup.demoted, true);
      assert.equal(lockup.escrowToken.toString(), "0", "the escrow is released...");
      assert.equal(lockup.claimableToken.toString(), (600n * UNIT).toString(), "...into claimable: 300 base + 300 boost");
      assert.equal(lockup.weight.toString(), (1_000n * UNIT).toString(), "weight cut back to the amount, 1x");
      assert.equal(
        (BigInt(poolBefore.totalWeight.toString()) - BigInt(poolAfter.totalWeight.toString())).toString(),
        (1_000n * UNIT).toString(),
        "the pool lost exactly the boost portion of the weight"
      );

      await advanceSlot(b.env.context);
      await expectFailure(demoteMatured(b.env, stranger, staker.publicKey, 0), "AlreadyDemoted");

      // Rewards distributed after the demotion accrue at 1x: all base.
      await notifyTokens(b.env, donor.staker, donor.acct, 400n * UNIT);
      await claimLockupRewards(b.env, staker, 0, acct);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (1_000n * UNIT).toString(), "600 released + the full 400 at 1x");
      const after = await fetchLockup(b.env, staker.publicKey, 0);
      assert.equal(after.escrowToken.toString(), "0", "no boost accrues after demotion");
    });

    it("auto-demotes a matured lockup when its owner claims, so it stops carrying boosted weight", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 0); // 2x, weight 2000

      const donor = await makeStaker(b.env, 1_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 600n * UNIT); // 300 base, 300 boost escrow

      await warpBy(b.env.context, LOCK_DURATION[Tier.OneMonth] + 1);

      // The owner claims their base rewards after maturity. No separate demote
      // crank was run, but the claim itself must drop the lockup to 1x and
      // release the escrow, rather than leave it earning 2x indefinitely.
      const poolBefore = await fetchPool(b.env);
      const before = await tokenBalance(b.env, acct);
      await claimLockupRewards(b.env, staker, 0, acct);
      const paid = (await tokenBalance(b.env, acct)) - before;
      const poolAfter = await fetchPool(b.env);
      const lockup = await fetchLockup(b.env, staker.publicKey, 0);

      assert.equal(lockup.demoted, true, "claiming after maturity demotes");
      assert.equal(lockup.weight.toString(), (1_000n * UNIT).toString(), "weight cut to 1x");
      assert.equal(lockup.escrowToken.toString(), "0", "escrow released");
      assert.equal(paid.toString(), (600n * UNIT).toString(), "300 base + 300 released boost paid out");
      assert.equal(
        (BigInt(poolBefore.totalWeight.toString()) - BigInt(poolAfter.totalWeight.toString())).toString(),
        (1_000n * UNIT).toString(),
        "the boost weight left the pool"
      );
    });

    it("pays principal + base + boost in one unlock_tokens call on a never-demoted matured lockup", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.ThreeMonth, 0);

      const donor = await makeStaker(b.env, 900n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 900n * UNIT);

      // Before maturity the principal is exactly what a lock means: stuck.
      await expectFailure(unlockTokens(b.env, staker, 0, acct), "StillLocked");

      await warpBy(b.env.context, LOCK_DURATION[Tier.ThreeMonth] + 1);

      // A matured lock has honoured its commitment; the emergency door with
      // its slash is closed and only the clean exit remains.
      await expectFailure(emergencyExitLockup(b.env, staker, 0, acct), "StillLocked");

      await unlockTokens(b.env, staker, 0, acct);
      assert.equal(
        (await tokenBalance(b.env, acct)).toString(),
        (1_900n * UNIT).toString(),
        "1000 principal + 300 base + 600 boost, demoted inline and paid in one call"
      );
      assert.isNull(
        await b.env.context.banksClient.getAccount(lockupPda(staker.publicKey, 0, b.env.programId)),
        "the lockup account is closed"
      );

      const pool = await fetchPool(b.env);
      assert.equal(pool.totalWeight.toString(), "0");
      assert.equal(pool.totalStaked.toString(), "0");
    });

    it("forfeits the whole boost escrow even when rewards are claimed first (the claim-then-exit attack)", async () => {
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const attacker = await makeStaker(b.env, 1_000n * UNIT);
      const loyal = await makeStaker(b.env, 1_000n * UNIT);

      await lockTokens(b.env, attacker.staker, attacker.acct, 1_000n * UNIT, Tier.FiveMonth, 0); // weight 5000
      await stake(b.env, loyal.staker, loyal.acct, 1_000n * UNIT); // weight 1000

      const donor = await makeStaker(b.env, 6_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 6_000n * UNIT);

      // The attacker drains everything claimable first: exactly the 1.0x base.
      await claimLockupRewards(b.env, attacker.staker, 0, attacker.acct);
      assert.equal((await tokenBalance(b.env, attacker.acct)).toString(), (1_000n * UNIT).toString());

      const lockBefore = await fetchLockup(b.env, attacker.staker.publicKey, 0);
      assert.equal(lockBefore.escrowToken.toString(), (4_000n * UNIT).toString(), "the 4x above base is escrowed");

      const poolBefore = await fetchPool(b.env);
      // Past the 24h floor: the reward was already captured above, so the
      // forfeit is unchanged; the exit is just no longer inside the cooldown.
      await warpBy(b.env.context, UNSTAKE_COOLDOWN + 1);
      await emergencyExitLockup(b.env, attacker.staker, 0, attacker.acct);

      const finalBalance = await tokenBalance(b.env, attacker.acct);
      const expectedPrincipal = (1_000n * UNIT * (10_000n - EMERGENCY_EXIT_SLASH_BPS)) / 10_000n;
      assert.equal(
        (finalBalance - 1_000n * UNIT).toString(),
        expectedPrincipal.toString(),
        "principal minus the slash, and not one unit of the escrow"
      );

      const poolAfter = await fetchPool(b.env);
      const redistributed =
        BigInt(poolAfter.lifetimeTokenRewards.toString()) - BigInt(poolBefore.lifetimeTokenRewards.toString());
      const expectedRedistribution = 4_000n * UNIT + (1_000n * UNIT * EMERGENCY_EXIT_SLASH_BPS) / 10_000n;
      assert.equal(
        redistributed.toString(),
        expectedRedistribution.toString(),
        "forfeited boost plus the slash both flow back to bucket 1"
      );

      // And only to the staker who stayed: their 1000 from the original pot
      // plus the entire 4150 forfeit, to the unit.
      await claimRewards(b.env, loyal.staker, loyal.acct);
      assert.equal(
        (await tokenBalance(b.env, loyal.acct)).toString(),
        (1_000n * UNIT + expectedRedistribution).toString()
      );
    });

    it("buffers the forfeit to pending when the exiting lockup was the only staker", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.ThreeMonth, 0);

      await warpBy(b.env.context, UNSTAKE_COOLDOWN + 1);
      await emergencyExitLockup(b.env, staker, 0, acct);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (850n * UNIT).toString(), "85% of principal back");

      const pool = await fetchPool(b.env);
      assert.equal(pool.totalWeight.toString(), "0");
      assert.equal(
        pool.pendingTokenRewards.toString(),
        (150n * UNIT).toString(),
        "the slash waits for the next staker instead of dividing by zero weight"
      );
      assert.equal(pool.accTokenPerWeight.toString(), "0");
    });

    it("refuses an early exit inside the 24h floor, then allows it after (no sub-day unstake by any route)", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      const { staker, acct } = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, staker, acct, 1_000n * UNIT, Tier.OneMonth, 0);

      // A one-month lockup must not become a way to unstake in minutes: the
      // same floor the flexible tier enforces applies before any early exit.
      await warpBy(b.env.context, UNSTAKE_COOLDOWN - 60);
      await expectFailure(emergencyExitLockup(b.env, staker, 0, acct), "CooldownActive");

      await warpBy(b.env.context, 120);
      await emergencyExitLockup(b.env, staker, 0, acct);
      assert.equal((await tokenBalance(b.env, acct)).toString(), (850n * UNIT).toString(), "85% back once past the floor");
    });
  });

  // -----------------------------------------------------------------------
  describe("recover_foreign_token: stray token accounts", () => {
    // Donations in a mint the program cannot price on-chain forward to the
    // team multisig (config.dev_wallet), which converts and donates back.
    const recover = (
      b: Bootstrapped,
      source: PublicKey,
      destination: PublicKey,
      mint: PublicKey,
      tokenProgram: PublicKey = REWARD_TOKEN_PROGRAM,
    ) =>
      b.env.program.methods
        .recoverForeignToken()
        .accountsPartial({
          cranker: b.env.payer.publicKey,
          config: b.env.configPda,
          solVault: b.env.solVaultPda,
          source,
          destination,
          foreignMint: mint,
          tokenProgram,
        })
        .signers([b.env.payer])
        .rpc();

    it("forwards a stray foreign-mint account to the dev wallet and pays the cranker its rent", async () => {
      const b = await bootstrap();
      const foreignMint = await createMint(b.env);
      const source = await createTokenAccount(b.env, b.env.solVaultPda, foreignMint);
      await mintTo(b.env, source, 250n * UNIT, foreignMint);
      const destination = await createTokenAccount(b.env, b.devWallet.publicKey, foreignMint);

      const cranker = Keypair.generate();
      await fundSol(b.env, cranker.publicKey, LAMPORTS_PER_SOL);
      const before = await solBalance(b.env, cranker.publicKey);

      await b.env.program.methods
        .recoverForeignToken()
        .accountsPartial({
          cranker: cranker.publicKey,
          config: b.env.configPda,
          solVault: b.env.solVaultPda,
          source,
          destination,
          foreignMint,
          tokenProgram: REWARD_TOKEN_PROGRAM,
        })
        .signers([cranker])
        .rpc();

      assert.equal((await tokenBalance(b.env, destination)).toString(), (250n * UNIT).toString(), "the full balance forwarded");
      assert.isNull(await b.env.context.banksClient.getAccount(source), "the stray account is closed");

      const rent = await b.env.context.banksClient.getRent();
      const accountRent = rent.minimumBalance(BigInt(ACCOUNT_SIZE));
      const after = await solBalance(b.env, cranker.publicKey);
      assert.equal((after - before).toString(), accountRent.toString(), "the cranker keeps the closed account's rent");
    });

    it("refuses to recover the reward mint or wSOL", async () => {
      const b = await bootstrap();

      // The reward vault's mint IS staker funds.
      const rewardSource = await createTokenAccount(b.env, b.env.solVaultPda);
      const rewardDest = await createTokenAccount(b.env, b.devWallet.publicKey);
      await expectFailure(recover(b, rewardSource, rewardDest, b.env.mint), "InvalidRecoverySource");

      // wSOL already has a route to stakers via unwrap_wsol.
      const wsolSource = await createWrappedSolAccount(b.env, b.env.solVaultPda, 1_000_000n);
      const wsolDest = await createWrappedSolAccount(b.env, b.devWallet.publicKey, 0n);
      await expectFailure(
        recover(b, wsolSource, wsolDest, NATIVE_MINT, TOKEN_PROGRAM_ID),
        "InvalidRecoverySource"
      );
    });

    it("refuses a source the program's PDAs do not own, or a destination that is not the dev wallet's", async () => {
      const b = await bootstrap();
      const foreignMint = await createMint(b.env);

      // A third party's account is never recoverable, whatever its mint.
      const strangerOwned = await createTokenAccount(b.env, Keypair.generate().publicKey, foreignMint);
      await mintTo(b.env, strangerOwned, 5n * UNIT, foreignMint);
      const goodDest = await createTokenAccount(b.env, b.devWallet.publicKey, foreignMint);
      await expectFailure(recover(b, strangerOwned, goodDest, foreignMint), "InvalidRecoverySource");

      // Nor may the proceeds land anywhere but the disclosed dev wallet.
      const goodSource = await createTokenAccount(b.env, b.env.solVaultPda, foreignMint);
      await mintTo(b.env, goodSource, 5n * UNIT, foreignMint);
      const badDest = await createTokenAccount(b.env, Keypair.generate().publicKey, foreignMint);
      await expectFailure(recover(b, goodSource, badDest, foreignMint), "ConstraintRaw");
    });
  });

  // -----------------------------------------------------------------------
  describe("sync: funds that arrive from outside", () => {
    // Value can be credited to an account without this program's involvement:
    // a pump.fun fee distribution, a donation to an address we publish, a
    // mistake. `notify_*` cannot book those, because it only credits what it
    // transfers itself. Without `sync_*` they would be visible, unowned and
    // (the program being immutable) frozen for good.

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
      await stake(b.env, staker, acct, 1_000n * UNIT);

      const gift = 3 * LAMPORTS_PER_SOL;
      await airdropTo(b.env, b.env.solVaultPda, gift);

      let pool = await fetchPool(b.env);
      assert.equal(pool.lifetimeSolRewards.toString(), "0", "not credited on arrival");

      await syncSol(b);

      pool = await fetchPool(b.env);
      assert.equal(
        pool.lifetimeSolRewards.toString(),
        gift.toString(),
        "sync credits exactly what was untracked"
      );

      // And it is genuinely payable, not just booked.
      const before = await solBalance(b.env, staker.publicKey);
      await claimRewards(b.env, staker, acct);
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
      await stake(b.env, staker, acct, 1_000n * UNIT);

      // fundExtra was deposited through fund_vault, so it is already reserved.
      await expectFailure(syncToken(b), "NothingToWithdraw");

      const gift = 500n * UNIT;
      await mintTo(b.env, b.env.vaultPda, gift);

      let pool = await fetchPool(b.env);
      assert.equal(pool.lifetimeTokenRewards.toString(), "0");

      // The failed sync above is byte-identical to this one and still landed,
      // so without a new slot the bank rejects this as already-processed and
      // the program is never entered.
      await advanceSlot(b.env.context);
      await syncToken(b);

      pool = await fetchPool(b.env);
      assert.equal(pool.lifetimeTokenRewards.toString(), gift.toString());
    });

    it("buffers a sync that lands while nobody is staked", async () => {
      const b = await bootstrap({ fundExtra: 10_000n * UNIT });
      await airdropTo(b.env, b.env.solVaultPda, 2 * LAMPORTS_PER_SOL);
      await syncSol(b);

      const pool = await fetchPool(b.env);
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
      await stake(b.env, staker, acct, 1_000n * UNIT);

      const wrapped = BigInt(4 * LAMPORTS_PER_SOL);
      const wsol = await createWrappedSolAccount(b.env, b.env.solVaultPda, wrapped);

      await b.env.program.methods
        .unwrapWsol()
        .accountsPartial({
          config: b.env.configPda,
          pool: b.env.poolPda,
          solVault: b.env.solVaultPda,
          wsolAccount: wsol,
          // wSOL stays a classic SPL mint even with a Token-2022 reward mint.
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const pool = await fetchPool(b.env);
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
            // wSOL stays a classic SPL mint; see above.
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc(),
        "InvalidWsolAccount"
      );
    });

    it("keeps the counters untouched when a forfeit is only reclassified", async () => {
      // emergency_exit_lockup moves value between owners without moving it out
      // of the vault. If that touched the counters, a later sync would
      // double-count.
      const b = await bootstrap({ fundExtra: 100_000n * UNIT });
      const quitter = await makeStaker(b.env, 1_000n * UNIT);
      const loyal = await makeStaker(b.env, 1_000n * UNIT);
      await lockTokens(b.env, quitter.staker, quitter.acct, 1_000n * UNIT, Tier.FiveMonth, 0);
      await stake(b.env, loyal.staker, loyal.acct, 1_000n * UNIT);

      const donor = await makeStaker(b.env, 6_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 6_000n * UNIT);

      await warpBy(b.env.context, UNSTAKE_COOLDOWN + 1);
      await emergencyExitLockup(b.env, quitter.staker, 0, quitter.acct);

      // The slash and forfeited boost stayed in the vault and are already
      // reserved, so there is nothing for a sync to find.
      await expectFailure(syncToken(b), "NothingToWithdraw");
    });

    it("holds the invariant: vault balances never fall below what is reserved", async () => {
      const b = await bootstrap({ fundExtra: 50_000n * UNIT });
      const flex = await makeStaker(b.env, 1_000n * UNIT);
      await stake(b.env, flex.staker, flex.acct, 1_000n * UNIT);
      const locker = await makeStaker(b.env, 3_000n * UNIT);
      await lockTokens(b.env, locker.staker, locker.acct, 2_000n * UNIT, Tier.ThreeMonth, 0);
      await lockTokens(b.env, locker.staker, locker.acct, 1_000n * UNIT, Tier.OneMonth, 1);

      const donor = await makeStaker(b.env, 3_000n * UNIT);
      await notifyTokens(b.env, donor.staker, donor.acct, 3_000n * UNIT);
      await airdropTo(b.env, b.env.solVaultPda, 2 * LAMPORTS_PER_SOL);
      await syncSol(b);
      await claimOldHolder(b, 0);

      await claimLockupRewards(b.env, locker.staker, 0, locker.acct);
      await claimRewards(b.env, flex.staker, flex.acct);

      // Mature the short lock, demote it, then unlock it entirely.
      await warpBy(b.env.context, LOCK_DURATION[Tier.OneMonth] + 1);
      await demoteMatured(b.env, b.env.payer, locker.staker.publicKey, 1);
      await unlockTokens(b.env, locker.staker, 1, locker.acct);

      // And break the long lock early, day 30 of its 90.
      await emergencyExitLockup(b.env, locker.staker, 0, locker.acct);

      const pool = await fetchPool(b.env);
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
