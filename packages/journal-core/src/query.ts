/**
 * Finding entries: the filters of `atlas journal entries list` (from, to, tag, search) and the
 * order it lists them in, plus the grouping by day the app's list shows.
 */

import { parseEntryDate, type Clock, type JournalEntry } from "./entry";

export interface JournalQuery {
  /** Entries dated on or after this day (`YYYY-MM-DD`, `today`, `yesterday`, `tomorrow`). */
  from?: string;
  /** Entries dated on or before this day. */
  to?: string;
  /** A tag, case-insensitive. */
  tag?: string;
  /** A case-insensitive substring of the title or body. */
  search?: string;
}

/** Newest date first, then newest written, then by id: the CLI's order. */
export function compareEntries(a: JournalEntry, b: JournalEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `entries` matching `query`, in {@link compareEntries} order. Trashed entries are left out. */
export function queryEntries(
  entries: readonly JournalEntry[],
  query: JournalQuery,
  clock: Clock,
): JournalEntry[] {
  const day = (d: string | undefined) => (d ? parseEntryDate(d, clock) : null);
  const from = day(query.from);
  const to = day(query.to);
  const tag = query.tag ? query.tag.toLowerCase() : null;
  const search = query.search ? query.search.toLowerCase() : null;
  return entries
    .filter((e) => e.deleted_at === null)
    .filter((e) => from === null || e.date >= from)
    .filter((e) => to === null || e.date <= to)
    .filter((e) => tag === null || e.tags.some((t) => t.toLowerCase() === tag))
    .filter(
      (e) =>
        search === null ||
        e.title.toLowerCase().includes(search) ||
        e.body.toLowerCase().includes(search),
    )
    .sort(compareEntries);
}

/**
 * The app's search box: words match the title, body or a tag; `#word` matches a tag exactly
 * (case-insensitive). Every term must match. Whitespace only matches everything.
 */
export function matchesSearch(entry: JournalEntry, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => {
    if (term.startsWith("#") && term.length > 1) {
      const tag = term.slice(1);
      return entry.tags.some((t) => t.toLowerCase() === tag);
    }
    return (
      entry.title.toLowerCase().includes(term) ||
      entry.body.toLowerCase().includes(term) ||
      entry.tags.some((t) => t.toLowerCase().includes(term))
    );
  });
}

export interface DayGroup {
  date: string;
  entries: JournalEntry[];
}

/** Consecutive entries of one day together, keeping their order (sort first). */
export function groupByDate(entries: readonly JournalEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else groups.push({ date: entry.date, entries: [entry] });
  }
  return groups;
}

/** Every tag in use, most used first, then alphabetically; for suggestions and the tag filter. */
export function tagCounts(entries: readonly JournalEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const e of entries) {
    if (e.deleted_at !== null) continue;
    for (const t of e.tags) {
      const key = t.toLowerCase();
      const c = counts.get(key);
      if (c) c.count++;
      else counts.set(key, { tag: t, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
  );
}
