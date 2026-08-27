import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors.js";
import { MockProviderAdapter } from "../mock.js";
import { ProviderRegistry } from "../registry.js";
import type { Account } from "../types/account.js";
import type { ConnectionStatus } from "../types/status.js";

function makeAccount(id: string): Account {
  return {
    id,
    provider: "opencode-go",
    name: "Test",
    credentials: { kind: "api_key", keychainRef: "test-ref" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("MockProviderAdapter", () => {
  it("returns empty snapshot when no spec is set", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    const snapshot = await adapter.fetchCredits(makeAccount("acc-1"));
    expect(snapshot.accountId).toBe("acc-1");
    expect(snapshot.windows).toEqual([]);
  });

  it("computes remaining = limit - used and resetAt from resetInSec", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    const before = Date.now();
    adapter.setSnapshot("acc-1", {
      windows: [
        { type: "5h", used: 81, limit: 250, unit: "credits", resetInSec: 13_000 },
        { type: "weekly", used: 100, limit: 1000, unit: "credits" },
      ],
    });
    const snapshot = await adapter.fetchCredits(makeAccount("acc-1"));
    expect(snapshot.windows).toHaveLength(2);

    const w5h = snapshot.windows[0]!;
    expect(w5h.type).toBe("5h");
    expect(w5h.used).toBe(81);
    expect(w5h.limit).toBe(250);
    expect(w5h.remaining).toBe(169);
    expect(w5h.unit).toBe("credits");
    expect(w5h.resetAt).toBeInstanceOf(Date);
    const resetMs = w5h.resetAt!.getTime();
    expect(resetMs).toBeGreaterThanOrEqual(before + 13_000 * 1000);
    expect(resetMs).toBeLessThanOrEqual(Date.now() + 13_000 * 1000 + 100);

    const wWeekly = snapshot.windows[1]!;
    expect(wWeekly.resetAt).toBeNull();
  });

  it("testConnection returns ok by default", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    const status = await adapter.testConnection(makeAccount("acc-1"));
    expect(status).toEqual({ kind: "ok" });
  });

  it("testConnection returns custom status when configured", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    const custom: ConnectionStatus = {
      kind: "error",
      code: "auth_expired",
      message: "Token expired",
      retriable: false,
    };
    adapter.setSnapshot("acc-1", { windows: [], testConnectionStatus: custom });
    expect(await adapter.testConnection(makeAccount("acc-1"))).toEqual(custom);
  });

  it("throws ProviderError when throwOnFetch is set", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    const err = new ProviderError("rate_limited", "Too many requests", { retriable: true });
    adapter.setSnapshot("acc-1", { windows: [], throwOnFetch: err });
    await expect(adapter.fetchCredits(makeAccount("acc-1"))).rejects.toBe(err);
  });

  it("isolates snapshots per account", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    adapter.setSnapshot("acc-1", {
      windows: [{ type: "5h", used: 10, limit: 100, unit: "credits" }],
    });
    const snapA = await adapter.fetchCredits(makeAccount("acc-1"));
    const snapB = await adapter.fetchCredits(makeAccount("acc-2"));
    expect(snapA.windows).toHaveLength(1);
    expect(snapB.windows).toHaveLength(0);
  });

  it("clearSnapshot removes a previously-set spec", async () => {
    const adapter = new MockProviderAdapter("opencode-go");
    adapter.setSnapshot("acc-1", {
      windows: [{ type: "5h", used: 10, limit: 100, unit: "credits" }],
    });
    adapter.clearSnapshot("acc-1");
    const snap = await adapter.fetchCredits(makeAccount("acc-1"));
    expect(snap.windows).toEqual([]);
  });
});

describe("ProviderRegistry", () => {
  it("registers and retrieves adapters", () => {
    const registry = new ProviderRegistry();
    const a = new MockProviderAdapter("opencode-go");
    const b = new MockProviderAdapter("openrouter");
    registry.register(a);
    registry.register(b);
    expect(registry.get("opencode-go")).toBe(a);
    expect(registry.get("openrouter")).toBe(b);
    expect(registry.has("codex")).toBe(false);
  });

  it("throws on duplicate registration", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProviderAdapter("opencode-go"));
    expect(() => registry.register(new MockProviderAdapter("opencode-go"))).toThrow(
      /already registered/,
    );
  });

  it("lists registered slugs", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProviderAdapter("opencode-go"));
    registry.register(new MockProviderAdapter("codex"));
    expect(new Set(registry.list())).toEqual(new Set(["opencode-go", "codex"]));
  });
});
