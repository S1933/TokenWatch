import { describe, expect, it } from "vitest";
import {
  CREDIT_UNITS,
  PROVIDER_LABELS,
  PROVIDER_SLUGS,
  WINDOW_TYPES,
} from "../index.js";

describe("provider slug constants", () => {
  it("exposes the 4 expected slugs", () => {
    expect(PROVIDER_SLUGS).toEqual([
      "opencode-go",
      "openrouter",
      "claude-code",
      "codex",
    ]);
  });

  it("has a label for every slug", () => {
    for (const slug of PROVIDER_SLUGS) {
      expect(PROVIDER_LABELS[slug]).toBeTruthy();
    }
  });
});

describe("credit constants", () => {
  it("exposes the 5 expected units", () => {
    expect(new Set(CREDIT_UNITS)).toEqual(
      new Set(["credits", "usd", "percent", "tokens", "messages"]),
    );
  });

  it("exposes the 4 expected window types", () => {
    expect(new Set(WINDOW_TYPES)).toEqual(
      new Set(["5h", "daily", "weekly", "monthly"]),
    );
  });
});
