export type { ProviderAdapter } from "./adapter.js";
export { ProviderRegistry } from "./registry.js";
export { MockProviderAdapter, type MockSnapshotSpec, type MockWindowSpec } from "./mock.js";
export { ProviderError } from "./errors.js";

export {
  OpenRouterAdapter,
  parseLimitReset,
  type OpenRouterAdapterDeps,
} from "./providers/openrouter.js";
export {
  OpenCodeGoAdapter,
  type OpenCodeGoAdapterDeps,
} from "./providers/opencode-go.js";
export {
  ClaudeCodeAdapter,
  type ClaudeCodeAdapterDeps,
  type CredentialsFileReader,
  type OAuthTokenExtractor,
} from "./providers/claude-code.js";

export type { Account, AccountCredentials } from "./types/account.js";
export type {
  CreditSnapshot,
  CreditUnit,
  CreditWindow,
  WindowType,
} from "./types/credit.js";
export { CREDIT_UNITS, WINDOW_TYPES } from "./types/credit.js";
export type { ProviderSlug } from "./types/provider.js";
export { PROVIDER_LABELS, PROVIDER_SLUGS } from "./types/provider.js";
export type {
  AccountStatus,
  ConnectionErrorCode,
  ConnectionStatus,
} from "./types/status.js";
