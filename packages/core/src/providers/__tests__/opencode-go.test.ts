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

describe("OpenCodeGoAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("testConnection returns ok on 200", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ rolling5h: {} }));
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
      fetchImpl: makeFetch(() => jsonResponse({})),
    });
    const status = await adapter.testConnection(
      makeAccount({ credentials: { kind: "manual" } }),
    );
    expect(status).toMatchObject({ kind: "error", code: "unsupported" });
  });

  it("fetchCredits maps the 3 USD windows correctly", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        rolling5h: { usageDollars: 2.34, limitDollars: 12, usagePercent: 19.5, resetInSec: 7200 },
        weekly: { usageDollars: 8.91, limitDollars: 30, usagePercent: 29.7, resetInSec: 345600 },
        monthly: { usageDollars: 15, limitDollars: 60, usagePercent: 25, resetInSec: 1414800 },
        subscribedAt: "2026-05-22T14:30:00Z",
      }),
    );
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toHaveLength(3);

    const [w5h, wWeekly, wMonthly] = snap.windows;
    expect(w5h).toMatchObject({
      type: "5h",
      used: 2.34,
      limit: 12,
      remaining: 9.66,
      unit: "usd",
    });
    expect(w5h?.resetAt).toBeInstanceOf(Date);

    expect(wWeekly).toMatchObject({
      type: "weekly",
      used: 8.91,
      limit: 30,
      remaining: 21.09,
      unit: "usd",
    });

    expect(wMonthly).toMatchObject({
      type: "monthly",
      used: 15,
      limit: 60,
      remaining: 45,
      unit: "usd",
    });

    const expectedMonthlyReset =
      new Date("2026-08-27T18:00:00Z").getTime() + 1414800 * 1000;
    expect(wMonthly?.resetAt?.getTime()).toBe(expectedMonthlyReset);
  });

  it("fetchCredits omits windows that are missing or have limit <= 0", async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({
        rolling5h: { usageDollars: 0, limitDollars: 12, resetInSec: 7200 },
        weekly: null,
        monthly: { usageDollars: 0, limitDollars: 0, resetInSec: 1414800 },
      }),
    );
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows.map((w) => w.type)).toEqual(["5h"]);
  });

  it("fetchCredits returns empty snapshot when no windows are present", async () => {
    const fetchImpl = makeFetch(() => jsonResponse({}));
    const adapter = new OpenCodeGoAdapter({
      keychainResolver: async () => "sk-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.windows).toEqual([]);
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
      fetchImpl: makeFetch(() => jsonResponse({})),
    });
    await expect(
      adapter.fetchCredits(makeAccount({ credentials: { kind: "manual" } })),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("two accounts with the same adapter fetch independently", async () => {
    const seenKeys: string[] = [];
    const fetchImpl = makeFetch((url) => {
      const auth = url.includes("?") ? "" : "";
      void auth;
      return jsonResponse({
        rolling5h: { usageDollars: 1, limitDollars: 12, resetInSec: 7200 },
      });
    });
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
