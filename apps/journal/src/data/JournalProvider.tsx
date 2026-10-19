import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { ApiClient, SyncStatus } from "@atlastodo/client-core";
import { JournalEngine, type JournalEntries, type JournalKeys } from "@atlastodo/journal-core";
import { newId } from "../lib/ids";
import { createPersistence } from "./persistence";
import { describeError } from "../ui/errors";

/** The short poll; the long one while the realtime socket is live and nothing waits to push. */
const SYNC_INTERVAL_MS = 5_000;
const LIVE_SYNC_INTERVAL_MS = 30_000;

export interface JournalValue {
  entries: JournalEntries;
  /** Bumps on every change to the store: a memo key for derived lists. */
  version: number;
  status: SyncStatus;
  /** Changes not on the server yet. */
  pending: number;
  lastError: string | null;
  lastSyncAt: number | null;
  /** Sync now (after a local write, or from the settings). */
  kick: () => void;
}

/** Exported so tests can provide a store without a server. */
export const JournalContext = createContext<JournalValue | null>(null);

export function useJournal(): JournalValue {
  const value = useContext(JournalContext);
  if (!value) throw new Error("useJournal outside JournalProvider");
  return value;
}

/**
 * Owns the journal engine of the unlocked session: the local op log is loaded before the UI shows
 * (offline edits are there on first paint), then sync runs on a poll, on the realtime socket, when
 * the app returns to the foreground and after each local write.
 */
export function JournalProvider({
  api,
  userId,
  deviceId,
  keys,
  children,
  fallback,
}: {
  api: ApiClient;
  userId: string;
  deviceId: string;
  keys: JournalKeys;
  children: ReactNode;
  /** Shown while the local journal loads. */
  fallback: ReactNode;
}) {
  const [engine, setEngine] = useState<JournalEngine | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let made: JournalEngine | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    let appState: { remove: () => void } | undefined;

    void (async () => {
      const persistence = await createPersistence(userId);
      const eng = new JournalEngine({
        api,
        persistence,
        deviceId,
        keys,
        newId,
        realtime: true,
        onStatus: (s) => !cancelled && setStatus(s),
        onSynced: () => {
          if (cancelled) return;
          setLastSyncAt(Date.now());
          setLastError(null);
        },
        onError: (err) => {
          console.warn("[atlas-journal] sync failed:", err);
          if (!cancelled) setLastError(describeError(err));
        },
        onQuarantine: (op, err) =>
          console.warn("[atlas-journal] the server refused a change for good:", op.id, err),
      });
      made = eng;
      await eng.start();
      if (cancelled) {
        await eng.stop();
        return;
      }
      unsubscribe = eng.store.onChange(() => setVersion((v) => v + 1));
      setEngine(eng);

      const run = () => {
        void eng.syncNow().catch(() => {
          // Reported through onError; the next poll retries.
        });
      };
      const schedule = () => {
        if (cancelled) return;
        if (timer) clearTimeout(timer);
        const delay =
          eng.isRealtimeLive() && eng.pendingCount() === 0
            ? LIVE_SYNC_INTERVAL_MS
            : SYNC_INTERVAL_MS;
        timer = setTimeout(() => {
          run();
          schedule();
        }, delay);
      };
      kickRef.current = () => {
        run();
        schedule();
      };
      run();
      schedule();
      appState = AppState.addEventListener("change", (next) => {
        if (next === "active") kickRef.current();
      });
    })().catch((err: unknown) => {
      console.warn("[atlas-journal] could not open the local journal:", err);
      if (!cancelled) setLastError(describeError(err));
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      appState?.remove();
      kickRef.current = () => {};
      void made?.stop().catch(() => {});
      setEngine(null);
    };
  }, [api, userId, deviceId, keys]);

  const value = useMemo<JournalValue | null>(
    () =>
      engine
        ? {
            entries: engine.entries,
            version,
            status,
            pending: engine.pendingCount(),
            lastError,
            lastSyncAt,
            kick: () => kickRef.current(),
          }
        : null,
    // `version` changes with every store write, which is what `pending` follows.
    [engine, version, status, lastError, lastSyncAt],
  );

  if (!value) return <>{fallback}</>;
  return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
}
