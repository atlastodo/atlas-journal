/**
 * The journal's offline-first store and its sync: a client-core {@link LocalStore} over a durable
 * op log ({@link Persistence}: IndexedDB in a browser, SQLite on a phone), kept in step with the
 * server by a {@link SyncClient} scoped to the journal app.
 *
 * Edits land in the local store first and are pushed in the background; the server's ops for the
 * journal (and only those: the client's `ApiClient` names `journal` in `x-atlas-sync-apps`) are
 * pulled, or arrive over the realtime socket, and merge field by field (HLC last-writer-wins).
 * Every field is encrypted under the journal app key before it leaves the device.
 */

import {
  LocalStore,
  SyncClient,
  type ApiClient,
  type Operation,
  type Persistence,
  type SyncResult,
  type SyncStatus,
} from "@atlastodo/client-core";
import { journalKeyring, type JournalKeys } from "./account";
import { JournalEntries } from "./entries";

export interface JournalEngineOptions {
  /** A journal-scoped client (`createJournalApiClient`) with the session's tokens. */
  api: ApiClient;
  /** The device's op log; client-core's `MemoryPersistence` keeps nothing. */
  persistence: Persistence;
  /** This device's id: the clocks' tiebreak, so it must be stable for the device. */
  deviceId: string;
  keys: JournalKeys;
  /** Entity ids; must be UUIDs (Hermes has no `crypto.randomUUID`, so the app passes one). */
  newId?: () => string;
  now?: () => number;
  timeZone?: string;
  /** Use the server's realtime socket as well as the poll. */
  realtime?: boolean;
  onStatus?: (status: SyncStatus) => void;
  onSynced?: (result: SyncResult) => void;
  onError?: (err: unknown) => void;
  onQuarantine?: (op: Operation, err: unknown) => void;
  onPersistError?: (err: unknown) => void;
}

export class JournalEngine {
  readonly store: LocalStore;
  readonly entries: JournalEntries;
  private sync: SyncClient | null = null;
  private started = false;

  constructor(private readonly opts: JournalEngineOptions) {
    this.store = new LocalStore(opts.deviceId, {
      persistence: opts.persistence,
      newId: opts.newId,
      now: opts.now,
      onPersistError: opts.onPersistError,
    });
    this.entries = new JournalEntries(this.store, { now: opts.now, timeZone: opts.timeZone });
  }

  /**
   * Load the local log (offline edits are there before any network), install the journal key
   * and build the sync client at the stored cursor. Call once; then {@link syncNow}.
   */
  async start(): Promise<void> {
    if (this.started) throw new Error("the journal engine is already started");
    this.started = true;
    const { api, persistence } = this.opts;
    await this.store.hydrate();
    api.setKeyring(journalKeyring(this.opts.keys));
    // A journal has no values from before encryption: plaintext in a field is a forgery, dropped.
    api.setLegacyMigrated(true);
    const cursor = await persistence.getCursor();
    const bootstrap = (await persistence.getBootstrap?.()) ?? null;
    this.sync = new SyncClient(this.store, api, {
      cursor: Number.isFinite(cursor) ? cursor : 0,
      bootstrap,
      onBootstrapProgress: (progress, page) => {
        persistence.setBootstrap?.(progress, page).catch((err) => this.opts.onError?.(err));
      },
      onCursor: (c) => {
        // A failed write only means the next start pulls a little more.
        persistence.setCursor(c).catch((err) => this.opts.onError?.(err));
      },
      onStatus: this.opts.onStatus,
      onSynced: this.opts.onSynced,
      onError: this.opts.onError,
      onQuarantine: this.opts.onQuarantine,
      realtime: this.opts.realtime ? { url: (since) => api.syncWsUrl(since) } : undefined,
    });
  }

  /** One push-then-pull cycle (single-flight); rejects when it fails. */
  syncNow(): Promise<SyncResult> {
    if (!this.sync) throw new Error("start the journal engine first");
    return this.sync.sync();
  }

  /** Changes not on the server yet. */
  pendingCount(): number {
    return this.store.unsyncedOps().length;
  }

  isRealtimeLive(): boolean {
    return this.sync?.isRealtimeLive() ?? false;
  }

  /** Close the socket, let queued writes land and release the database. */
  async stop(): Promise<void> {
    this.sync?.dispose();
    this.sync = null;
    await this.store.flush().catch(() => {});
    await this.opts.persistence.close?.();
    this.opts.api.setKeyring(null);
  }
}
