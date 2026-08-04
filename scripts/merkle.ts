/**
 * Merkle tree for the claim buckets.
 *
 * The construction must match `utils.rs` byte for byte, because the on-chain
 * verifier is the thing that decides whether a claim is valid:
 *
 *   leaf     = keccak256( keccak256( pubkey_bytes(32) || amount_le(8) ) )
 *   internal = keccak256( min(a,b) || max(a,b) )
 *
 * Sorted pairs mean a proof is just a list of sibling hashes with no direction
 * bits. Leaves are hashed twice so that a 64-byte internal node can never be
 * reinterpreted as a leaf preimage.
 *
 * Odd nodes at a level are promoted unchanged to the next level rather than
 * duplicated — duplicating the last node is the classic CVE-2012-2459 style
 * footgun where two different trees produce the same root.
 */
import { PublicKey } from "@solana/web3.js";
import { keccak_256 } from "js-sha3";

export interface Allocation {
  /** Base58 Solana address. */
  address: string;
  /** Raw token amount in base units, as a decimal string (no decimals applied). */
  amount: string;
}

export interface Proof {
  address: string;
  amount: string;
  proof: string[];
  leaf: string;
}

const keccak = (data: Buffer): Buffer =>
  Buffer.from(keccak_256.arrayBuffer(data));

export function amountToLeBytes(amount: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(amount);
  return buf;
}

export function hashLeaf(address: string, amount: bigint): Buffer {
  const key = new PublicKey(address).toBuffer();
  const inner = keccak(Buffer.concat([key, amountToLeBytes(amount)]));
  return keccak(inner);
}

function hashPair(a: Buffer, b: Buffer): Buffer {
  return Buffer.compare(a, b) <= 0
    ? keccak(Buffer.concat([a, b]))
    : keccak(Buffer.concat([b, a]));
}

export class MerkleTree {
  /** layers[0] is the leaf layer; the last layer holds the single root. */
  readonly layers: Buffer[][];
  private readonly leafIndex: Map<string, number>;

  constructor(leaves: Buffer[]) {
    if (leaves.length === 0) {
      throw new Error("cannot build a Merkle tree with no leaves");
    }
    // Sort leaves so the tree is deterministic regardless of input ordering.
    // Anyone re-running the snapshot must land on the identical root.
    const sorted = [...leaves].sort(Buffer.compare);

    this.leafIndex = new Map();
    sorted.forEach((leaf, i) => this.leafIndex.set(leaf.toString("hex"), i));

    this.layers = [sorted];
    while (this.layers[this.layers.length - 1].length > 1) {
      const prev = this.layers[this.layers.length - 1];
      const next: Buffer[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        if (i + 1 === prev.length) {
          next.push(prev[i]); // promote, never duplicate
        } else {
          next.push(hashPair(prev[i], prev[i + 1]));
        }
      }
      this.layers.push(next);
    }
  }

  get root(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  get rootHex(): string {
    return this.root.toString("hex");
  }

  /** Root as the `[u8; 32]` array shape the Anchor instruction expects. */
  get rootArray(): number[] {
    return Array.from(this.root);
  }

  proofFor(leaf: Buffer): Buffer[] {
    let index = this.leafIndex.get(leaf.toString("hex"));
    if (index === undefined) {
      throw new Error(`leaf ${leaf.toString("hex")} is not in this tree`);
    }
    const proof: Buffer[] = [];
    for (let level = 0; level < this.layers.length - 1; level++) {
      const nodes = this.layers[level];
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      if (siblingIndex < nodes.length) {
        proof.push(nodes[siblingIndex]);
      }
      index = Math.floor(index / 2);
    }
    return proof;
  }

  /** Mirror of the on-chain check, useful for asserting before submitting. */
  static verify(proof: Buffer[], root: Buffer, leaf: Buffer): boolean {
    let computed = leaf;
    for (const sibling of proof) {
      computed = hashPair(computed, sibling);
    }
    return computed.equals(root);
  }
}

export function buildTree(allocations: Allocation[]): {
  tree: MerkleTree;
  proofs: Record<string, Proof>;
  total: bigint;
} {
  const seen = new Set<string>();
  for (const a of allocations) {
    if (seen.has(a.address)) {
      throw new Error(`duplicate address in allocation list: ${a.address}`);
    }
    seen.add(a.address);
    if (BigInt(a.amount) <= 0n) {
      throw new Error(`non-positive amount for ${a.address}`);
    }
  }

  const leaves = allocations.map((a) => hashLeaf(a.address, BigInt(a.amount)));
  const tree = new MerkleTree(leaves);

  const proofs: Record<string, Proof> = {};
  allocations.forEach((a, i) => {
    const leaf = leaves[i];
    const proof = tree.proofFor(leaf);
    if (!MerkleTree.verify(proof, tree.root, leaf)) {
      throw new Error(`generated proof failed self-check for ${a.address}`);
    }
    proofs[a.address] = {
      address: a.address,
      amount: a.amount,
      leaf: leaf.toString("hex"),
      proof: proof.map((p) => p.toString("hex")),
    };
  });

  const total = allocations.reduce((sum, a) => sum + BigInt(a.amount), 0n);
  return { tree, proofs, total };
}

/** Convert a hex proof back into the `[u8; 32][]` shape Anchor expects. */
export function proofToBytes(proof: string[]): number[][] {
  return proof.map((p) => Array.from(Buffer.from(p, "hex")));
}
