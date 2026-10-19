import { describe, expect, it } from "vitest";
import type { JournalEntry } from "./entry";
import { groupByDate, matchesSearch, queryEntries, tagCounts } from "./query";

function entry(id: string, date: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    date,
    title: "",
    body: "",
    mood: null,
    tags: [],
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    ...extra,
  };
}

const clock = { now: Date.UTC(2026, 9, 18, 12), timeZone: "UTC" };

describe("queryEntries", () => {
  const all = [
    entry("b", "2026-10-17", { created_at: 1, title: "Harbour", tags: ["Walks"] }),
    entry("a", "2026-10-17", { created_at: 2, body: "fog over the water" }),
    entry("c", "2026-10-18", { tags: ["work"] }),
    entry("d", "2026-10-01", { deleted_at: 5, title: "Harbour" }),
  ];

  it("lists newest day first, then newest written, without the trash", () => {
    expect(queryEntries(all, {}, clock).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("filters by day range, tag and text like the CLI", () => {
    expect(queryEntries(all, { from: "today" }, clock).map((e) => e.id)).toEqual(["c"]);
    expect(queryEntries(all, { to: "yesterday" }, clock).map((e) => e.id)).toEqual(["a", "b"]);
    expect(queryEntries(all, { tag: "WALKS" }, clock).map((e) => e.id)).toEqual(["b"]);
    expect(queryEntries(all, { search: "FOG" }, clock).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("matchesSearch", () => {
  const e = entry("x", "2026-10-18", { title: "Harbour walk", body: "Fog", tags: ["Sea"] });
  it("matches every word in the title, body or tags, and #tag exactly", () => {
    expect(matchesSearch(e, "")).toBe(true);
    expect(matchesSearch(e, "harbour fog")).toBe(true);
    expect(matchesSearch(e, "harbour rain")).toBe(false);
    expect(matchesSearch(e, "se")).toBe(true);
    expect(matchesSearch(e, "#sea")).toBe(true);
    expect(matchesSearch(e, "#se")).toBe(false);
  });
});

describe("groupByDate and tagCounts", () => {
  it("groups consecutive days and counts live tags", () => {
    const list = [
      entry("1", "2026-10-18", { tags: ["a", "B"] }),
      entry("2", "2026-10-18", { tags: ["b"] }),
      entry("3", "2026-10-17", { tags: ["c"] }),
      entry("4", "2026-10-16", { tags: ["z"], deleted_at: 1 }),
    ];
    expect(groupByDate(list).map((g) => [g.date, g.entries.length])).toEqual([
      ["2026-10-18", 2],
      ["2026-10-17", 1],
      ["2026-10-16", 1],
    ]);
    expect(tagCounts(list)).toEqual([
      { tag: "B", count: 2 },
      { tag: "a", count: 1 },
      { tag: "c", count: 1 },
    ]);
  });
});
