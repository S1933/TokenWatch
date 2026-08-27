import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import * as schema from "./schema/index.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface CreateDbOptions {
  path?: string;
  migrationsFolder?: string;
}

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
}

const DEFAULT_PATH = "./data/tokenwatch.db";

export function createDb(options: CreateDbOptions = {}): DbHandle {
  const path = resolveDbPath(options.path ?? DEFAULT_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export function createInMemoryDb(): DbHandle {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export function initSchema(handle: DbHandle, migrationsFolder: string): void {
  migrate(handle.db, { migrationsFolder });
}

export function newId(): string {
  return randomUUID();
}

function resolveDbPath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}
