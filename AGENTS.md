# AGENTS.md

## Working with the user (standing instruction)

- Before planning work on a bug, ask questions until the bug is properly understood (symptoms, reproduction, expected vs actual).
- Also ask questions about the proposed solution before implementing — don't assume intent.
- Never mention Claude, Claude Code or any other AI in commits, pull requests, tags or release notes: no `Co-Authored-By` trailers, session links or "Generated with" footers.

## What this is

A test harness for Atlas core, not a product: Atlas Journal exists only to prove that core's shared logic (the `@atlastodo/client-core` package from npm, the server and the `atlas` CLI) works for an app other than todo. It has no releases, no store listings and no native builds. Core — the server, the CLI and the packages — is [atlastodo/atlas](https://github.com/atlastodo/atlas) (a checkout is expected at `../atlas` by the scripts); the todo app is [atlastodo/atlas-todo](https://github.com/atlastodo/atlas-todo).

- **Core version bumps here are how core changes get exercised by a second app.** After a core release (rc or stable), `deps:update` (weekly, see Dependabot below) moves `@atlastodo/client-core` (exact version, in `apps/journal/package.json` and `packages/journal-core/package.json`, now `0.1.14`) (the e2e job in `ci.yml` reads it from the manifests for its server image and CLI binary) and `test-vectors/` (`vectors:sync` from the release tag); then make the suites pass. A failure is a finding about core: fix it in core (a branch in the core repository), don't work around it here.
- Removed on purpose (2026-10): the Android/iOS builds (native modules, EAS, the Android SDK in devenv, the build-cache workflow, the permission allowlist, store icons and splash, Play upload), the release workflow and its tooling (`version:bump`, release notes, the derived `versionCode`, the web tarball, third-party notices), and the flake (`web-dist`, `nix/bun.nix`, `nix:bun-lock`, the Dependabot bun.nix workflow). Don't bring them back. The version stays at `0.1.0`.

## Dev environment

- All dev commands (`web:dev`, `web:export`, `test:all`, `e2e:cli`, `lint`, `fmt`, `vectors:sync`) are devenv scripts in `devenv.nix` — run them inside `devenv shell` (or `devenv shell -- <script>`). The root `package.json` has **no** scripts. (The full suite is `test:all`, not `test`, which collides with the shell builtin.)
- Bun is the package manager (`bun.lock` committed; CI installs with `--frozen-lockfile`); Node 26 is the runtime. Bun is pinned to **1.4.2** in devenv (the nixpkgs of `devenv.lock`: `nixos-unstable`, the channel the other atlastodo flakes use) and `.bun-version` (which every `setup-bun` in CI reads with `bun-version-file`), in lockstep: `deps:update` moves both to the Bun that nixpkgs ships. No version pin lives in `.github/`: the weekly refresh pushes with the workflow token, which may not change workflow files.
- TypeScript is 7 (the native compiler) everywhere: the root and both workspaces. Its npm package has no JS compiler API, which is why the linter is oxlint, not ESLint with typescript-eslint.
- A server for development: in the core checkout, `devenv up` and `ATLAS_APPS=todo,journal cargo run -p atlas-server`; `EXPO_PUBLIC_API_URL` defaults to `http://localhost:8080`.

## Verification

- `test:all` = vitest in `packages/journal-core` (under Bun: `bunx --bun vitest run`) → jest-expo in `apps/journal` (must run under real Node: `bun run test`).
- `lint` = `tsc --noEmit` for both workspaces + `oxlint .` (`.oxlintrc.json`: the typescript-eslint `recommended` rules and react-hooks `rules-of-hooks` (error) and `exhaustive-deps` (warning)) + `prettier --check .` + `scripts/third-party-licenses.mjs --check` (the licences of the packages the web build bundles, against an allow-list mirroring core's).
- `web:export` (or CI's export step) must pass.
- `e2e:cli` (`scripts/e2e-cli.sh`) = a throwaway database, core's `atlas-server` with `ATLAS_APPS=todo,journal`, and the `atlas` CLI: `packages/journal-core/e2e` proves an entry the CLI adds shows up in the app's store and the reverse (edits and trash too), and that an Atlas Todo account gets its journal key on its first journal sign-in. `E2E_WEB=1` also exports the web app, serves it from that server and drives it in headless Chromium (`scripts/e2e-web.mjs`: sign-up, writing, search, a token made in Settings, the CLI both ways, reload). Binaries are built from `ATLAS_CORE_DIR` (default `../atlas`) or given as `ATLAS_SERVER_BIN`/`ATLAS_CLI`; Postgres from `E2E_DATABASE_URL` (default the devenv one on 5432). CI's `End to end (server + CLI)` job runs the same suites against the pinned core release's image and CLI binary.

## Layout and rules

- `packages/journal-core` — platform-free: `entry.ts` (the entry fields and rules, at parity with `crates/atlas-client/src/journal.rs` in core; `entry.golden.test.ts` replays `test-vectors/journal_cli_golden.json`, the CLI's golden runs — refresh it with `vectors:sync`, never edit it), `query.ts`, `entries.ts` (entries in a client-core `LocalStore`), `account.ts` (sign-in/up/unlock, opening the journal app key), `apiTokens.ts`, `engine.ts` (store + `SyncClient`).
- **No crypto here.** Keys and envelopes are client-core's: the password opens the root (`openAccountKeys`, `ensureRootKey` for an account without one), the root opens the journal app key (`enableApp`/`openAppKey`, app `journal`). The journal key plays the DEK's role in the keyring (envelope kid `"dek"`, scope personal). The todo key is never stored. If core lacks something, change core, don't work around it here.
- Every sync request is journal-scoped: build clients with `createJournalApiClient` (`x-atlas-sync-apps: journal`). A journal session has no legacy plaintext: `setLegacyMigrated(true)`.
- `apps/journal` — an Expo Router app for the web only (`platforms: ["web"]`); screens take navigation callbacks as props (the `app/` route files wire them) so tests render them without a router. The session keeps the journal keys only sealed under a non-extractable WebCrypto key (`webKeyStore.ts`); the op log is client-core's IndexedDB persistence, one database per account (`atlas-journal-<user>`), deleted at sign-out; Argon2id is hash-wasm's WebAssembly build.

## CI

- Conventional Commits; a fix closing an issue carries `Fixes #N` in the commit body. Work lands on `dev`; `main` takes only PRs from `dev` (`pr-base.yml`).
- `ci.yml`: `Lint`, `Test (journal-core)`, `Test (app)` (jest + the web export), `End to end (server + CLI)`, `Audit (JS)` (continue-on-error), chosen by changed paths; a manual run runs everything, the weekly schedule only the audit. `bun audit` reports only the known unfixable `braces` and `node-forge` advisories; fixable ones go in `overrides`, never an ignore list.
- Nothing is held back on purpose. Dependabot (`.github/dependabot.yml`): weekly version updates for Actions and Bun, grouped minor/patch, targeting `dev`, after a 3-day `cooldown` (security updates never wait). Everything else (`devenv.lock`, the Bun pins, the whole `bun.lock` with transitives and the `overrides`, the Expo SDK's packages via `expo install --fix`, the core pin and its vectors) is `deps:update` (`scripts/update-deps.sh`), which `deps-refresh.yml` runs weekly and opens as one PR from `chore/deps-refresh`. A new Expo SDK major is a migration, flagged as an issue. `overrides` are ranges, never exact pins.
