import { describe, expect, it } from "vitest";
import { CodexUnsupportedAdapter } from "../../providers/codex-unsupported.js";
import { ProviderError } from "../../errors.js";
import type { Account } from "../../types/account.js";

function makeAccount(): Account {
  return {
    id: "acc-1",
    provider: "codex",
    name: "Personal",
    credentials: { kind: "manual" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("CodexUnsupportedAdapter", () => {
  it("testConnection always returns unsupported", async () => {
    const adapter = new CodexUnsupportedAdapter();
    const status = await adapter.testConnection(makeAccount());
    expect(status).toMatchObject({ kind: "error", code: "unsupported" });
    expect(status).toMatchObject({ retriable: false });
    if (status.kind === "error") {
      expect(status.message).toMatch(/not supported/i);
    }
  });

  it("fetchCredits always throws ProviderError('unsupported')", async () => {
    const adapter = new CodexUnsupportedAdapter();
    await expect(adapter.fetchCredits(makeAccount())).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.fetchCredits(makeAccount())).rejects.toMatchObject({
      code: "unsupported",
      retriable: false,
    });
  });

  it("has slug 'codex'", () => {
    const adapter = new CodexUnsupportedAdapter();
    expect(adapter.slug).toBe("codex");
  });
});
