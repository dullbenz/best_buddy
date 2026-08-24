// Put the program IDL where the app can import it.
//
// Prefers a fresh `anchor build` output when one exists locally, and otherwise
// falls back to the IDL committed at `idl/`. That fallback is what lets CI
// build and deploy the site in seconds instead of compiling the Rust program
// on every push. `ci.yml` separately rebuilds the program and fails if the
// committed copy has drifted, so the shortcut can never ship a stale interface.
//
// One exception to the straight copy: `IDL_ADDRESS_OVERRIDE`. The same program
// is deployed on devnet under a different id, and `config.ts` refuses to start
// if `VITE_PROGRAM_ID` disagrees with the bundled IDL — correctly, because a
// site deriving PDAs against one program while sending to another is worse than
// one that will not load. That guard also meant the staging site could only ever
// be built against the mainnet id, so on devnet it read accounts that do not
// exist and there was nothing to test. Setting this rewrites the address field
// only; every instruction and account layout is the untouched committed copy,
// and CI still fails if that has drifted from the program source.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, "../../target/idl/buddy_distributor.json");
const committed = resolve(here, "../../idl/buddy_distributor.json");
const target = resolve(here, "../src/idl/buddy_distributor.json");

const source = existsSync(built) ? built : committed;

if (!existsSync(source)) {
  console.error(
    `No IDL found.\n  looked in: ${built}\n  and:       ${committed}\n` +
      `Run "anchor build", or restore idl/buddy_distributor.json.`
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });

/**
 * Read one key out of app/.env.local.
 *
 * This script runs before Vite, so it never sees the env file Vite loads. CI
 * passes IDL_ADDRESS_OVERRIDE as a real environment variable, but a developer
 * has already written VITE_PROGRAM_ID into .env.local and would reasonably
 * expect its companion to live beside it rather than in their shell profile.
 */
function fromEnvLocal(key) {
  const file = resolve(here, "../.env.local");
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return "";
}

const override = (
  process.env.IDL_ADDRESS_OVERRIDE || fromEnvLocal("IDL_ADDRESS_OVERRIDE")
).trim();
if (override) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(override)) {
    console.error(`IDL_ADDRESS_OVERRIDE is not a base58 program id: ${override}`);
    process.exit(1);
  }
  const idl = JSON.parse(readFileSync(source, "utf8"));
  const original = idl.address;
  idl.address = override;
  writeFileSync(target, `${JSON.stringify(idl, null, 2)}\n`);
  console.log(
    `IDL <- ${source === built ? "fresh build" : "committed copy"}, ` +
      `address overridden ${original} -> ${override}`,
  );
} else {
  copyFileSync(source, target);
  console.log(`IDL <- ${source === built ? "fresh build" : "committed copy"}`);
}

// The influencer terms are signed in the browser and verified in a Cloud
// Function. Both must hash byte-for-byte identical text, so there is exactly
// one canonical copy at the repo root and everything else is generated from it.
const termsSource = resolve(here, "../../INFLUENCER-TERMS.txt");
const termsTargets = [
  resolve(here, "../src/generated/influencer-terms.txt"),
  resolve(here, "../../functions/influencer-terms.txt"),
];

if (!existsSync(termsSource)) {
  console.error(`Missing ${termsSource}`);
  process.exit(1);
}

for (const t of termsTargets) {
  mkdirSync(dirname(t), { recursive: true });
  copyFileSync(termsSource, t);
}
console.log("influencer terms <- INFLUENCER-TERMS.txt");
