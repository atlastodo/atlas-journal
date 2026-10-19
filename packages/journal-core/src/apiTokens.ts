/**
 * Personal API tokens for Atlas Journal: what the `atlas journal entries …` CLI and automations
 * (n8n) sign in with (`docs/integrations.md` in the core repository, App-scoped tokens). A
 * journal token carries the journal app key and identity wrapped for the token
 * (`wrapAppKeysForApiToken`) and nothing of todo's; the server never sees the token's secret.
 */

import {
  ApiClient,
  deriveApiTokenKeys,
  formatApiToken,
  generateApiToken,
  wrapAppKeysForApiToken,
  type ApiTokenView,
} from "@atlastodo/client-core";
import type { JournalKeys } from "./account";
import { JOURNAL_APP } from "./entries";

/** A token's apps, or todo for a server predating app-scoped tokens. */
export function tokenApps(token: ApiTokenView): string[] {
  return token.apps ?? ["todo"];
}

/** The account's tokens that can read the journal. */
export async function listJournalTokens(api: ApiClient): Promise<ApiTokenView[]> {
  return (await api.listApiTokens()).filter((t) => tokenApps(t).includes(JOURNAL_APP));
}

/**
 * Make a journal-only token named `name`. Resolves the token string, which exists nowhere else:
 * show it once. Needs an interactive session and the `app_scoped_api_tokens` capability.
 */
export async function createJournalToken(
  api: ApiClient,
  input: { userId: string; keys: JournalKeys; name: string },
): Promise<{ token: string; view: ApiTokenView }> {
  const parts = generateApiToken();
  const { auth } = deriveApiTokenKeys(parts);
  const view = await api.createApiToken({
    id: parts.id,
    name: input.name.trim() || "Atlas Journal",
    auth,
    apps: [JOURNAL_APP],
    app_keys: {
      [JOURNAL_APP]: wrapAppKeysForApiToken(parts, input.userId, JOURNAL_APP, {
        appKey: input.keys.appKey,
        privateKey: input.keys.privateKey,
      }),
    },
  });
  return { token: formatApiToken(parts), view };
}
