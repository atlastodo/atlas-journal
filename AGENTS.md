# AGENTS.md

## Working with the user (standing instruction)

- Before planning work on a bug, ask questions until the bug is properly understood (symptoms, reproduction, expected vs actual).
- Also ask questions about the proposed solution before implementing — don't assume intent.

## What this is

Atlas Journal, the second app of the Atlas suite. A client only: the server, the `atlas` CLI and the core packages are in the core repository, [atlastodo/atlas](https://github.com/atlastodo/atlas) (a checkout is expected at `../atlas` by the scripts). The todo app is [atlastodo/atlas-todo](https://github.com/atlastodo/atlas-todo), the template for this repository's tooling.

## Dev environment

- All dev commands (`web:dev`, `mobile:dev`, `web:export`, `test:all`, `e2e:cli`, `lint`, `fmt`, `nix:bun-lock`, `vectors:sync`, `version:bump`, `build:android:release`, `android:permissions`, …) are devenv scripts in `devenv.nix` — run them inside `devenv shell`. The root `package.json` has **no** scripts. (The full suite is `test:all`, not `test`, which collides with the shell builtin.)
- Bun is the package manager (`bun.lock` committed, lockfile version 1 — bun2nix reads no other; CI installs with `--frozen-lockfile`); Node 26 is the runtime. Bun is pinned to **1.4.2** in devenv (the nixpkgs of `devenv.lock`) and `BUN_VERSION` in `.github/workflows/*.yml` — bump them together.
- The root `typescript` devDependency stays on 6.0 on purpose: typescript-eslint supports TypeScript < 6.1, and ESLint runs from the root. The workspaces typecheck with their own TypeScript 7.
- The core packages come from npm: `@atlastodo/client-core` at an exact version (now `0.1.11-rc.8`). Move it by hand with a core release, together with `CORE_VERSION`/`ATLAS_SERVER_IMAGE` in `ci.yml` (the e2e job's server image and CLI binary) and `test-vectors/` (`vectors:sync`).
- A server for development: in the core checkout, `devenv up` and `ATLAS_APPS=todo,journal cargo run -p atlas-server`; `EXPO_PUBLIC_API_URL` defaults to `http://localhost:8080`.
- The Android SDK is opt-in: a gitignored `devenv.local.nix` with `{ android.enable = true; }`. Only `build:android:*`, `mobile:android` and `android:permissions` need it.

## Verification

- `test:all` = vitest in `packages/journal-core` (under Bun: `bunx --bun vitest run`) → jest-expo in `apps/journal` (must run under real Node: `bun run test`).
- `lint` = `tsc --noEmit` for both workspaces + `eslint .` + `prettier --check .` + `scripts/third-party-licenses.mjs --check` + a stale-`nix/bun.nix` check.
- `e2e:cli` (`scripts/e2e-cli.sh`) = a throwaway database, core's `atlas-server` with `ATLAS_APPS=todo,journal`, and the `atlas` CLI: `packages/journal-core/e2e` proves an entry the CLI adds shows up in the app's store and the reverse (edits and trash too), and that an Atlas Todo account gets its journal key on its first journal sign-in. `E2E_WEB=1` also exports the web app, serves it from that server and drives it in headless Chromium (`scripts/e2e-web.mjs`: sign-up, writing, search, a token made in Settings, the CLI both ways, reload). Binaries are built from `ATLAS_CORE_DIR` (default `../atlas`) or given as `ATLAS_SERVER_BIN`/`ATLAS_CLI`; Postgres from `E2E_DATABASE_URL` (default the devenv one on 5432). CI's `End to end` job runs the same suites against the pinned core release's image and CLI binary.
- The web app is the primary target: `web:export` (or CI's export step) must pass.

## Layout and rules

- `packages/journal-core` — platform-free: `entry.ts` (the entry fields and rules, at parity with `crates/atlas-client/src/journal.rs` in core; `entry.golden.test.ts` replays `test-vectors/journal_cli_golden.json`, the CLI's golden runs — refresh it with `vectors:sync`, never edit it), `query.ts`, `entries.ts` (entries in a client-core `LocalStore`), `account.ts` (sign-in/up/unlock, opening the journal app key), `apiTokens.ts`, `engine.ts` (store + `SyncClient`).
- **No crypto here.** Keys and envelopes are client-core's: the password opens the root (`openAccountKeys`, `ensureRootKey` for an account without one), the root opens the journal app key (`enableApp`/`openAppKey`, app `journal`). The journal key plays the DEK's role in the keyring (envelope kid `"dek"`, scope personal). The todo key is never stored. If core lacks something, change core (a branch in the core repository), don't work around it here.
- Every sync request is journal-scoped: build clients with `createJournalApiClient` (`x-atlas-sync-apps: journal`). A journal session has no legacy plaintext: `setLegacyMigrated(true)`.
- `apps/journal` — Expo Router app; screens take navigation callbacks as props (the `app/` route files wire them) so tests render them without a router. Platform files: `*.web.ts` for the browser (`sessionStore`, `persistence`, `argon2id`, `installKey`). The web session keeps the journal keys only sealed under a non-extractable WebCrypto key (`webKeyStore.ts`); phones keep the session in the OS keychain. Each account has its own local database (`atlas-journal-<user>`), deleted at sign-out.
- `docs/android-permissions.md` is the allowlist the release checks the merged manifest against (`apps/journal/scripts/check-android-permissions.mjs`); block unused permissions in `app.json`.
- The flake builds `web-dist` from source with bun2nix over `nix/bun.nix`: run `nix:bun-lock` after every `bun.lock` change.

## CI & release

- Conventional Commits; a fix closing an issue carries `Fixes #N` in the commit body. Work lands on `dev`; `main` is stable-only and takes only the release PR from `dev` (`pr-base.yml`). Never add AI attribution to commits.
- `ci.yml`: `Lint`, `Test (journal-core)`, `Test (app)` (jest + the web export), `End to end (server + CLI)`, `Audit (JS)` (continue-on-error), chosen by changed paths; a tag or manual run runs everything.
- Versioning is lockstep: `version:bump [--no-notes] <x.y.z|x.y.z-rc.N|patch|minor|major>` updates every manifest, `app.json` (and the derived Android `versionCode`, `scripts/version-code.mjs`), `bun.lock`, `nix/bun.nix` and `RELEASE_NOTES.md`; commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`.
- `release.yml` on a `v*` tag: CI → Prepare (tag = manifests, notes present) → the web tarball (`atlas-journal-web-X.Y.Z.tar.gz`, built with `EXPO_PUBLIC_API_URL=/api`), the signed APK + AAB (only when the four `ANDROID_*` keystore secrets are set), the third-party notices → GitHub Release. The Play upload is off until there is a listing: repository variable `PLAY_UPLOAD=true` plus the `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret (`PLAY_STORE_TRACK`, `PLAY_STORE_PRERELEASE_TRACK` as in the todo app). `ATLAS_APP_ID` and `ATLAS_EAS_PROJECT_ID` override the app id and turn on EAS (`app.config.ts`).
- The Android build caches are written on `main` only (`android-cache.yml`) and read by the tag build: keep the flags in `.github/scripts/android-gradle.sh` shared.
