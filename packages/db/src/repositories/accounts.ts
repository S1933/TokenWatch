import { and, eq } from "drizzle-orm";
import type {
  AccountCredentials,
  AccountStatus,
  ProviderSlug,
} from "@tokenwatch/core";
import { newId, type Db } from "../client.js";
import { accounts, credentials, providers } from "../schema/index.js";

export interface AccountRow {
  id: string;
  providerId: ProviderSlug;
  name: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountWithCredentials extends AccountRow {
  credentials: AccountCredentials;
}

export interface CreateAccountInput {
  providerId: ProviderSlug;
  name: string;
  credentials: AccountCredentials;
}

export function createAccount(db: Db, input: CreateAccountInput): AccountRow {
  const provider = db
    .select()
    .from(providers)
    .where(eq(providers.id, input.providerId))
    .get();
  if (!provider) {
    throw new Error(`Unknown provider: ${input.providerId}`);
  }
  const now = new Date();
  const accountId = newId();
  db.insert(accounts)
    .values({
      id: accountId,
      providerId: input.providerId,
      name: input.name,
      status: "healthy",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(credentials)
    .values({
      id: newId(),
      accountId,
      type: input.credentials.kind,
      keychainRef: extractKeychainRef(input.credentials),
      meta: extractMeta(input.credentials),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!row) throw new Error("Failed to create account");
  return castAccount(row);
}

export function deleteAccount(db: Db, id: string): boolean {
  const result = db.delete(accounts).where(eq(accounts.id, id)).run();
  return result.changes > 0;
}

export function listAccounts(db: Db): AccountRow[] {
  return castAccounts(db.select().from(accounts).all());
}

type DrizzleAccountRow = typeof accounts.$inferSelect;

function castAccount(row: DrizzleAccountRow): AccountRow {
  return { ...row, providerId: row.providerId as ProviderSlug };
}

function castAccounts(rows: DrizzleAccountRow[]): AccountRow[] {
  return rows.map(castAccount);
}

export function listAccountsByProvider(
  db: Db,
  providerId: ProviderSlug,
): AccountRow[] {
  return castAccounts(
    db.select().from(accounts).where(eq(accounts.providerId, providerId)).all(),
  );
}

export function getAccount(db: Db, id: string): AccountRow | undefined {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return row ? castAccount(row) : undefined;
}

export function getAccountWithCredentials(
  db: Db,
  id: string,
): AccountWithCredentials | undefined {
  const acc = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!acc) return undefined;
  const cred = db
    .select()
    .from(credentials)
    .where(eq(credentials.accountId, id))
    .get();
  if (!cred) return undefined;
  return { ...castAccount(acc), credentials: hydrateCredentials(cred) };
}

export function listAccountsWithCredentials(db: Db): AccountWithCredentials[] {
  const accs = db.select().from(accounts).all();
  const result: AccountWithCredentials[] = [];
  for (const acc of accs) {
    const cred = db
      .select()
      .from(credentials)
      .where(eq(credentials.accountId, acc.id))
      .get();
    if (cred) {
      result.push({ ...castAccount(acc), credentials: hydrateCredentials(cred) });
    }
  }
  return result;
}

export function updateAccountStatus(
  db: Db,
  id: string,
  status: AccountStatus,
): void {
  db.update(accounts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(accounts.id, id)))
    .run();
}

function extractKeychainRef(creds: AccountCredentials): string | null {
  return creds.kind === "api_key" ? creds.keychainRef : null;
}

function extractMeta(
  creds: AccountCredentials,
): { path?: string; workspaceId?: string } | null {
  if (creds.kind === "oauth_file") {
    return { path: creds.path };
  }
  if (creds.kind === "oauth_cookie") {
    return { path: creds.cookieRef, workspaceId: creds.workspaceId };
  }
  return null;
}

interface CredentialRow {
  type: "api_key" | "oauth_file" | "oauth_cookie" | "manual";
  keychainRef: string | null;
  meta: { path?: string; workspaceId?: string } | null;
}

function hydrateCredentials(row: CredentialRow): AccountCredentials {
  if (row.type === "api_key") {
    if (!row.keychainRef) {
      throw new Error("api_key credential missing keychainRef");
    }
    return { kind: "api_key", keychainRef: row.keychainRef };
  }
  if (row.type === "oauth_file") {
    if (!row.meta?.path) {
      throw new Error("oauth_file credential missing meta.path");
    }
    return { kind: "oauth_file", path: row.meta.path };
  }
  if (row.type === "oauth_cookie") {
    if (!row.meta?.path || !row.meta.workspaceId) {
      throw new Error("oauth_cookie credential missing meta.path or meta.workspaceId");
    }
    return {
      kind: "oauth_cookie",
      cookieRef: row.meta.path,
      workspaceId: row.meta.workspaceId,
    };
  }
  return { kind: "manual" };
}
