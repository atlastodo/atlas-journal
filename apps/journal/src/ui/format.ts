import { addDays, type JournalEntry } from "@atlastodo/journal-core";

/** A calendar day as a local `Date` at noon (clear of DST edges). */
function dateOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

/** "Today", "Yesterday", "Tomorrow", else e.g. "Wednesday, 14 October 2026". */
export function formatDay(day: string, today: string, locale?: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day === addDays(today, 1)) return "Tomorrow";
  const date = dateOf(day);
  if (Number.isNaN(date.getTime())) return day || "No date";
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** What a list shows for an entry: its title, else the body's first line. */
export function headline(entry: JournalEntry): string {
  if (entry.title) return entry.title;
  const first = entry.body.split("\n").find((line) => line.trim()) ?? "";
  return first.replace(/^#+\s*/, "").trim() || "Untitled";
}

/** The body as a one-paragraph preview, without the line used as the headline. */
export function preview(entry: JournalEntry): string {
  let body = entry.body.trim();
  if (!entry.title) body = body.split("\n").slice(1).join("\n");
  return body
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A unix-ms time as a short local date and time. */
export function formatTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
