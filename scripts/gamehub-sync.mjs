#!/usr/bin/env node
/**
 * Copies the shared game core and the program IDL into the gamehub functions
 * codebase.
 *
 * The browser reaches `game-core/` through a Vite alias, so it always compiles
 * the real source. Cloud Functions cannot: a deploy uploads only the files
 * inside the codebase directory, so the server's copy has to physically live in
 * `functions-gamehub/`. This script is what keeps the two identical, and it
 * runs before every build and deploy.
 *
 * If the client and server ever ran different physics, honest players' scores
 * would be rejected as cheating — so the copies are compared byte for byte and
 * a stale copy is an error, not a warning.
 *
 * Usage: node scripts/gamehub-sync.mjs [--check]
 *   --check  verify the copies are current without writing (for CI)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const GENERATED_BANNER =
  "// GENERATED FILE - do not edit. Source of truth: game-core/. Run `npm run gamehub:sync`.\n";

/** Files copied verbatim, with no banner (JSON cannot carry a comment). */
const copies = [
  {
    from: join(repoRoot, "idl", "buddy_distributor.json"),
    to: join(repoRoot, "functions-gamehub", "idl", "buddy_distributor.json"),
    banner: false,
  },
];

const coreSource = join(repoRoot, "game-core");
const coreTarget = join(repoRoot, "functions-gamehub", "core");

for (const entry of readdirSync(coreSource, { withFileTypes: true })) {
  // Tests and package metadata stay behind; only the sims ship to the server.
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  copies.push({
    from: join(coreSource, entry.name),
    to: join(coreTarget, entry.name),
    banner: true,
  });
}

function render(copy) {
  const source = readFileSync(copy.from, "utf8");
  return copy.banner ? GENERATED_BANNER + source : source;
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const stale = [];
for (const copy of copies) {
  const expected = render(copy);
  const current = existsSync(copy.to) ? readFileSync(copy.to, "utf8") : null;
  if (current === expected) continue;
  stale.push({ ...copy, expected, had: current === null ? "missing" : digest(current) });
}

// A file left behind after a source file is deleted would keep being deployed.
const orphans = existsSync(coreTarget)
  ? readdirSync(coreTarget).filter(
      (name) => !copies.some((copy) => copy.to === join(coreTarget, name)),
    )
  : [];

if (checkOnly) {
  if (stale.length === 0 && orphans.length === 0) {
    console.log(`gamehub-sync: ${copies.length} file(s) current`);
    process.exit(0);
  }
  for (const copy of stale) {
    console.error(`::error::stale copy ${relative(repoRoot, copy.to)} (${copy.had})`);
  }
  for (const name of orphans) {
    console.error(`::error::orphaned copy core/${name} has no source in game-core/`);
  }
  console.error("Run `npm run gamehub:sync` and commit nothing — these copies are gitignored.");
  process.exit(1);
}

for (const name of orphans) {
  rmSync(join(coreTarget, name));
  console.log(`gamehub-sync: removed orphan core/${name}`);
}
for (const copy of stale) {
  mkdirSync(dirname(copy.to), { recursive: true });
  writeFileSync(copy.to, copy.expected);
  console.log(`gamehub-sync: wrote ${relative(repoRoot, copy.to)}`);
}
if (stale.length === 0 && orphans.length === 0) {
  console.log(`gamehub-sync: ${copies.length} file(s) already current`);
}
