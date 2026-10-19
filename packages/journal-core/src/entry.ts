/**
 * Atlas Journal entries (`journal.entry`, `manifests/journal.json` in the core repository): what
 * an entry is and the rules for writing one. They are the rules of the `atlas journal entries`
 * CLI (`crates/atlas-client/src/journal.rs` in core), which this app must agree with, so an entry
 * either side writes reads the same on the other. `test-vectors/journal_cli_golden.json` (the
 * CLI's golden runs) pins them: `entry.golden.test.ts` replays it.
 *
 * An entry's fields, as stored (every one end-to-end encrypted under the journal app key):
 * - `date`: the day the entry is about, `YYYY-MM-DD` (a calendar date, no zone).
 * - `title`, `body`: text; either may be empty, not both. The body is plain text or Markdown.
 * - `mood`: 1 (awful) to 5 (great), or null.
 * - `tags`: a list of distinct (case-insensitive), trimmed, non-empty strings.
 * - `created_at`, `updated_at`: unix ms; `deleted_at`: unix ms once in the trash, else null.
 */

import { isEncryptedEnvelope } from "@atlastodo/client-core";

/** An entry as the app and integrations see it (the CLI prints exactly these keys). */
export interface JournalEntry {
  id: string;
  date: string;
  title: string;
  body: string;
  mood: Mood | null;
  tags: string[];
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type Mood = 1 | 2 | 3 | 4 | 5;

export const MOODS: readonly Mood[] = [1, 2, 3, 4, 5];

/** The fields of a new entry, or a change to one: `undefined` is "not given", `mood: null` clears it. */
export interface JournalFields {
  date?: string;
  title?: string;
  body?: string;
  mood?: number | null;
  tags?: string[];
}

/** Input the rules refuse; `code` and `message` are the CLI's (`bad_input`, `unknown_journal_entry`). */
export class JournalError extends Error {
  constructor(
    readonly code: "bad_input" | "unknown_journal_entry",
    message: string,
  ) {
    super(message);
    this.name = "JournalError";
  }
}

function bad(message: string): JournalError {
  return new JournalError("bad_input", message);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether `text` is a calendar day `YYYY-MM-DD` (zero-padded, a real date). */
export function isCalendarDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * The calendar day `now` falls on: in `timeZone` (an IANA name) when given, else in the device's
 * local time.
 */
export function dayOf(now: number, timeZone?: string): string {
  if (!timeZone) {
    const d = new Date(now);
    return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${pad(part("year"), 4)}-${pad(part("month"), 2)}-${pad(part("day"), 2)}`;
}

/** `day` moved by `days` calendar days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}

/** Where "today" is: the clock and, optionally, a time zone (the device's local time without). */
export interface Clock {
  now: number;
  timeZone?: string;
}

/** An entry date: `YYYY-MM-DD`, or `today`, `yesterday` or `tomorrow` at `clock`. */
export function parseEntryDate(text: string, clock: Clock): string {
  const t = text.trim();
  const offset = { today: 0, yesterday: -1, tomorrow: 1 }[t.toLowerCase()];
  if (offset !== undefined) return addDays(dayOf(clock.now, clock.timeZone), offset);
  if (!isCalendarDay(t)) {
    throw bad(`"${text}" is not a date (YYYY-MM-DD, today, yesterday or tomorrow)`);
  }
  return t;
}

/** A mood: a whole number from 1 to 5. */
export function checkMood(value: unknown): Mood {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
    return value as Mood;
  }
  throw bad("mood must be 1 (awful) to 5 (great)");
}

/** Tags trimmed, without empty ones or repeats (case-insensitive), in order. */
export function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** Read an entry's stored fields, tolerating values of the wrong shape (another client's). */
export function toEntry(id: string, fields: Record<string, unknown>): JournalEntry {
  const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
  let mood: Mood | null = null;
  try {
    mood = checkMood(fields.mood);
  } catch {
    mood = null;
  }
  return {
    id,
    date: text("date"),
    title: text("title"),
    body: text("body"),
    mood,
    tags: Array.isArray(fields.tags)
      ? fields.tags.filter((t): t is string => typeof t === "string")
      : [],
    created_at: int(fields.created_at) ?? 0,
    updated_at: int(fields.updated_at) ?? 0,
    deleted_at: int(fields.deleted_at),
  };
}

/** Whether some field still holds ciphertext no key on this device opens (don't edit such an entry). */
export function isLocked(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some((v) => isEncryptedEnvelope(v));
}

/** The field values of a new entry, validated; `date` defaults to today at `clock`. */
export function newEntryFields(input: JournalFields, clock: Clock): Record<string, unknown> {
  const date = input.date ? parseEntryDate(input.date, clock) : parseEntryDate("today", clock);
  const title = (input.title ?? "").trim();
  const body = input.body ?? "";
  if (!title && !body.trim()) throw bad("a journal entry needs a title or a body");
  const mood = input.mood === undefined || input.mood === null ? null : checkMood(input.mood);
  return {
    date,
    title,
    body,
    mood,
    tags: cleanTags(input.tags ?? []),
    created_at: clock.now,
    updated_at: clock.now,
  };
}

/**
 * The fields a change to `entry` writes: only the values that differ, and `updated_at` when any
 * does. Empty when nothing changes.
 */
export function entryChanges(
  entry: JournalEntry,
  patch: JournalFields,
  clock: Clock,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (patch.date !== undefined) {
    const date = parseEntryDate(patch.date, clock);
    if (date !== entry.date) changes.date = date;
  }
  const title = patch.title?.trim();
  const nextTitle = title ?? entry.title;
  const nextBody = patch.body ?? entry.body;
  if (!nextTitle && !nextBody.trim()) throw bad("a journal entry needs a title or a body");
  if (title !== undefined && title !== entry.title) changes.title = title;
  if (patch.body !== undefined && patch.body !== entry.body) changes.body = patch.body;
  if (patch.mood !== undefined) {
    const mood = patch.mood === null ? null : checkMood(patch.mood);
    if (mood !== entry.mood) changes.mood = mood;
  }
  if (patch.tags !== undefined) {
    const tags = cleanTags(patch.tags);
    if (tags.length !== entry.tags.length || tags.some((t, i) => t !== entry.tags[i])) {
      changes.tags = tags;
    }
  }
  if (Object.keys(changes).length > 0) changes.updated_at = clock.now;
  return changes;
}
