/**
 * Helper for the original 2014 signer.
 *
 * Prints the exact message that must be signed with the Bitcoin key, and — given
 * a base64 signature back from a wallet — converts it into the (header,
 * signature) pair the on-chain instruction expects and checks it locally before
 * anyone spends a transaction fee on it.
 *
 * Print the message to sign:
 *   ts-node scripts/sign-claim.ts message <SOLANA_ADDRESS>
 *
 * Verify a signature produced by `bitcoin-cli signmessage` or any wallet:
 *   ts-node scripts/sign-claim.ts verify <SOLANA_ADDRESS> <BASE64_SIG> <UNCOMPRESSED_PUBKEY_HEX>
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

const PREFIX = "I am the original Buddy. Claim to Solana address: ";

function bitcoinMessageHash(message: string): Uint8Array {
  const msg = Buffer.from(message, "utf8");
  if (msg.length >= 253) throw new Error("message too long");
  const payload = Buffer.concat([
    Buffer.from([0x18]),
    Buffer.from("Bitcoin Signed Message:\n", "utf8"),
    Buffer.from([msg.length]),
    msg,
  ]);
  return sha256(sha256(payload));
}

function claimMessage(solanaAddress: string): string {
  new PublicKey(solanaAddress); // throws early on a malformed address
  return `${PREFIX}${solanaAddress}`;
}

function cmdMessage(address: string) {
  const message = claimMessage(address);
  console.log("Sign this exact message with the Bitcoin key, byte for byte:\n");
  console.log(message);
  console.log("\nWith Bitcoin Core:");
  console.log(`  bitcoin-cli signmessage "<your_btc_address>" "${message}"`);
  console.log("\nThe message binds the claim to that one Solana address.");
  console.log("A signature for a different address will be rejected on chain,");
  console.log("so this is safe to produce and hand to anyone to submit.");
}

function cmdVerify(address: string, base64Sig: string, pubkeyHex: string) {
  const message = claimMessage(address);
  const raw = Buffer.from(base64Sig, "base64");
  if (raw.length !== 65) {
    throw new Error(`expected a 65-byte signature, got ${raw.length} bytes`);
  }

  const header = raw[0];
  const signature = raw.subarray(1);
  const recovery =
    header >= 27 && header <= 30
      ? header - 27
      : header >= 31 && header <= 34
      ? header - 31
      : null;
  if (recovery === null) throw new Error(`invalid header byte ${header}`);

  const digest = bitcoinMessageHash(message);
  const sig = secp256k1.Signature.fromCompact(signature).addRecoveryBit(recovery);
  const recovered = sig.recoverPublicKey(digest).toRawBytes(false); // uncompressed, 0x04 prefixed

  const expected = pubkeyHex.startsWith("0x") ? pubkeyHex.slice(2) : pubkeyHex;
  const expectedXY = expected.length === 130 ? expected.slice(2) : expected;
  const recoveredXY = Buffer.from(recovered.slice(1)).toString("hex");

  console.log(`message:   ${message}`);
  console.log(`header:    ${header} (recovery id ${recovery})`);
  console.log(`recovered: ${recoveredXY}`);
  console.log(`expected:  ${expectedXY}`);

  if (recoveredXY.toLowerCase() !== expectedXY.toLowerCase()) {
    console.error("\nMISMATCH — this signature was not produced by that key.");
    process.exit(1);
  }

  console.log("\nMATCH. Submit with:");
  console.log(`  destination_owner = ${address}`);
  console.log(`  header            = ${header}`);
  console.log(`  signature         = ${signature.toString("hex")}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "message" && rest.length === 1) return cmdMessage(rest[0]);
  if (cmd === "verify" && rest.length === 3) return cmdVerify(rest[0], rest[1], rest[2]);

  console.error("usage:");
  console.error("  ts-node scripts/sign-claim.ts message <SOLANA_ADDRESS>");
  console.error(
    "  ts-node scripts/sign-claim.ts verify <SOLANA_ADDRESS> <BASE64_SIG> <UNCOMPRESSED_PUBKEY_HEX>"
  );
  process.exit(1);
}

main();
