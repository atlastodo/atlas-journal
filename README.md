# Atlas Journal

Atlas Journal is a test app for Atlas core: it checks that core's client libraries, server and CLI
work for an app other than todo. It is not a product and has no releases.

Core is [atlastodo/atlas](https://github.com/atlastodo/atlas). This repository builds a small
journal on top of it (entries with a date, title, body, mood and tags, kept under an app key of
their own, end-to-end encrypted and synced in their own scope) and tests it against core:

- `packages/journal-core`: the journal logic over core's packages from npm
  ([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core)): the entry
  rules (checked against the `atlas` CLI's golden runs), the entry store, opening the journal key,
  journal API tokens and the sync engine, with unit tests and end-to-end tests that run this code
  and the `atlas` CLI against a real core server.
- `apps/journal`: an Expo web app over it, for trying core by hand in a browser (and for the
  browser end-to-end run).

It adds no crypto, storage or sync of its own: when core lacks something, core changes. Moving the
pinned core version here is how a core release gets exercised by a second app.

## Run the tests

Everything runs in the devenv shell (`devenv shell`, or `devenv shell -- <script>`); see
[AGENTS.md](AGENTS.md) for the details.

```sh
devenv shell
bun install
test:all           # journal-core (vitest) and the app (jest-expo)
lint               # typecheck, ESLint, Prettier, licences
web:export         # the web build must export
e2e:cli            # journal-core and the atlas CLI against a real core server
E2E_WEB=1 e2e:cli  # also the web app, served by that server, in headless Chromium
```

`e2e:cli` builds `atlas-server` and `atlas` from a core checkout (`ATLAS_CORE_DIR`, default
`../atlas`; or pass prebuilt binaries as `ATLAS_SERVER_BIN` and `ATLAS_CLI`) and creates a
throwaway database on a Postgres (`E2E_DATABASE_URL`, default
`postgres://atlas:atlas@localhost:5432/postgres`). CI runs the same suites against the pinned core
release's server image and CLI binary.

## Run the web app against a core server

In the core checkout, start Postgres and a server that offers the journal:

```sh
devenv up                                  # Postgres
ATLAS_APPS=todo,journal cargo run -p atlas-server
```

Then here, `web:dev` serves the app on http://localhost:8081 against `EXPO_PUBLIC_API_URL`
(default `http://localhost:8080`); the sign-in screen also takes another server's address.

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
