import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@atlastodo/client-core";
import type { JournalSession } from "@atlastodo/journal-core";

/**
 * Session persistence on a phone: the whole session, journal keys included, in the OS keychain
 * (Android Keystore, iOS Keychain) through expo-secure-store. No plaintext fallback: a failed read
 * is "signed out", a failed write fails the sign-in. The web build resolves `sessionStore.web.ts`.
 */

const KEY = "atlas-journal.session";

export async function readSession(): Promise<JournalSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as JournalSession) : null;
  } catch {
    return null;
  }
}

export async function writeSession(session: JournalSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function dropSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** One client per process: nothing to lock against. */
export const withRefreshLock: TokenStore["withRefreshLock"] = undefined;

export function refreshGrace(): boolean {
  return false;
}

/** A phone has no sibling tabs writing the session. */
export function subscribeSession(_onChange: (session: JournalSession | null) => void): () => void {
  return () => {};
}
