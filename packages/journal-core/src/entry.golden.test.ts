/**
 * The `atlas journal entries` golden runs (test-vectors/journal_cli_golden.json, copied from the
 * core repository's cli_golden.json) replayed through this package's entry rules: every command
 * the CLI ran succeeds or fails here the same way, with the same JSON. That is what lets an entry
 * written by either the app or the CLI read identically on the other.
 *
 * Only argument parsing is the test's own (a few lines, mirroring the CLI's `journal_fields`);
 * usage errors (exit 2) are the CLI's parser and are skipped.
 */
import { readFileSync } from "node:fs";
import { LocalStore } from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { JournalError, checkMood, type JournalFields } from "./entry";
import { JOURNAL_ENTRY, JournalEntries } from "./entries";

interface Step {
  seed?: { entity: string; ref: string; fields: Record<string, unknown> };
  argv?: string[];
  capture?: Record<string, string>;
  exit?: number;
  stdout?: string;
  stderr?: string[];
}
interface Scenario {
  name: string;
  tz: string;
  token_apps?: string[];
  steps: Step[];
}
const golden = JSON.parse(
  readFileSync(new URL("../../../test-vectors/journal_cli_golden.json", import.meta.url), "utf8"),
) as { now: number; scenarios: Scenario[] };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Every UUID as `<id:N>`, numbered by first appearance in the scenario (as golden.rs does). */
function normalizer() {
  const ids = new Map<string, string>();
  return (text: string) =>
    text.replace(UUID, (id) => {
      if (!ids.has(id)) ids.set(id, `<id:${ids.size + 1}>`);
      return ids.get(id)!;
    });
}

/** `--flag value` pairs (repeatable) and positionals, as the CLI reads them. */
function parseArgs(argv: string[]) {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const list = values.get(a.slice(2)) ?? [];
      list.push(argv[++i] ?? "");
      values.set(a.slice(2), list);
    } else positionals.push(a);
  }
  return { values, positionals };
}

/** The CLI's `journal_fields`: flags over `--json`. */
function fieldsOf(values: Map<string, string[]>): JournalFields {
  const json = (values.has("json") ? JSON.parse(values.get("json")![0]!) : {}) as Record<
    string,
    unknown
  >;
  const text = (k: string) =>
    values.get(k)?.[0] ?? (typeof json[k] === "string" ? (json[k] as string) : undefined);
  const flagMood = values.get("mood")?.[0];
  let mood: number | null | undefined;
  if (flagMood !== undefined) {
    mood =
      flagMood === "" || flagMood.toLowerCase() === "none" ? null : checkMood(Number(flagMood));
  } else if ("mood" in json) mood = json.mood === null ? null : checkMood(json.mood);
  const tags =
    values.get("tag") ?? (Array.isArray(json.tags) ? (json.tags as string[]) : undefined);
  return { date: text("date"), title: text("title"), body: text("body"), mood, tags };
}

function strip<T extends { locked?: boolean }>(entry: T): Omit<T, "locked"> {
  const { locked: _locked, ...rest } = entry;
  return rest;
}

function run(entries: JournalEntries, argv: string[]): unknown {
  const { values, positionals } = parseArgs(argv);
  const command = positionals.slice(0, 3).join(" ");
  const id = positionals[3]!;
  switch (command) {
    case "journal entries list":
      return entries
        .list({
          from: values.get("from")?.[0],
          to: values.get("to")?.[0],
          tag: values.get("tag")?.[0],
          search: values.get("search")?.[0],
        })
        .map(strip);
    case "journal entries get": {
      const e = entries.get(id);
      if (!e) throw new JournalError("unknown_journal_entry", `no journal entry "${id}"`);
      return strip(e);
    }
    case "journal entries add":
      return strip(entries.create(fieldsOf(values)));
    case "journal entries update":
      return strip(entries.update(id, fieldsOf(values)));
    case "journal entries delete":
      entries.trash(id);
      return { deleted: id };
    default:
      throw new Error(`not a journal command: ${command}`);
  }
}

const journalScenarios = golden.scenarios.filter((s) => s.token_apps?.includes("journal"));

describe("the atlas CLI's journal golden runs", () => {
  it("has journal scenarios to replay", () => {
    expect(journalScenarios.length).toBeGreaterThanOrEqual(2);
  });

  for (const scenario of journalScenarios) {
    it(scenario.name, () => {
      const store = new LocalStore("golden-device");
      const entries = new JournalEntries(store, { now: () => golden.now, timeZone: scenario.tz });
      const names = new Map<string, string>();
      const normalize = normalizer();
      let replayed = 0;
      for (const step of scenario.steps) {
        if (step.seed) {
          const id = store.newEntityId();
          for (const [field, value] of Object.entries(step.seed.fields)) {
            store.set(JOURNAL_ENTRY, id, field, value);
          }
          names.set(step.seed.ref, id);
          continue;
        }
        const argv = step.argv!.map((a) => a.replace(/\{(\w+)\}/g, (_, n) => names.get(n) ?? _));
        // Usage errors are the CLI's argument parser; other apps' commands are not journal's.
        if (step.exit === 2 || argv[0] !== "journal") continue;
        let stdout = "";
        let stderr: string[] = [];
        try {
          const out = run(entries, argv);
          stdout = JSON.stringify(out, null, 2);
          for (const [name, field] of Object.entries(step.capture ?? {})) {
            names.set(name, (out as Record<string, string>)[field]!);
          }
          expect(0, `${argv.join(" ")} succeeds`).toBe(step.exit);
        } catch (err) {
          if (!(err instanceof JournalError)) throw err;
          stderr = [JSON.stringify({ error: err.message, code: err.code })];
          expect(1, `${argv.join(" ")} fails: ${err.message}`).toBe(step.exit);
        }
        expect(normalize(stdout), argv.join(" ")).toBe(step.stdout);
        expect(stderr.map(normalize), argv.join(" ")).toEqual(step.stderr);
        replayed++;
      }
      expect(replayed).toBeGreaterThan(5);
    });
  }
});
