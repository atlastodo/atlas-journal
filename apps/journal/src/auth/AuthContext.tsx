import "../lib/argon2id";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  mergeRotatedTokens,
  reconcileStoredSession,
  type ApiClient,
  type AuthResponse,
  type TokenStore,
} from "@atlastodo/client-core";
import {
  createJournalApiClient,
  keysFromHex,
  signIn as signInFlow,
  signUp as signUpFlow,
  unlock as unlockFlow,
  type JournalKeys,
  type JournalSession,
} from "@atlastodo/journal-core";
import { deleteDatabase } from "../data/persistence";
import { detectDeviceName } from "../lib/deviceName";
import { loadServerUrl, setServerUrlOverride } from "./serverUrl";
import {
  dropSession,
  readSession,
  refreshGrace,
  subscribeSession,
  withRefreshLock,
  writeSession,
} from "./sessionStore";

/**
 * The signed-in account and a token-bound, journal-scoped `ApiClient`.
 *
 * - The session is restored before anything renders (`restored`). A session without its journal
 *   keys is locked: the app asks for the password (`unlock`) before anything syncs.
 * - Rotated tokens are merged into the session as it is now and persisted (the journal keys are
 *   never in an auth response, so the merge keeps them).
 * - Signing out ends the device session on the server and deletes this device's journal database,
 *   which holds every entry decrypted.
 */
export interface AuthValue {
  restored: boolean;
  serverUrl: string;
  api: ApiClient;
  session: JournalSession | null;
  /** The unlocked journal keys, or null (signed out or locked). */
  keys: JournalKeys | null;
  /** Set right after sign-up until the user confirms they saved it. */
  recoveryPhrase: string | null;
  dismissRecoveryPhrase: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  /** Resolves false for a wrong password. */
  unlock: (password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Point the (signed-out) app at another server. */
  changeServerUrl: (url: string) => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [api, setApi] = useState<ApiClient | null>(null);
  const [session, setSession] = useState<JournalSession | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const sessionRef = useRef<JournalSession | null>(null);
  const apiRef = useRef<ApiClient | null>(null);
  // Read by the auth flows, which may run right after `changeServerUrl` in one handler.
  const serverUrlRef = useRef("");

  const commit = useCallback((next: JournalSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearLocal = useCallback(() => {
    apiRef.current?.setTokens(undefined, undefined);
    apiRef.current?.setKeyring(null);
    commit(null);
    setRecoveryPhrase(null);
  }, [commit]);

  const persist = useCallback(
    async (next: JournalSession) => {
      commit(next);
      try {
        await writeSession(next);
      } catch (err) {
        console.warn("[atlas-journal] could not persist the session:", err);
      }
    },
    [commit],
  );

  const tokenStore = useMemo<TokenStore>(
    () => ({
      read: async () => {
        const stored = await readSession();
        return stored && { accessToken: stored.accessToken, refreshToken: stored.refreshToken };
      },
      write: async (auth: AuthResponse) => {
        const prev = sessionRef.current;
        if (!prev) return; // signed out while the rotation was in flight
        await persist(mergeRotatedTokens(prev, auth) as JournalSession);
      },
      withRefreshLock,
      refreshGrace,
    }),
    [persist],
  );

  const endSession = useCallback(() => {
    void dropSession().catch(() => {});
    clearLocal();
  }, [clearLocal]);

  const buildClient = useCallback(
    (baseUrl: string, stored: JournalSession | null) => {
      serverUrlRef.current = baseUrl;
      setServerUrl(baseUrl);
      const client = createJournalApiClient({
        baseUrl,
        token: stored?.accessToken,
        refreshToken: stored?.refreshToken,
        tokenStore,
        onAuthExpired: endSession,
      });
      apiRef.current = client;
      setApi(client);
      return client;
    },
    [tokenStore, endSession],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [url, stored] = await Promise.all([loadServerUrl(), readSession()]);
      if (cancelled) return;
      buildClient(url, stored);
      commit(stored);
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [buildClient, commit]);

  // Another tab signed in, rotated, unlocked or signed out (web only).
  useEffect(
    () =>
      subscribeSession((stored) => {
        const current = sessionRef.current;
        const next = reconcileStoredSession(current, stored) as JournalSession | null;
        if (next === current) return;
        if (!next) {
          clearLocal();
          return;
        }
        apiRef.current?.setTokens(next.accessToken, next.refreshToken);
        // Keep this tab's unlocked keys when the write lacks them for the same account.
        const keep =
          current?.user.id === next.user.id && current.journalKey && !next.journalKey
            ? { journalKey: current.journalKey, journalPrivateKey: current.journalPrivateKey }
            : {};
        commit({ ...next, ...keep });
      }),
    [clearLocal, commit],
  );

  const requireClient = useCallback(() => {
    const client = apiRef.current;
    if (!client) throw new Error("the app is still starting");
    if (!serverUrlRef.current) throw new Error("Enter your Atlas server's address first.");
    return client;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = requireClient();
      const signed = await signInFlow(client, email, password, {
        deviceName: detectDeviceName(),
      });
      await writeSession(signed.session);
      commit(signed.session);
    },
    [requireClient, commit],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const client = requireClient();
      const signed = await signUpFlow(
        client,
        { email, password, displayName },
        { deviceName: detectDeviceName() },
      );
      await writeSession(signed.session);
      setRecoveryPhrase(signed.recoveryPhrase);
      commit(signed.session);
    },
    [requireClient, commit],
  );

  const unlock = useCallback(
    async (password: string) => {
      const client = apiRef.current;
      const current = sessionRef.current;
      if (!client || !current) return false;
      try {
        const opened = await unlockFlow(client, current, password);
        await persist(opened.session);
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "WrongPasswordError") return false;
        throw err;
      }
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    await apiRef.current?.logout().catch(() => {});
    await dropSession().catch(() => {});
    clearLocal();
    if (current) {
      await deleteDatabase(current.user.id).catch((err) =>
        console.warn("[atlas-journal] could not delete the local journal:", err),
      );
    }
  }, [clearLocal]);

  const changeServerUrl = useCallback(
    async (url: string) => {
      await setServerUrlOverride(url);
      buildClient(await loadServerUrl(), null);
    },
    [buildClient],
  );

  // Keyed on the key strings, not the session: a token rotation must not restart the journal.
  const journalKey = session?.journalKey;
  const journalPrivateKey = session?.journalPrivateKey;
  const keys = useMemo(
    () => (journalKey && journalPrivateKey ? keysFromHex(journalKey, journalPrivateKey) : null),
    [journalKey, journalPrivateKey],
  );

  const value = useMemo<AuthValue | null>(
    () =>
      api
        ? {
            restored,
            serverUrl,
            api,
            session,
            keys,
            recoveryPhrase,
            dismissRecoveryPhrase: () => setRecoveryPhrase(null),
            signIn,
            signUp,
            unlock,
            signOut,
            changeServerUrl,
          }
        : null,
    [
      api,
      restored,
      serverUrl,
      session,
      keys,
      recoveryPhrase,
      signIn,
      signUp,
      unlock,
      signOut,
      changeServerUrl,
    ],
  );

  if (!value) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
