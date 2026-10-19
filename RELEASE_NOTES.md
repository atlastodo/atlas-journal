## v0.1.0-rc.1

The first preview of Atlas Journal, an end-to-end encrypted journal on your Atlas account. Sign in with your Atlas Todo account, or create one. It needs an Atlas server with the journal app enabled (`ATLAS_APPS=todo,journal`, core v0.1.11-rc.8 or later); serve the web build attached here as static files. Entries made with `atlas journal` show up in the app, and the other way round. Android builds come once signing is set up.

### Features
- Atlas Journal for the web and Android
- Open the journal app key, journal API tokens and the sync engine
- Journal entry rules at parity with the atlas CLI

### Fixes
- Override uuid and js-yaml to their patched releases
- Read cargo metadata past the devenv shell banner

### Documentation
- README and agent guide

### Maintenance
- 2 dependency updates, 4 maintenance commits (CI, build, tests)
