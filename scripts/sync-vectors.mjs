#!/usr/bin/env node
// Refresh test-vectors/journal_cli_golden.json from the core repository's
// test-vectors/cli_golden.json: the golden runs of the `atlas` CLI (crates/atlas-cli/tests/golden.rs
// there), of which only the Atlas Journal scenarios are kept. packages/journal-core replays them
// through its own entry rules, so the app and the CLI agree on what an entry is.
//
// Usage: scripts/sync-vectors.mjs <core checkout> [git ref, default origin/dev]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [core, ref = "origin/dev"] = process.argv.slice(2);
if (!core) {
  console.error("usage: scripts/sync-vectors.mjs <core checkout> [git ref]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", ["-C", core, ...args], { encoding: "utf8" });
const commit = git("rev-parse", ref).trim();
const golden = JSON.parse(git("show", `${commit}:test-vectors/cli_golden.json`));
const scenarios = golden.scenarios.filter((s) =>
  s.steps.some((step) => step.argv?.[0] === "journal" || step.seed?.entity?.startsWith("journal.")),
);
const out = {
  _doc: "The Atlas Journal scenarios of the core repository's test-vectors/cli_golden.json, copied by scripts/sync-vectors.mjs. Do not edit: refresh it from core instead.",
  _source: `atlastodo/atlas@${commit}:test-vectors/cli_golden.json`,
  _golden_doc: golden._doc,
  now: golden.now,
  scenarios,
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "test-vectors", "journal_cli_golden.json");
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${path.relative(root, file)}: ${scenarios.length} scenarios from ${commit}`);
