import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeGoAdapter } from "../../providers/opencode-go.js";
import { ProviderError } from "../../errors.js";
import type { Account } from "../../types/account.js";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    provider: "opencode-go",
    name: "Personal",
    credentials: { kind: "api_key", keychainRef: "opencode-go/personal" },
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

function makeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as typeof fetch;
}

const REAL_RESPONSE = {
  usage: {
    rolling: {
      status: "ok",
      percent: 0,
      resetsAt: "2026-08-28T02:07:05.869Z",
    },
    weekly: {
      status: "ok",
      percent: 43,
      resetsAt: "2026-08-31T00:00:00.869Z",
    },
    monthly: {
      status: "ok",
      percent: 96,
      resetsAt: "2026-09-07T06:54:02.869Z",
    },
  },
};

describe("OpenCodeGoAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("testConnection returns ok on 200", async () => {
    const fetchImpl = makeFetch(() => jsonResponse(REAL_RESPONSE));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    expect(await adapter.testConnection(makeAccount())).toEqual({ kind: "ok" });
  });

  it("testConnection returns auth_invalid on 401", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 401));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "auth_invalid", retriable: false });
  });

  it("testConnection returns rate_limited on 429", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 429));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "rate_limited", retriable: true });
  });

  it("testConnection returns network error on fetch throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "network", retriable: true });
  });

  it("testConnection rejects non api_key credentials", async () => {
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl: makeFetch(() => jsonResponse(REAL_RESPONSE)),
    });
    const status = await adapter.testConnection(
      makeAccount({ credentials: { kind: "manual" } }),
    );
    expect(status).toMatchObject({ kind: "error", code: "unsupported" });
  });

  it("fetchCredits maps rolling/weekly/monthly to 5h/weekly/monthly percent windows", async () => {
    const fetchImpl = makeFetch(() => jsonResponse(REAL_RESPONSE));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toHaveLength(3);

    const [w5h, wWeekly, wMonthly] = snap.windows;
    expect(w5h).toMatchObject({
      type: "5h",
      used: 0,
      limit: 100,
      remaining: 100,
      unit: "percent",
    });
    expect(w5h?.resetAt).toEqual(new Date("2026-08-28T02:07:05.869Z"));

    expect(wWeekly).toMatchObject({
      type: "weekly",
      used: 43,
      limit: 100,
      remaining: 57,
      unit: "percent",
    });
    expect(wWeekly?.resetAt).toEqual(new Date("2026-08-31T00:00:00.869Z"));

    expect(wMonthly).toMatchObject({
      type: "monthly",
      used: 96,
      limit: 100,
      remaining: 4,
      unit: "percent",
    });
    expect(wMonthly?.resetAt).toEqual(new Date("2026-09-07T06:54:02.869Z"));
  });

  it("fetchCredits skips buckets that are missing", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        usage: {
          rolling: REAL_RESPONSE.usage.rolling,
          weekly: null,
          monthly: undefined,
        },
      }),
    );
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows.map((w) => w.type)).toEqual(["5h"]);
  });

  it("fetchCredits skips buckets whose status is not 'ok'", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 0, resetsAt: null },
          weekly: { status: "exhausted", percent: 100, resetsAt: null },
          monthly: { status: "ok", percent: 50, resetsAt: null },
        },
      }),
    );
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows.map((w) => w.type)).toEqual(["5h", "monthly"]);
  });

  it("fetchCredits returns empty snapshot when usage is missing", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toEqual([]);
  });

  it("fetchCredits clamps percent to [0, 100]", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 150, resetsAt: null },
          weekly: { status: "ok", percent: -20, resetsAt: null },
        },
      }),
    );
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows[0]).toMatchObject({ used: 100, remaining: 0 });
    expect(snap.windows[1]).toMatchObject({ used: 0, remaining: 100 });
  });

  it("fetchCredits throws ProviderError on 401", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 401));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "auth_invalid",
      retriable: false,
    });
  });

  it("fetchCredits throws ProviderError on 429", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 429));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "rate_limited",
      retriable: true,
    });
  });

  it("fetchCredits throws unsupported on 404 (endpoint not deployed)", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}, 404));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "unsupported",
      retriable: false,
    });
  });

  it("fetchCredits throws ProviderError on network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "network",
      retriable: true,
    });
  });

  it("fetchCredits rejects non api_key credentials", async () => {
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl: makeFetch(() => jsonResponse(REAL_RESPONSE)),
    });
    await expect(
      adapter.fetchCredits(makeAccount({ credentials: { kind: "manual" } })),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("two accounts with the same adapter fetch independently", async () => {
    const seenKeys: string[] = [];
    const fetchImpl = makeFetch(() => jsonResponse(REAL_RESPONSE));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async (ref) => {
        seenKeys.push(ref);
        return `sk-for-${ref}`;
      },
      fetchImpl,
    });
    const a = await adapter.fetchCredits(makeAccount({ id: "a", name: "Personal" }));
    const b = await adapter.fetchCredits(makeAccount({ id: "b", name: "Backup" }));
    expect(a.accountId).toBe("a");
    expect(b.accountId).toBe("b");
    expect(seenKeys).toEqual([
      "opencode-go/personal",
      "opencode-go/personal",
    ]);
  });
});
