/**
 * Two devices of one account syncing journal entries through a fake server that, like the real
 * one, only stores and replays ops: what reaches it is ciphertext under the journal key, in a
 * journal-scoped session, and the other device opens it.
 */
import {
  MemoryPersistence,
  generateUserKeypair,
  randomBytes,
  type FetchLike,
} from "@atlastodo/client-core";
import { describe, expect, it } from "vitest";
import { createJournalApiClient, type JournalKeys } from "./account";
import { JournalEngine } from "./engine";

interface WireOp {
  id: string;
  entity: string;
  entity_id: string;
  field?: string;
  value?: unknown;
}

function fakeServer() {
  const log: WireOp[] = [];
  const headers: Record<string, string>[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    if (url.pathname === "/sync/push" && init?.method === "POST") {
      const { operations } = JSON.parse(String(init.body)) as { operations: WireOp[] };
      const from = log.length;
      for (const op of operations) if (!log.some((o) => o.id === op.id)) log.push(op);
      return json({ cursor: log.length, applied: operations.length, from });
    }
    if (url.pathname === "/sync/pull") {
      const since = Number(url.searchParams.get("since"));
      return json({ operations: log.slice(since), cursor: log.length });
    }
    return json({ error: "not found" }, 404);
  };
  return { log, headers, fetch };
}

function journalKeys(): JournalKeys {
  const identity = generateUserKeypair();
  return { appKey: randomBytes(32), privateKey: identity.secretKey, publicKey: identity.publicKey };
}

function device(server: ReturnType<typeof fakeServer>, keys: JournalKeys, id: string) {
  const api = createJournalApiClient({
    baseUrl: "http://atlas.test",
    token: "access",
    fetch: server.fetch,
  });
  return new JournalEngine({ api, persistence: new MemoryPersistence(), deviceId: id, keys });
}

describe("JournalEngine", () => {
  it("syncs encrypted entries between two devices in a journal-scoped session", async () => {
    const server = fakeServer();
    const keys = journalKeys();
    const a = device(server, keys, "device-a");
    const b = device(server, keys, "device-b");
    await a.start();
    await b.start();

    const made = a.entries.create({
      title: "Harbour walk",
      body: "Fog over the water.",
      mood: 4,
      tags: ["walks"],
      date: "2026-10-14",
    });
    expect(a.pendingCount()).toBeGreaterThan(0);
    await a.syncNow();
    expect(a.pendingCount()).toBe(0);

    // The server holds only ciphertext under the journal key ("dek" is its role, not todo's DEK).
    const sets = server.log.filter((o) => o.entity === "journal.entry");
    expect(sets.length).toBe(7);
    for (const op of sets) {
      expect(op.value).toMatchObject({ __enc: 2, kid: "dek" });
      expect(JSON.stringify(op.value)).not.toContain("Harbour");
    }
    // Every request named the journal as its scope.
    expect(server.headers.every((h) => h["x-atlas-sync-apps"] === "journal")).toBe(true);

    await b.syncNow();
    expect(b.entries.get(made.id)).toEqual(made);

    // An edit and a trash on b reach a.
    b.entries.update(made.id, { mood: 5 });
    b.entries.trash(made.id);
    await b.syncNow();
    await a.syncNow();
    expect(a.entries.get(made.id)).toMatchObject({ mood: 5 });
    expect(a.entries.get(made.id)?.deleted_at).not.toBeNull();
    expect(a.entries.list()).toEqual([]);
    await a.stop();
    await b.stop();
  });

  it("keeps entries it cannot open locked, never as content", async () => {
    const server = fakeServer();
    const a = device(server, journalKeys(), "device-a");
    const other = device(server, journalKeys(), "device-x");
    await a.start();
    await other.start();
    const made = a.entries.create({ title: "Private" });
    await a.syncNow();
    await other.syncNow();
    expect(other.entries.get(made.id)).toMatchObject({ title: "", locked: true });
    await a.stop();
    await other.stop();
  });

  it("keeps offline edits in its log across a restart", async () => {
    const server = fakeServer();
    const keys = journalKeys();
    const persistence = new MemoryPersistence();
    const api = createJournalApiClient({ baseUrl: "http://atlas.test", fetch: server.fetch });
    const first = new JournalEngine({ api, persistence, deviceId: "d", keys });
    await first.start();
    const made = first.entries.create({ body: "Written offline" });
    await first.store.flush();
    // A second engine on the same log (the app relaunched) sees the edit before any sync.
    const again = new JournalEngine({ api, persistence, deviceId: "d", keys });
    await again.start();
    expect(again.entries.get(made.id)?.body).toBe("Written offline");
    expect(again.pendingCount()).toBeGreaterThan(0);
  });
});
