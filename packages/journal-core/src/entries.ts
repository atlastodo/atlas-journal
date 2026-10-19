/**
 * The journal's entries in a client-core {@link LocalStore}: reads resolve the store's fields
 * through {@link toEntry}, writes are field sets the sync client pushes. Nothing here talks to the
 * network; the engine (`engine.ts`) syncs the store.
 */

import type { EntityKind, LocalStore } from "@atlastodo/client-core";
import {
  JournalError,
  entryChanges,
  isLocked,
  newEntryFields,
  toEntry,
  type Clock,
  type JournalEntry,
  type JournalFields,
} from "./entry";
import { queryEntries, type JournalQuery } from "./query";

/** The Atlas Journal app id: the `x-atlas-sync-apps` scope and the app key's name. */
export const JOURNAL_APP = "journal";

/** The `journal.entry` kind (`manifests/journal.json` in core). */
export const JOURNAL_ENTRY: EntityKind = "journal.entry";

/** An entry, and whether any of its fields is ciphertext this device cannot open yet. */
export interface EntryView extends JournalEntry {
  locked: boolean;
}

export interface JournalEntriesOptions {
  /** Unix ms; `Date.now` by default. */
  now?: () => number;
  /** IANA zone for "today"; the device's local time by default. */
  timeZone?: string;
}

export class JournalEntries {
  private readonly now: () => number;
  private readonly timeZone?: string;

  constructor(
    private readonly store: LocalStore,
    opts: JournalEntriesOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.timeZone = opts.timeZone;
  }

  private clock(): Clock {
    return { now: this.now(), timeZone: this.timeZone };
  }

  /** Changes whenever an entry does; a memo key for derived lists. */
  revision(): number {
    return this.store.revision(JOURNAL_ENTRY);
  }

  /** Every entry, trashed ones included, unordered. */
  all(): EntryView[] {
    return this.store
      .list(JOURNAL_ENTRY)
      .map((e) => ({ ...toEntry(e.id, e.fields), locked: isLocked(e.fields) }));
  }

  /** Entries outside the trash matching `query`, newest date first (the CLI's `list`). */
  list(query: JournalQuery = {}): EntryView[] {
    return queryEntries(this.all(), query, this.clock()) as EntryView[];
  }

  /** Entries in the trash, most recently trashed first. */
  trashed(): EntryView[] {
    return this.all()
      .filter((e) => e.deleted_at !== null)
      .sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
  }

  /** One entry by id, trashed or not; null when there is none. */
  get(id: string): EntryView | null {
    const fields = this.store.get(JOURNAL_ENTRY, id);
    return fields ? { ...toEntry(id, fields), locked: isLocked(fields) } : null;
  }

  private require(id: string): EntryView {
    const entry = this.get(id);
    if (!entry) throw new JournalError("unknown_journal_entry", `no journal entry "${id}"`);
    return entry;
  }

  private write(id: string, fields: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(fields)) {
      this.store.set(JOURNAL_ENTRY, id, field, value);
    }
  }

  /** Write a new entry; `date` defaults to today. Throws {@link JournalError} on bad input. */
  create(input: JournalFields): EntryView {
    const fields = newEntryFields(input, this.clock());
    const id = this.store.newEntityId();
    this.write(id, fields);
    return this.require(id);
  }

  /** Change the given fields; unchanged values write nothing. */
  update(id: string, patch: JournalFields): EntryView {
    const entry = this.require(id);
    if (entry.locked) throw new JournalError("bad_input", "this entry cannot be opened yet");
    const changes = entryChanges(entry, patch, this.clock());
    if (Object.keys(changes).length > 0) this.write(id, changes);
    return this.require(id);
  }

  /** Move an entry to the trash (`deleted_at`); a no-op when it already is. */
  trash(id: string): void {
    const entry = this.require(id);
    if (entry.deleted_at !== null) return;
    const now = this.now();
    this.write(id, { deleted_at: now, updated_at: now });
  }

  /** Take an entry out of the trash; a no-op when it is not in it. */
  restore(id: string): void {
    const entry = this.require(id);
    if (entry.deleted_at === null) return;
    this.write(id, { deleted_at: null, updated_at: this.now() });
  }
}
