import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryDb, initSchema, type DbHandle } from "../client.js";
import * as accounts from "../repositories/accounts.js";
import * as providers from "../repositories/providers.js";
import * as snapshots from "../repositories/snapshots.js";
import { resolve } from "node:path";

let handle: DbHandle;

beforeEach(() => {
  handle = createInMemoryDb();
  initSchema(handle, resolve(import.meta.dirname, "../../drizzle"));
});

afterEach(() => {
  handle.close();
});

describe("providers", () => {
  it("ensureProvider is idempotent", () => {
    const a = providers.ensureProvider(handle.db, {
      slug: "opencode-go",
      name: "OpenCode Go",
    });
    const b = providers.ensureProvider(handle.db, {
      slug: "opencode-go",
      name: "OpenCode Go (renamed)",
    });
    expect(a.id).toBe("opencode-go");
    expect(b.id).toBe(a.id);
    expect(b.createdAt.getTime()).toBe(a.createdAt.getTime());
    expect(providers.listProviders(handle.db)).toHaveLength(1);
  });
});

describe("accounts", () => {
  beforeEach(() => {
    providers.ensureProvider(handle.db, { slug: "opencode-go", name: "OpenCode Go" });
    providers.ensureProvider(handle.db, { slug: "openrouter", name: "OpenRouter" });
    providers.ensureProvider(handle.db, { slug: "claude-code", name: "Claude Code" });
    providers.ensureProvider(handle.db, { slug: "codex", name: "Codex" });
  });

  it("creates an account with api_key credentials", () => {
    const acc = accounts.createAccount(handle.db, {
      providerId: "opencode-go",
      name: "Personal",
      credentials: { kind: "api_key", keychainRef: "opencode-go/personal" },
    });
    expect(acc.name).toBe("Personal");
    expect(acc.status).toBe("healthy");
    expect(acc.providerId).toBe("opencode-go");
  });

  it("rejects unknown provider", () => {
    expect(() =>
      accounts.createAccount(handle.db, {
        providerId: "not-a-real-provider" as never,
        name: "X",
        credentials: { kind: "manual" },
      }),
    ).toThrow(/Unknown provider/);
  });

  it("supports multiple accounts on the same provider", () => {
    accounts.createAccount(handle.db, {
      providerId: "opencode-go",
      name: "Personal",
      credentials: { kind: "api_key", keychainRef: "opencode-go/personal" },
    });
    accounts.createAccount(handle.db, {
      providerId: "opencode-go",
      name: "Backup",
      credentials: { kind: "api_key", keychainRef: "opencode-go/backup" },
    });
    const list = accounts.listAccountsByProvider(handle.db, "opencode-go");
    expect(list).toHaveLength(2);
    expect(new Set(list.map((a) => a.name))).toEqual(new Set(["Personal", "Backup"]));
  });

  it("deletes an account (credentials cascade)", () => {
    const acc = accounts.createAccount(handle.db, {
      providerId: "openrouter",
      name: "Personal",
      credentials: { kind: "api_key", keychainRef: "openrouter/personal" },
    });
    expect(accounts.deleteAccount(handle.db, acc.id)).toBe(true);
    expect(accounts.getAccount(handle.db, acc.id)).toBeUndefined();
  });

  it("hydrates credentials back to the original shape", () => {
    accounts.createAccount(handle.db, {
      providerId: "claude-code",
      name: "Work",
      credentials: { kind: "oauth_file", path: "/Users/x/.claude-work/.credentials.json" },
    });
    const list = accounts.listAccountsWithCredentials(handle.db);
    const found = list.find((a) => a.name === "Work");
    expect(found?.credentials).toEqual({
      kind: "oauth_file",
      path: "/Users/x/.claude-work/.credentials.json",
    });
  });

  it("preserves oauth_cookie metadata round-trip", () => {
    accounts.createAccount(handle.db, {
      providerId: "opencode-go",
      name: "Legacy",
      credentials: {
        kind: "oauth_cookie",
        cookieRef: "opencode-go-cookie/legacy",
        workspaceId: "wrk_123",
      },
    });
    const list = accounts.listAccountsWithCredentials(handle.db);
    expect(list[0]?.credentials).toEqual({
      kind: "oauth_cookie",
      cookieRef: "opencode-go-cookie/legacy",
      workspaceId: "wrk_123",
    });
  });

  it("updates account status", () => {
    const acc = accounts.createAccount(handle.db, {
      providerId: "codex",
      name: "Personal",
      credentials: { kind: "manual" },
    });
    accounts.updateAccountStatus(handle.db, acc.id, "error");
    expect(accounts.getAccount(handle.db, acc.id)?.status).toBe("error");
  });
});

