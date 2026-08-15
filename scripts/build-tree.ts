/**
 * Build a Merkle tree from a plain CSV of `address,amount`.
 *
 * Used for the influencer list (bucket 3), which is authored by hand rather
 * than derived from chain state. The output is published in full alongside the
 * root. The whole point of the influencer programme being on-chain is that
 * there are no hidden allocations.
 *
 * Usage:
 *   ts-node scripts/build-tree.ts influencers.csv out/influencers
 */
import * as fs from "fs";
import * as path from "path";
import { Allocation, buildTree } from "./merkle";

function parseCsv(file: string): Allocation[] {
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  // Tolerate an optional header row.
  const start = /^[A-Za-z]/.test(lines[0]) && lines[0].includes(",") &&
    lines[0].toLowerCase().includes("address")
    ? 1
    : 0;

  return lines.slice(start).map((line, i) => {
    const [address, amount] = line.split(",").map((s) => s.trim());
    if (!address || !amount) {
      throw new Error(`malformed row ${i + start + 1}: "${line}"`);
    }
    return { address, amount };
  });
}

function main() {
  const [input, outPrefix] = process.argv.slice(2);
  if (!input || !outPrefix) {
    console.error("usage: ts-node scripts/build-tree.ts <input.csv> <out-prefix>");
    process.exit(1);
  }

  const allocations = parseCsv(input);
  const { tree, proofs, total } = buildTree(allocations);

  fs.mkdirSync(path.dirname(outPrefix), { recursive: true });
  fs.writeFileSync(
    `${outPrefix}-allocations.json`,
    JSON.stringify(allocations, null, 2)
  );
  fs.writeFileSync(`${outPrefix}-proofs.json`, JSON.stringify(proofs, null, 2));
  fs.writeFileSync(
    `${outPrefix}-manifest.json`,
    JSON.stringify(
      {
        merkleRoot: tree.rootHex,
        entries: allocations.length,
        total: total.toString(),
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`root:    ${tree.rootHex}`);
  console.log(`entries: ${allocations.length}`);
  console.log(`total:   ${total}`);
}

main();
