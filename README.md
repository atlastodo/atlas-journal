# Atlas Journal

Atlas Journal is a test app for Atlas core: it checks that core's client libraries and server work
for an app other than todo. The web app is not a product and has no releases; the
[`atlas-journal` CLI](#the-atlas-journal-cli) is released here.

Core is [atlastodo/atlas](https://github.com/atlastodo/atlas). This repository builds a small
journal on top of it (entries with a date, title, body, mood and tags, kept under an app key of
their own, end-to-end encrypted and synced in their own scope) and tests it against core:

- `packages/journal-core`: the journal logic over core's packages from npm
  ([`@atlastodo/client-core`](https://www.npmjs.com/package/@atlastodo/client-core)): the entry
  rules (checked against the `atlas-journal` CLI's golden runs), the entry store, opening the
  journal key, journal API tokens and the sync engine, with unit tests and end-to-end tests that
  run this code and the CLI against a real core server.
- `crates/`: the same entry rules in Rust on core's `atlas-client` crate (`atlas-journal-rules`)
  and the `atlas-journal` CLI over them.
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
test:all           # the crates (nextest), journal-core (vitest) and the app (jest-expo)
lint               # rustfmt, clippy, typecheck, oxlint, Prettier, licences
web:export         # the web build must export
e2e:cli            # the CLI and journal-core against a real core server
E2E_WEB=1 e2e:cli  # also the web app, served by that server, in headless Chromium
```

`e2e:cli` builds `atlas-server` from a core checkout (`ATLAS_CORE_DIR`, default `../atlas`; or
pass a prebuilt one as `ATLAS_SERVER_BIN`) and `atlas-journal` here (or `ATLAS_CLI`), and creates
a throwaway database on a Postgres (`E2E_DATABASE_URL`, default
`postgres://atlas:atlas@localhost:5432/postgres`). CI runs the same suites against the pinned core
release's server image.

## Run the web app against a core server

In the core checkout, start Postgres and a server that offers the journal:

```sh
devenv up                                  # Postgres
ATLAS_APPS=todo,journal cargo run -p atlas-server
```

Then here, `web:dev` serves the app on http://localhost:8081 against `EXPO_PUBLIC_API_URL`
(default `http://localhost:8080`); the sign-in screen also takes another server's address.

## The `atlas-journal` CLI

`atlas-journal` reads and writes journal entries from scripts, cron or n8n, end to end encrypted:
it signs in with an API token that includes Atlas Journal (made by the journal app, or any client
of it, with `"apps": ["journal"]`; see core's
[integrations guide](https://github.com/atlastodo/atlas/blob/main/docs/integrations.md)), decrypts
the account on the machine it runs on and prints JSON. It needs a server that offers Atlas Journal
(`ATLAS_APPS=todo,journal`). These were the `atlas journal …` commands of core's `atlas` CLI,
which they replace: `atlas-journal journal entries list` still works, and the output is the same.

It is one static binary per platform, attached to each release as `atlas-journal-X.Y.Z-<target>`
(`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` for any Linux, Alpine-based n8n
included; `aarch64-apple-darwin`, `x86_64-apple-darwin`; `x86_64-pc-windows-msvc.exe`):

```sh
VERSION=X.Y.Z
TARGET=x86_64-unknown-linux-musl
BASE=https://github.com/atlastodo/atlas-journal/releases/download/v$VERSION
curl -fLO "$BASE/atlas-journal-$VERSION-$TARGET"
curl -fLO "$BASE/SHA256SUMS.txt"
sha256sum --check --ignore-missing SHA256SUMS.txt
install -m 755 "atlas-journal-$VERSION-$TARGET" /usr/local/bin/atlas-journal
```

Each file carries a build provenance attestation
(`gh attestation verify atlas-journal-$VERSION-$TARGET --repo atlastodo/atlas-journal`). The
environment configures it; the token is never a flag:

| Variable          | What it is                                                 |
| ----------------- | ---------------------------------------------------------- |
| `ATLAS_URL`       | your server, e.g. `https://app.atlastodo.dev` (or `--url`) |
| `ATLAS_TOKEN`     | the API token                                              |
| `ATLAS_TZ`        | IANA time zone for dates, e.g. `Europe/Copenhagen`         |
| `ATLAS_STATE_DIR` | optional: a directory to keep the account in between runs  |

```sh
atlas-journal entries list [--from DAY] [--to DAY] [--tag T] [--search TEXT]
atlas-journal entries get 0192…
atlas-journal entries add --title "Harbour walk" --body "Fog over the water." --mood 4 --tag walks
atlas-journal entries add --json '{"date": "2026-10-16", "body": "From a form", "tags": ["n8n"]}'
atlas-journal entries update 0192… --date yesterday --mood none
atlas-journal entries delete 0192…   # to the trash: deleted_at is set, list leaves it out
```

`DAY` is `YYYY-MM-DD`, `today`, `yesterday` or `tomorrow` (in `ATLAS_TZ`). `list` shows entries
outside the trash, newest date first; `--from` and `--to` are inclusive, `--tag` is
case-insensitive and `--search` matches the title or body. `add` and `update` take flags or a
`--json` object with the same keys (`date`, `title`, `body`, `mood`, `tags`; `--json -` reads it
from stdin); a flag wins over `--json`. `--tag` may be repeated, and on `update` it replaces the
list. `--mood none` (or `"mood": null`) clears the mood, `"tags": []` the tags.

An entry (`journal.entry`) is printed, and stored, with these fields:

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| `id`         | the entry's id (a UUID)                                        |
| `date`       | the day the entry is about, `YYYY-MM-DD`; today when not given |
| `title`      | text, may be empty                                             |
| `body`       | text, may be empty; an entry needs a title or a body           |
| `mood`       | 1 (awful) to 5 (great), or `null`                              |
| `tags`       | a list of strings, trimmed, without repeats (case-insensitive) |
| `created_at` | unix milliseconds                                              |
| `updated_at` | unix milliseconds of the last change                           |
| `deleted_at` | unix milliseconds once in the trash, else `null`               |

Every field is end-to-end encrypted: core's `manifests/journal.json` lists no plaintext field for
`journal.entry`, so the server sees only ids and ciphertext. Every command prints JSON; a failure
prints `{"error": …, "code": …}` on stderr and exits 1 (2 for a usage error). A token without
Atlas Journal fails with `app_not_in_token`, a server that does not offer it with
`server_incompatible`.

## Licence

[GNU Affero General Public License v3.0 only](LICENSE), like the rest of Atlas.