describe("snapshots", () => {
  let accountId: string;

  beforeEach(() => {
    providers.ensureProvider(handle.db, { slug: "opencode-go", name: "OpenCode Go" });
    const acc = accounts.createAccount(handle.db, {
      providerId: "opencode-go",
      name: "Personal",
      credentials: { kind: "api_key", keychainRef: "opencode-go/personal" },
    });
    accountId = acc.id;
  });

  it("saves a snapshot with multiple windows and retrieves it", () => {
    const resetAt = new Date("2026-08-28T03:42:00Z");
    const id = snapshots.saveSnapshot(handle.db, {
      accountId,
      windows: [
        { type: "5h", used: 81, limit: 250, remaining: 169, unit: "credits", resetAt },
        { type: "weekly", used: 577, limit: 1000, remaining: 423, unit: "credits", resetAt: null },
      ],
    });
    const got = snapshots.getSnapshot(handle.db, id);
    expect(got?.errorCode).toBeNull();
    expect(got?.windows).toHaveLength(2);
    expect(got?.windows[0]).toMatchObject({
      type: "5h",
      used: 81,
      limit: 250,
      remaining: 169,
      unit: "credits",
    });
    expect(got?.windows[0]?.resetAt).toBeInstanceOf(Date);
  });

  it("saves a failed snapshot with an error code and no windows", () => {
    const id = snapshots.saveSnapshot(handle.db, {
      accountId,
      windows: [],
      error: { code: "auth_expired", message: "Token expired" },
    });
    const got = snapshots.getSnapshot(handle.db, id);
    expect(got?.errorCode).toBe("auth_expired");
    expect(got?.errorMessage).toBe("Token expired");
    expect(got?.windows).toEqual([]);
  });

  it("returns the most recent snapshot for an account", () => {
    snapshots.saveSnapshot(handle.db, {
      accountId,
      fetchedAt: new Date("2026-08-27T18:00:00Z"),
      windows: [{ type: "5h", used: 10, limit: 100, remaining: 90, unit: "credits", resetAt: null }],
    });
    snapshots.saveSnapshot(handle.db, {
      accountId,
      fetchedAt: new Date("2026-08-27T18:05:00Z"),
      windows: [{ type: "5h", used: 20, limit: 100, remaining: 80, unit: "credits", resetAt: null }],
    });
    const latest = snapshots.getLatestSnapshot(handle.db, accountId);
    expect(latest?.fetchedAt.toISOString()).toBe("2026-08-27T18:05:00.000Z");
    expect(latest?.windows[0]?.used).toBe(20);
  });

  it("lists snapshots in reverse chronological order", () => {
    for (const t of ["2026-08-27T18:00:00Z", "2026-08-27T18:05:00Z", "2026-08-27T18:10:00Z"]) {
      snapshots.saveSnapshot(handle.db, {
        accountId,
        fetchedAt: new Date(t),
        windows: [{ type: "5h", used: 1, limit: 1, remaining: 0, unit: "credits", resetAt: null }],
      });
    }
    const list = snapshots.listSnapshotsForAccount(handle.db, accountId);
    expect(list.map((s) => s.fetchedAt.toISOString())).toEqual([
      "2026-08-27T18:10:00.000Z",
      "2026-08-27T18:05:00.000Z",
      "2026-08-27T18:00:00.000Z",
    ]);
  });

  it("deletes snapshots when the account is deleted", () => {
    const id = snapshots.saveSnapshot(handle.db, {
      accountId,
      windows: [{ type: "5h", used: 1, limit: 1, remaining: 0, unit: "credits", resetAt: null }],
    });
    accounts.deleteAccount(handle.db, accountId);
    expect(snapshots.getSnapshot(handle.db, id)).toBeUndefined();
  });
});
