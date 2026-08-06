// Put the program IDL where the app can import it.
//
// Prefers a fresh `anchor build` output when one exists locally, and otherwise
// falls back to the IDL committed at `idl/`. That fallback is what lets CI
// build and deploy the site in seconds instead of compiling the Rust program
// on every push. `ci.yml` separately rebuilds the program and fails if the
// committed copy has drifted, so the shortcut can never ship a stale interface.
import { copyFileSync, existsSync, mkdirSync } from "fs";
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
copyFileSync(source, target);
console.log(`IDL <- ${source === built ? "fresh build" : "committed copy"}`);

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
