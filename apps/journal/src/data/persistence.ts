import * as SQLite from "expo-sqlite";
import { ExpoSqlDatabase, SqlitePersistence, type Persistence } from "@atlastodo/client-core";

/**
 * The journal's durable op log on a phone: client-core's SQLite persistence over expo-sqlite, one
 * database per account (two accounts on one device never share an outbox). It holds every entry
 * decrypted, so signing out deletes it. The web build resolves `persistence.web.ts`.
 */
export async function createPersistence(userId: string): Promise<Persistence> {
  const db = await SQLite.openDatabaseAsync(dbName(userId), { useNewConnection: true });
  return new SqlitePersistence(new ExpoSqlDatabase(db));
}

export async function deleteDatabase(userId: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(dbName(userId));
}

function dbName(userId: string): string {
  return `atlas-journal-${userId}.db`;
}
