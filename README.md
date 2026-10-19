# Atlas Journal

A private journal, end-to-end encrypted, on your own server. Atlas Journal is the second app of
the [Atlas](https://github.com/atlastodo/atlas) suite: it signs in with the same account as
[Atlas Todo](https://github.com/atlastodo/atlas-todo), but keeps its entries under a key of its
own, and the server only ever stores ciphertext.

- **Entries by day**: a date, a title, a body in plain text (Markdown reads fine), a mood from
  1 (awful) to 5 (great) and tags. Newest day first, grouped by day.
- **Search** words in titles and bodies, or `#tags`; tap a tag to filter by it.
- **Offline first**: everything is saved on the device first and synced in the background, over
  the server's realtime socket when it can. Edits merge field by field across devices.
- **Trash**: deleting moves an entry to the trash, from which it can be restored.
- **The `atlas` CLI and automations**: make a journal API token in Settings and use
  `atlas journal entries …` (or n8n) to read and write the same entries.
- **Web first**, the same app on Android (Expo + React Native, the web through
  react-native-web).

## How it works

Atlas Journal is a client of an Atlas server (the core repository,
[atlastodo/atlas](https://github.com/atlastodo/atlas)); it has no server of its own. The server
must offer the journal: `ATLAS_APPS=todo,journal`.

- **One account, separate keys.** The account password opens the account root key; the root key
  opens one key per app. On the first sign-in, Atlas Journal creates the journal's key and
  identity under the root and enables the journal for the account (client-core's `enableApp`).
  It never keeps Atlas Todo's key, and Atlas Todo never sees the journal's.
- **End-to-end encrypted.** Every field of an entry (`journal.entry`: `date`, `title`, `body`,
  `mood`, `tags`, `created_at`, `updated_at`, `deleted_at`) is encrypted on the device under the
  journal key before it is sent; `manifests/journal.json` in core lists no plaintext field.
- **Its own sync scope.** Journal and todo share the account's op log on the server, but the
  journal syncs only its own ops (`x-atlas-sync-apps: journal`).
- **The CLI's entries.** The entry rules (dates, mood, tags, validation, order) are those of the
  `atlas journal entries` CLI, checked against the CLI's golden runs, and an end-to-end test runs
  the app's code and the CLI against a real server.

The cryptography, store and sync come from the core packages
([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core) on npm); this
repository adds no crypto of its own.

## Use it

- **On the web**: serve the release's `atlas-journal-web-X.Y.Z.tar.gz` from any static host. If
  the Atlas server serves it (its `STATIC_DIR`, or `services.atlas.staticDir` in NixOS) the app
  finds the server on its own origin; anywhere else, type the server's address on the sign-in
  screen. The flake builds the same directory: `nix build github:atlastodo/atlas-journal#web-dist`.
- **On Android**: the release's APK.
- **The CLI**: Settings → API tokens → Create token, then
  `ATLAS_URL=https://your.server ATLAS_TOKEN=atlas_pat_… atlas journal entries list` (see core's
  [integrations guide](https://github.com/atlastodo/atlas/blob/main/docs/integrations.md)).

Account management (password, recovery phrase, passkeys, devices, deleting the account) lives in
Atlas Todo for now; the journal shows the recovery phrase of an account it creates.

## Develop

Everything runs in the devenv shell (`devenv shell`, or `direnv allow`); see [AGENTS.md](AGENTS.md)
for the details.

```sh
devenv shell
bun install
web:dev          # the web app on http://localhost:8081, against EXPO_PUBLIC_API_URL
test:all         # journal-core (vitest) and the app (jest-expo)
lint             # typecheck, ESLint, Prettier, licences, nix/bun.nix
e2e:cli          # the app's code and the atlas CLI against a real server (E2E_WEB=1: also a browser)
```

The server is in the core repository: run it there with `ATLAS_APPS=todo,journal`
(`devenv up`, then `cargo run -p atlas-server`), or its image.

## Layout

- `apps/journal`: the Expo app (Android and the web).
- `packages/journal-core`: the journal without a UI: entry rules, the entry store, opening the
  journal key, journal API tokens and the sync engine; also its end-to-end tests.
- `test-vectors/journal_cli_golden.json`: the CLI's golden runs, copied from core.
- `scripts/`: release tooling and the end-to-end runners.

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
