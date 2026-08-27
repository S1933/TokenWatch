import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors.js";

describe("ProviderError", () => {
  it("carries code, retriable, and message", () => {
    const err = new ProviderError("auth_expired", "Token expired", { retriable: false });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProviderError");
    expect(err.code).toBe("auth_expired");
    expect(err.retriable).toBe(false);
    expect(err.message).toBe("Token expired");
  });

  it("defaults retriable to false", () => {
    const err = new ProviderError("network", "offline");
    expect(err.retriable).toBe(false);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new ProviderError("network", "offline", { cause });
    expect(err.cause).toBe(cause);
  });
});
