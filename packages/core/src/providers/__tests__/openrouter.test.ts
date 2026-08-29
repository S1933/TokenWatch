import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterAdapter, parseLimitReset } from "../../providers/openrouter.js";
import { ProviderError } from "../../errors.js";
import type { Account } from "../../types/account.js";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    provider: "openrouter",
    name: "Personal",
    credentials: { kind: "api_key", keychainRef: "openrouter/personal" },
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

function makeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.endsWith(pattern)) return handler();
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("parseLimitReset", () => {
  it("parses days, hours, minutes, seconds", () => {
    expect(parseLimitReset("5d 14h")).toBe(5 * 86400 + 14 * 3600);
    expect(parseLimitReset("30m")).toBe(30 * 60);
    expect(parseLimitReset("2d 3h 15m 5s")).toBe(
      2 * 86400 + 3 * 3600 + 15 * 60 + 5,
    );
  });

  it("returns 0 for empty or unparseable input", () => {
    expect(parseLimitReset("")).toBe(0);
    expect(parseLimitReset("nope")).toBe(0);
  });

  it("ignores garbage tokens", () => {
    expect(parseLimitReset("5d xxx 14h")).toBe(5 * 86400 + 14 * 3600);
  });
});

describe("OpenRouterAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("testConnection returns ok on 200", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({ data: { usage: 0 } }) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    expect(await adapter.testConnection(makeAccount())).toEqual({ kind: "ok" });
  });

  it("testConnection returns auth_invalid on 401", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({}, 401) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "auth_invalid", retriable: false });
  });

  it("testConnection returns rate_limited on 429", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({}, 429) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "rate_limited", retriable: true });
  });

  it("testConnection returns network error on fetch throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "network", retriable: true });
  });

  it("testConnection rejects non api_key credentials", async () => {
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl: makeFetch({}),
    });
    const status = await adapter.testConnection(
      makeAccount({ credentials: { kind: "manual" } }),
    );
    expect(status).toMatchObject({ kind: "error", code: "unsupported" });
  });

  it("fetchCredits emits a monthly window when key has no limit and /credits is reachable", async () => {
    const fetchImpl = makeFetch({
      "/auth/key": () =>
        jsonResponse({ data: { usage: 25.75, limit: null, limit_remaining: null } }),
      "/credits": () => jsonResponse({ data: { total_credits: 100, total_usage: 25.75 } }),
    });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    expect(snap.accountId).toBe("acc-1");
    expect(snap.windows).toHaveLength(1);
    const w = snap.windows[0]!;
    expect(w.type).toBe("monthly");
    expect(w.unit).toBe("usd");
    expect(w.used).toBe(25.75);
    expect(w.limit).toBe(100);
    expect(w.remaining).toBe(74.25);
    expect(w.resetAt).toBeNull();
  });

  it("fetchCredits uses /credits total_usage even when /auth/key reports 0 usage (pay-as-you-go)", async () => {
    const fetchImpl = makeFetch({
      "/auth/key": () =>
        jsonResponse({ data: { usage: 0, limit: null, limit_remaining: null } }),
      "/credits": () => jsonResponse({ data: { total_credits: 60, total_usage: 39.66 } }),
    });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "«redacted:sk-…»",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    const w = snap.windows[0]!;
    expect(w.used).toBeCloseTo(39.66, 2);
    expect(w.limit).toBe(60);
    expect(w.remaining).toBeCloseTo(20.34, 2);
    expect(w.resetAt).toBeNull();
  });

  it("fetchCredits works with regular key (no /credits access)", async () => {
    const fetchImpl = makeFetch({
      "/auth/key": () =>
        jsonResponse({ data: { usage: 25.75, limit: null, limit_remaining: null } }),
      "/credits": () => jsonResponse({ error: { code: 403 } }, 403),
    });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    const w = snap.windows[0]!;
    expect(w.used).toBe(25.75);
    expect(w.limit).toBe(25.75);
    expect(w.remaining).toBe(0);
    expect(w.resetAt).toBeNull();
  });

  it("fetchCredits parses limit_reset and picks the right window type", async () => {
    const fetchImpl = makeFetch({
      "/auth/key": () =>
        jsonResponse({
          data: {
            usage: 5,
            limit: 100,
            limit_remaining: 95,
            limit_reset: "5d 14h",
          },
        }),
    });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    const snap = await adapter.fetchCredits(makeAccount());
    const w = snap.windows[0]!;
    expect(w.type).toBe("weekly");
    expect(w.used).toBe(5);
    expect(w.limit).toBe(100);
    expect(w.remaining).toBe(95);
    expect(w.resetAt).toBeInstanceOf(Date);
    const expectedMs = new Date("2026-08-27T18:00:00Z").getTime() + (5 * 86400 + 14 * 3600) * 1000;
    expect(w.resetAt!.getTime()).toBe(expectedMs);
  });

  it("fetchCredits picks daily for short resets and monthly for long ones", async () => {
    const mkAdapter = (reset: string) =>
      new OpenRouterAdapter({
        keychainResolver: async () => "sk-or-v1-test",
        fetchImpl: makeFetch({
          "/auth/key": () =>
            jsonResponse({
              data: { usage: 0, limit: 10, limit_remaining: 10, limit_reset: reset },
            }),
        }),
      });
    expect((await mkAdapter("12h").fetchCredits(makeAccount())).windows[0]!.type).toBe("daily");
    expect((await mkAdapter("1d").fetchCredits(makeAccount())).windows[0]!.type).toBe("daily");
    expect((await mkAdapter("2d").fetchCredits(makeAccount())).windows[0]!.type).toBe("weekly");
    expect((await mkAdapter("5d").fetchCredits(makeAccount())).windows[0]!.type).toBe("weekly");
    expect((await mkAdapter("30d").fetchCredits(makeAccount())).windows[0]!.type).toBe("monthly");
  });

  it("fetchCredits throws ProviderError on 401", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({}, 401) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "auth_invalid",
      retriable: false,
    });
  });

  it("fetchCredits throws ProviderError on 429", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({}, 429) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "rate_limited",
      retriable: true,
    });
  });

  it("fetchCredits throws ProviderError on network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "network",
      retriable: true,
    });
  });

  it("fetchCredits rejects non api_key credentials", async () => {
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl: makeFetch({}),
    });
    await expect(
      adapter.fetchCredits(makeAccount({ credentials: { kind: "manual" } })),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("fetchCredits throws parse error when /auth/key has no data", async () => {
    const fetchImpl = makeFetch({ "/auth/key": () => jsonResponse({ data: null }) });
    const adapter = new OpenRouterAdapter({
      keychainResolver: async () => "sk-or-v1-test",
      fetchImpl,
    });
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "parse",
    });
  });
});
