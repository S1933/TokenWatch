export type ProviderSlug =
  | "opencode-go"
  | "openrouter"
  | "claude-code"
  | "codex";

export const PROVIDER_SLUGS: readonly ProviderSlug[] = [
  "opencode-go",
  "openrouter",
  "claude-code",
  "codex",
] as const;

export const PROVIDER_LABELS: Record<ProviderSlug, string> = {
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  "claude-code": "Claude Code",
  codex: "Codex",
};
