import { LocalStore } from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { JOURNAL_ENTRY, JournalEntries } from "./entries";
import { JournalError, addDays, dayOf, isCalendarDay, parseEntryDate } from "./entry";

const NOW = Date.UTC(2026, 9, 17, 23, 30); // already the 18th in Copenhagen

function setup(now = () => NOW) {
  const store = new LocalStore("device-a");
  return { store, entries: new JournalEntries(store, { now, timeZone: "Europe/Copenhagen" }) };
}

describe("entry dates", () => {
  it("are calendar days, today in the zone", () => {
    const clock = { now: NOW, timeZone: "Europe/Copenhagen" };
    expect(parseEntryDate("today", clock)).toBe("2026-10-18");
    expect(parseEntryDate("Yesterday", clock)).toBe("2026-10-17");
    expect(parseEntryDate("tomorrow", clock)).toBe("2026-10-19");
    expect(parseEntryDate("today", { now: NOW, timeZone: "UTC" })).toBe("2026-10-17");
    expect(parseEntryDate(" 2024-02-29 ", clock)).toBe("2024-02-29");
    for (const bad of ["2025-02-29", "2026-13-01", "2026-1-01", "26-10-17", "next week", ""]) {
      expect(() => parseEntryDate(bad, clock), bad).toThrow(JournalError);
    }
  });

  it("move across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(dayOf(NOW, "Pacific/Auckland")).toBe("2026-10-18");
  });
});

describe("JournalEntries", () => {
  it("creates an entry with the CLI's defaults and cleaning", () => {
    const { entries } = setup();
    const e = entries.create({ title: "  Walk ", body: "Fog.", tags: ["sea", " Sea ", "", "fog"] });
    expect(e).toMatchObject({
      date: "2026-10-18",
      title: "Walk",
      body: "Fog.",
      mood: null,
      tags: ["sea", "fog"],
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      locked: false,
    });
  });

  it("refuses an entry without a title or body, and a bad mood", () => {
    const { entries } = setup();
    expect(() => entries.create({ title: " ", body: "  " })).toThrow(
      "a journal entry needs a title or a body",
    );
    expect(() => entries.create({ title: "x", mood: 6 })).toThrow("mood must be 1");
    expect(() => entries.create({ title: "x", mood: 2.5 })).toThrow("mood must be 1");
  });

  it("updates only what changed, and touches updated_at only then", () => {
    let now = NOW;
    const { store, entries } = setup(() => now);
    const e = entries.create({ title: "A", body: "b", mood: 3, tags: ["x"] });
    const ops = store.unsyncedOps().length;
    now += 1000;
    expect(entries.update(e.id, { title: "A", tags: ["x"], mood: 3 })).toMatchObject({
      updated_at: NOW,
    });
    expect(store.unsyncedOps().length).toBe(ops);
    const changed = entries.update(e.id, { mood: null, tags: ["y"], date: "2026-10-01" });
    expect(changed).toMatchObject({ mood: null, tags: ["y"], date: "2026-10-01" });
    expect(changed.updated_at).toBe(now);
    expect(() => entries.update(e.id, { title: "", body: " " })).toThrow("needs a title");
  });

  it("trashes and restores (soft delete)", () => {
    const { entries } = setup();
    const e = entries.create({ title: "Gone soon" });
    entries.trash(e.id);
    expect(entries.list()).toEqual([]);
    expect(entries.get(e.id)?.deleted_at).toBe(NOW);
    expect(entries.trashed().map((t) => t.id)).toEqual([e.id]);
    entries.restore(e.id);
    expect(entries.list().map((t) => t.id)).toEqual([e.id]);
    expect(entries.get(e.id)?.deleted_at).toBeNull();
  });

  it("names an unknown entry as the CLI does", () => {
    const { entries } = setup();
    expect(() => entries.update("nope", { title: "x" })).toThrow('no journal entry "nope"');
  });

  it("reads another client's odd values leniently and flags ciphertext it cannot open", () => {
    const { store, entries } = setup();
    store.set(JOURNAL_ENTRY, "x", "title", 7);
    store.set(JOURNAL_ENTRY, "x", "body", { __enc: 2, kid: "dek", iv: "aa", ct: "bb" });
    store.set(JOURNAL_ENTRY, "x", "mood", 9);
    store.set(JOURNAL_ENTRY, "x", "tags", ["a", 1]);
    expect(entries.get("x")).toMatchObject({
      title: "",
      body: "",
      mood: null,
      tags: ["a"],
      locked: true,
    });
    expect(() => entries.update("x", { title: "y" })).toThrow("cannot be opened");
  });
});
