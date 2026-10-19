/**
 * Atlas Journal and the `atlas journal entries` CLI against a real server: an entry the CLI adds
 * shows up in the app and one the app writes shows up in the CLI, field for field, both ways, with
 * edits and the trash. The app side is this package's own code (sign-up, enabling the journal,
 * the journal API token, the sync engine), as the app runs it.
 *
 * Run by scripts/e2e-cli.sh (`e2e:cli`), which starts a server offering the journal
 * (ATLAS_APPS=todo,journal) and points ATLAS_E2E_URL and ATLAS_CLI at it and the CLI binary.
 * Skipped without them.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  ApiClient,
  MemoryPersistence,
  buildSignupRoot,
  deriveAuthAndMekAsync,
  deriveRecoveryKeys,
  generateDek,
  generateRecoveryPhrase,
  generateSalt,
  generateSigningKeypair,
  generateUserKeypair,
  kdfForNewCredential,
  wrapKey,
  wrapSigningKey,
} from "@atlastodo/client-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  JournalEngine,
  createJournalApiClient,
  createJournalToken,
  listJournalTokens,
  lockedSession,
  signIn,
  signUp,
  unlock,
  type JournalEntry,
  type JournalKeys,
  type JournalSession,
} from "../src";

const run = promisify(execFile);
const URL_ = process.env.ATLAS_E2E_URL;
const CLI = process.env.ATLAS_CLI;

/** `atlas …` with the journal token; resolves its parsed JSON output. */
async function atlas(token: string, ...args: string[]): Promise<unknown> {
  const { stdout } = await run(CLI!, args, {
    env: { ...process.env, ATLAS_URL: URL_, ATLAS_TOKEN: token, ATLAS_TZ: "UTC" },
  });
  return JSON.parse(stdout);
}

function engineFor(api: ApiClient, keys: JournalKeys, deviceId: string): JournalEngine {
  return new JournalEngine({
    api,
    persistence: new MemoryPersistence(),
    deviceId,
    keys,
    timeZone: "UTC",
  });
}

function plain(entry: JournalEntry & { locked?: boolean }): JournalEntry {
  const { locked: _locked, ...rest } = entry;
  return rest;
}

describe.skipIf(!URL_ || !CLI)("Atlas Journal and the atlas CLI", () => {
  const email = `journal-e2e-${randomUUID()}@example.com`;
  const password = "correct horse battery staple journal";
  let api: ApiClient;
  let session: JournalSession;
  let keys: JournalKeys;
  let token: string;
  let app: JournalEngine;

  beforeAll(async () => {
    api = createJournalApiClient({ baseUrl: URL_! });
    const signed = await signUp(api, { email, password, displayName: "E2E" });
    session = signed.session;
    keys = signed.keys;
    expect(signed.recoveryPhrase.split(" ")).toHaveLength(24);
    // The journal key is a row under the root, beside todo's; the session keeps only the journal's.
    expect(session.appKeys?.map((k) => k.app).sort()).toEqual(["journal", "todo"]);
    expect(session.dek).toBeUndefined();
    ({ token } = await createJournalToken(api, { userId: session.user.id, keys, name: "e2e" }));
    expect((await listJournalTokens(api)).map((t) => t.apps)).toEqual([["journal"]]);
    app = engineFor(api, keys, randomUUID());
    await app.start();
  });

  it("shows an entry the CLI adds in the app", async () => {
    const added = (await atlas(
      token,
      "journal",
      "entries",
      "add",
      "--title",
      "From the CLI",
      "--body",
      "Fog over the water.",
      "--mood",
      "4",
      "--tag",
      "cli",
      "--tag",
      "walks",
      "--date",
      "2026-10-14",
    )) as JournalEntry;
    await app.syncNow();
    expect(plain(app.entries.get(added.id)!)).toEqual(added);
    expect(app.entries.list({ tag: "CLI" }).map((e) => e.id)).toEqual([added.id]);
  });

  it("shows entries the app writes, edits and trashes in the CLI", async () => {
    const written = app.entries.create({
      title: "From the app",
      body: "# Heading\n\nSome *markdown*.",
      mood: 2,
      tags: ["app"],
      date: "2026-10-15",
    });
    const edited = app.entries.update(written.id, { mood: 5, tags: ["app", "edited"] });
    const doomed = app.entries.create({ body: "To the trash", date: "2026-10-16" });
    app.entries.trash(doomed.id);
    await app.syncNow();
    expect(app.pendingCount()).toBe(0);

    const listed = (await atlas(token, "journal", "entries", "list")) as JournalEntry[];
    expect(listed.find((e) => e.id === written.id)).toEqual(plain(edited));
    expect(listed.some((e) => e.id === doomed.id)).toBe(false);
    // The CLI's order: newest date first.
    expect(listed.map((e) => e.date)).toEqual([...listed.map((e) => e.date)].sort().reverse());
    const trashed = (await atlas(token, "journal", "entries", "get", doomed.id)) as JournalEntry;
    expect(trashed.deleted_at).toBe(app.entries.get(doomed.id)!.deleted_at);
  });

  it("brings the CLI's edits and deletes back to the app", async () => {
    const [mine] = app.entries.list({ search: "from the app" });
    await atlas(
      token,
      "journal",
      "entries",
      "update",
      mine!.id,
      "--mood",
      "none",
      "--title",
      "Renamed",
    );
    await atlas(token, "journal", "entries", "delete", mine!.id);
    await app.syncNow();
    const got = app.entries.get(mine!.id)!;
    expect(got).toMatchObject({ title: "Renamed", mood: null });
    expect(got.deleted_at).not.toBeNull();
    app.entries.restore(mine!.id);
    await app.syncNow();
    const back = (await atlas(
      token,
      "journal",
      "entries",
      "list",
      "--search",
      "renamed",
    )) as JournalEntry[];
    expect(back.map((e) => e.id)).toEqual([mine!.id]);
  });

  it("opens the same journal on another device by password, and unlocks offline", async () => {
    const other = createJournalApiClient({ baseUrl: URL_! });
    const signed = await signIn(other, email, password, { deviceName: "Atlas Journal e2e" });
    expect(signed.keys.appKey).toEqual(keys.appKey);
    const device = engineFor(other, signed.keys, randomUUID());
    await device.start();
    await device.syncNow();
    expect(device.entries.list().map(plain)).toEqual(app.entries.list().map(plain));
    await device.stop();

    const unlocked = await unlock(other, lockedSession(signed.session), password);
    expect(unlocked.keys.appKey).toEqual(keys.appKey);
    await expect(unlock(other, lockedSession(signed.session), "wrong password")).rejects.toThrow(
      "does not open",
    );
  });
});

