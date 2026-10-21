{ pkgs, lib, config, inputs, ... }:

let
  # The sync server lives in the core repository (atlastodo/atlas) and must offer Atlas Journal
  # (ATLAS_APPS=todo,journal). The scripts that need one talk to EXPO_PUBLIC_API_URL (default
  # http://localhost:8080) and only check that it answers.
  requireServer = ''
    api_url="''${EXPO_PUBLIC_API_URL:-http://localhost:8080}"
    if ! curl -sf "$api_url/health" >/dev/null 2>&1 && ! curl -sf "$api_url/api/health" >/dev/null 2>&1; then
      echo "!! No Atlas server answers at $api_url. The server is in the core repository" >&2
      echo "   (https://github.com/atlastodo/atlas): run it there with ATLAS_APPS=todo,journal" >&2
      echo "   (devenv up, then cargo run -p atlas-server), or its image, or point" >&2
      echo "   EXPO_PUBLIC_API_URL at another server. Continuing: the app starts anyway and" >&2
      echo "   shows the sign-in screen's server field." >&2
    fi
  '';
in
{
  # ---------------------------------------------------------------------------
  # Atlas Journal development environment.
  #
  #   - Node + Bun (apps/journal: the Expo web app; packages/journal-core: the platform-free
  #     journal logic)
  #
  # The sync server (Rust + PostgreSQL), the `atlas` CLI and the core packages are in the core
  # repository, https://github.com/atlastodo/atlas; this app installs the core packages from npm.
  # ---------------------------------------------------------------------------

  languages.javascript = {
    enable = true;
    # Node 26, matching `engines` and CI. Node is the runtime; Bun is the package manager. Bun is
    # pinned to 1.4.2 through this lock's nixpkgs, in lockstep with BUN_VERSION in the workflows.
    package = pkgs.nodejs_26;
    bun.enable = true;
  };

  packages = with pkgs; [
    git
    curl
    jq
    # psql, for the throwaway database of scripts/e2e-cli.sh.
    postgresql
  ];

  # --- Scripts (developer entry points) --------------------------------------
  # `web:dev`: the web app on the Expo web dev server, pointed at EXPO_PUBLIC_API_URL.
  scripts."web:dev".exec = requireServer + ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/journal"
    # EXPO_UNSTABLE_HEADLESS keeps the React Native DevTools shell (which cannot load on NixOS)
    # from starting; the web app is debugged in the browser's own devtools.
    EXPO_PUBLIC_API_URL="$api_url" EXPO_UNSTABLE_HEADLESS=1 bun run web "$@"
  '';
  # The web export in apps/journal/dist (EXPO_PUBLIC_API_URL baked in when set).
  scripts."web:export".exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT/apps/journal" && bun run export:web "$@"
  '';
  # Named test:all -- a script called "test" collides with the shell builtin.
  scripts."test:all".exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    # `--bun` runs vitest under Bun's runtime, matching CI.
    (cd packages/journal-core && bunx --bun vitest run)
    # jest-expo must run under real Node (`bun run` only starts it).
    (cd apps/journal && bun run test)
  '';
  # The app and the atlas CLI against a real server: entries written by either show up in the
  # other. Needs a core checkout (ATLAS_CORE_DIR, default ../atlas) and a Postgres; see
  # scripts/e2e-cli.sh.
  scripts."e2e:cli".exec = ''bash "$DEVENV_ROOT/scripts/e2e-cli.sh" "$@"'';
  # Typecheck every workspace, oxlint (`.oxlintrc.json`), `prettier --check` and the shipped licences.
  scripts.lint.exec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"
    (cd packages/journal-core && bun run typecheck)
    (cd apps/journal && bun run typecheck)
    bunx oxlint .
    bunx prettier --check .
    node scripts/third-party-licenses.mjs --check
  '';
  scripts.fmt.exec = ''
    cd "$DEVENV_ROOT"
    bunx prettier --write .
  '';
  # Refresh everything Dependabot cannot update (the devenv lock, the Bun pins, the whole bun.lock,
  # the Expo SDK packages, the core pin and its vectors): scripts/update-deps.sh, which
  # .github/workflows/deps-refresh.yml runs weekly.
  scripts."deps:update".exec = ''bash "$DEVENV_ROOT/scripts/update-deps.sh" "$@"'';
  # Refresh test-vectors/journal_cli_golden.json from a core checkout (default ../atlas).
  scripts."vectors:sync".exec = ''
    node "$DEVENV_ROOT/scripts/sync-vectors.mjs" "''${1:-$DEVENV_ROOT/../atlas}" "''${2:-origin/dev}"
  '';

  enterShell = ''
    if [ -n "''${DEVENV_PROFILE:-}" ]; then
      export PATH="$DEVENV_PROFILE/bin:$PATH"
    fi
    echo "Atlas Journal dev shell -- node $(node --version), bun $(bun --version)"
    echo "Scripts: web:dev, test:all, e2e:cli, lint, fmt, deps:update (the server is in atlastodo/atlas)"
  '';

  enterTest = ''
    test:all
  '';
}
