import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeAdapter } from "../../providers/claude-code.js";
import { ProviderError } from "../../errors.js";
import type { Account } from "../../types/account.js";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    provider: "claude-code",
    name: "Personal",
    credentials: { kind: "oauth_file", path: "/tmp/claude-credentials.json" },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_CREDS = {
  claudeAiOauth: {
    accessToken: "sk-ant-oat-test-token",
    refreshToken: "rt-xxx",
    expiresAt: Date.now() + 3600_000,
  },
};

function makeAdapter(opts: {
  fileContent?: unknown;
  fileError?: Error;
  fetchHandler?: (url: string) => Response | Promise<Response>;
}) {
  const fileReader = async () => {
    if (opts.fileError) throw opts.fileError;
    return opts.fileContent ?? VALID_CREDS;
  };
  const fetchImpl = opts.fetchHandler
    ? ((async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        return opts.fetchHandler!(url);
      }) as typeof fetch)
    : (async () => jsonResponse({})) as typeof fetch;
  return new ClaudeCodeAdapter({ credentialsFileReader: fileReader, fetchImpl });
}

describe("ClaudeCodeAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("testConnection returns ok on 200", async () => {
    const adapter = makeAdapter({
      fetchHandler: () => jsonResponse({ five_hour: {}, seven_day: {} }),
    });
    expect(await adapter.testConnection(makeAccount())).toEqual({ kind: "ok" });
  });

  it("testConnection returns auth_invalid on 401", async () => {
    const adapter = makeAdapter({ fetchHandler: () => jsonResponse({}, 401) });
    expect(await adapter.testConnection(makeAccount())).toMatchObject({
      kind: "error",
      code: "auth_invalid",
      retriable: false,
    });
  });

  it("testConnection returns rate_limited on 429", async () => {
    const adapter = makeAdapter({ fetchHandler: () => jsonResponse({}, 429) });
    expect(await adapter.testConnection(makeAccount())).toMatchObject({
      kind: "error",
      code: "rate_limited",
      retriable: true,
    });
  });

  it("testConnection returns network error on fetch throw", async () => {
    const adapter = makeAdapter({
      fetchHandler: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await adapter.testConnection(makeAccount())).toMatchObject({
      kind: "error",
      code: "network",
      retriable: true,
    });
  });

  it("testConnection returns auth_invalid when credentials file cannot be read", async () => {
    const adapter = makeAdapter({ fileError: new Error("ENOENT") });
    expect(await adapter.testConnection(makeAccount())).toMatchObject({
      kind: "error",
      code: "auth_invalid",
      retriable: false,
    });
  });

  it("testConnection rejects non oauth_file credentials", async () => {
    const adapter = makeAdapter({});
    const status = await adapter.testConnection(
      makeAccount({ credentials: { kind: "api_key", keychainRef: "x" } }),
    );
    expect(status).toMatchObject({ kind: "error", code: "unsupported" });
  });

  it("fetchCredits maps 5h and weekly percent windows", async () => {
    const adapter = makeAdapter({
      fetchHandler: () =>
        jsonResponse({
          five_hour: { utilization: 0.42, resets_at: "2026-08-27T22:18:00Z" },
          seven_day: { utilization: 0.28, resets_at: "2026-08-30T16:00:00Z" },
        }),
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toHaveLength(2);
    expect(snap.windows[0]).toMatchObject({
      type: "5h",
      used: 42,
      limit: 100,
      remaining: 58,
      unit: "percent",
    });
    expect(snap.windows[0]?.resetAt).toEqual(new Date("2026-08-27T22:18:00Z"));
    expect(snap.windows[1]).toMatchObject({
      type: "weekly",
      used: 28,
      limit: 100,
      remaining: 72,
      unit: "percent",
    });
  });

  it("fetchCredits omits buckets that are missing or have no utilization", async () => {
    const adapter = makeAdapter({
      fetchHandler: () =>
        jsonResponse({
          five_hour: null,
          seven_day: { utilization: 0.5, resets_at: null },
        }),
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toHaveLength(1);
    expect(snap.windows[0]?.type).toBe("weekly");
    expect(snap.windows[0]?.resetAt).toBeNull();
  });

  it("fetchCredits clamps utilization to [0, 1]", async () => {
    const adapter = makeAdapter({
      fetchHandler: () =>
        jsonResponse({
          five_hour: { utilization: 1.5, resets_at: null },
          seven_day: { utilization: -0.2, resets_at: null },
        }),
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows[0]).toMatchObject({ used: 100, remaining: 0 });
    expect(snap.windows[1]).toMatchObject({ used: 0, remaining: 100 });
  });

  it("fetchCredits supports flat accessToken format", async () => {
    const adapter = makeAdapter({
      fileContent: { accessToken: "sk-flat-token" },
      fetchHandler: () =>
        jsonResponse({
          five_hour: { utilization: 0.1, resets_at: null },
        }),
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toHaveLength(1);
  });

  it("fetchCredits throws when credentials file cannot be read", async () => {
    const adapter = makeAdapter({ fileError: new Error("ENOENT") });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "auth_invalid",
      retriable: false,
    });
  });

  it("fetchCredits throws when credentials file has no token", async () => {
    const adapter = makeAdapter({ fileContent: { some: "thing" } });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "auth_invalid",
    });
  });

  it("fetchCredits throws ProviderError on 401", async () => {
    const adapter = makeAdapter({ fetchHandler: () => jsonResponse({}, 401) });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "auth_invalid",
    });
  });

  it("fetchCredits throws ProviderError on 429", async () => {
    const adapter = makeAdapter({ fetchHandler: () => jsonResponse({}, 429) });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "rate_limited",
      retriable: true,
    });
  });

  it("fetchCredits throws ProviderError on network error", async () => {
    const adapter = makeAdapter({
      fetchHandler: () => {
        throw new Error("ECONNRESET");
      },
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "network",
      retriable: true,
    });
  });

  it("fetchCredits rejects non oauth_file credentials", async () => {
    const adapter = makeAdapter({});
    await expect(
      adapter.fetchCredits(makeAccount({ credentials: { kind: "manual" } })),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("two Claude Code accounts use distinct file paths", async () => {
    const seen: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      credentialsFileReader: async (path) => {
        seen.push(path);
        return VALID_CREDS;
      },
      fetchImpl: (async () => jsonResponse({})) as typeof fetch,
    });
    await adapter.fetchCredits(makeAccount({ id: "a" }));
    await adapter.fetchCredits(
      makeAccount({ id: "b", credentials: { kind: "oauth_file", path: "/tmp/claude-b.json" } }),
    );
    expect(seen).toEqual(["/tmp/claude-credentials.json", "/tmp/claude-b.json"]);
  });
});