/**
 * An Atlas Todo account (signed up as the todo app does: a root key with the todo key only, the
 * journal not enabled) gets its journal on its first sign-in to Atlas Journal, and the todo data
 * stays out of the journal's session.
 */
async function signUpAsTodo(baseUrl: string, email: string, password: string): Promise<void> {
  const api = new ApiClient({ baseUrl });
  const kdf = kdfForNewCredential(await api.getSalt(email));
  const salt = generateSalt();
  const { authHash, mek } = await deriveAuthAndMekAsync(password, salt, kdf);
  const dek = generateDek();
  const keypair = generateUserKeypair();
  const phrase = generateRecoveryPhrase();
  const recovery = deriveRecoveryKeys(phrase, salt);
  const signing = generateSigningKeypair();
  await api.signup({
    email,
    password: authHash,
    salt,
    kdf,
    publicKey: keypair.publicKey,
    recoveryPublicKey: recovery.auth.publicKey,
    encryptedDek: wrapKey(dek, mek),
    encryptedPrivateKey: wrapKey(keypair.secretKey, mek),
    recoveryEncryptedDek: wrapKey(dek, recovery.wrapKey),
    recoveryEncryptedPrivateKey: wrapKey(keypair.secretKey, recovery.wrapKey),
    signingPublicKey: signing.publicKey,
    encryptedSigningKey: wrapSigningKey(signing.secretKey, dek),
    root: buildSignupRoot({
      mek,
      recoveryWrapKey: recovery.wrapKey,
      dek,
      privateKey: keypair.secretKey,
    }),
  });
}

describe.skipIf(!URL_ || !CLI)("an Atlas Todo account opening Atlas Journal", () => {
  it("enables the journal with its own key on the first sign-in", async () => {
    const email = `todo-first-${randomUUID()}@example.com`;
    const password = "an account made by atlas todo";
    await signUpAsTodo(URL_!, email, password);

    const api = createJournalApiClient({ baseUrl: URL_! });
    const first = await signIn(api, email, password);
    const apps = await api.listAccountApps();
    expect(apps.find((a) => a.id === "journal")?.enabled).toBe(true);
    expect(first.session.appKeys?.map((k) => k.app).sort()).toEqual(["journal", "todo"]);

    // A second sign-in opens the same key rather than making another.
    const again = await signIn(createJournalApiClient({ baseUrl: URL_! }), email, password);
    expect(again.keys.appKey).toEqual(first.keys.appKey);

    const engine = engineFor(api, first.keys, randomUUID());
    await engine.start();
    engine.entries.create({ title: "First journal entry" });
    await engine.syncNow();
    const { token } = await createJournalToken(api, {
      userId: first.session.user.id,
      keys: first.keys,
      name: "todo-first",
    });
    const listed = (await atlas(token, "journal", "entries", "list")) as JournalEntry[];
    expect(listed.map((e) => e.title)).toEqual(["First journal entry"]);
    await engine.stop();
  });
});
