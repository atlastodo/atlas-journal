#!/usr/bin/env node
// The licences of the third-party code the web build bundles, against an allow-list.
//
// Every package reachable through `dependencies` (and installed peer and optional dependencies)
// from the workspace packages that end up in the web build: the app and packages/journal-core.
// Dev dependencies (build tools, tests) are not checked. The Atlas core packages
// (@atlastodo/client-core from npm, and this repository's @atlastodo/journal-core) are Atlas's own
// code under the same licence, so they are walked for their dependencies but not checked.
//
// Usage:
//   node scripts/third-party-licenses.mjs --check          # fail on a licence outside ALLOW
//
// Run `bun install` first. `--check` mirrors the core repository's allow-list (its deny.toml plus
// the licences only JS packages use); a new licence fails it for a human to review.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKSPACES = ["apps/journal", "packages/journal-core"];
// First-party packages (the core packages, journal-core): not third-party code.
const FIRST_PARTY = /^@atlastodo\//;

// The core repository's deny.toml list, and the permissive licences the shipped JS tree adds (each checked by hand).
const ALLOW = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unicode-3.0",
  "Zlib",
  "CDLA-Permissive-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "MIT-0",
  // Weak copyleft, compatible with AGPL (MPL 2.0 section 3.3): lightningcss, through Expo's CSS
  // tooling; also in the core repository's deny.toml, for webauthn-rs.
  "MPL-2.0",
  // Browser-support data, not code: caniuse-lite, through browserslist.
  "CC-BY-4.0",
]);

/** The licence of a package.json: SPDX `license`, an object, or the legacy `licenses` array. */
function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x?.type)).join(" OR ");
  if (l && typeof l === "object") return l.type ?? "UNKNOWN";
  return "UNKNOWN";
}

/** Whether an SPDX expression is satisfiable with allowed licences (OR picks one; AND needs all). */
export function allowed(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  return clean.split(/\s+OR\s+/i).some((alt) =>
    alt
      .split(/\s+AND\s+/i)
      .map((s) => s.trim())
      .every((id) => ALLOW.has(id)),
  );
}

/** Node's lookup: `<dir>/node_modules/<name>`, then each parent's. Bun's isolated layout resolves too. */
function resolveDep(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return path.dirname(fs.realpathSync(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function jsPackages() {
  const seen = new Map(); // realpath -> entry
  // A build context may hold only some workspaces.
  const workspaceDirs = new Set(
    WORKSPACES.map((w) => path.join(ROOT, w))
      .filter((d) => fs.existsSync(path.join(d, "package.json")))
      .map((d) => fs.realpathSync(d)),
  );
  const queue = [...workspaceDirs];
  while (queue.length) {
    const dir = queue.shift();
    if (seen.has(dir)) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    seen.set(dir, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      dir,
      own: workspaceDirs.has(dir) || FIRST_PARTY.test(pkg.name ?? ""),
    });
    const deps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const found = resolveDep(dir, name);
      // An optional or peer dependency that isn't installed isn't shipped either.
      if (found && !seen.has(found)) queue.push(found);
    }
  }
  return [...seen.values()]
    .filter((p) => !p.own)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  if (!process.argv.includes("--check")) {
    console.error("usage: third-party-licenses.mjs --check");
    process.exit(2);
  }
  const bad = jsPackages().filter((p) => !allowed(p.license));
  for (const p of bad) console.error(`${p.name}@${p.version}: ${p.license}`);
  if (bad.length) {
    console.error(
      `\n${bad.length} bundled JS package(s) with a licence outside the allow-list in scripts/third-party-licenses.mjs. ` +
        "Review each; add a licence to ALLOW only if it is compatible with AGPL-3.0-only.",
    );
    process.exit(1);
  }
  console.log("Every bundled JS package has an allowed licence.");
}
