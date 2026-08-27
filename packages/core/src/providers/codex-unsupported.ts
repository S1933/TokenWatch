import type { ProviderAdapter } from "../adapter.js";
import { ProviderError } from "../errors.js";
import type { Account } from "../types/account.js";
import type { CreditSnapshot } from "../types/credit.js";
import type { ConnectionStatus } from "../types/status.js";

const UNSUPPORTED_MESSAGE =
  "Codex quota tracking is not supported in this build. " +
  "OpenAI does not expose a public endpoint for ChatGPT subscription quota. " +
  "Use a 'manual' credential or skip Codex.";

export class CodexUnsupportedAdapter implements ProviderAdapter {
  readonly slug = "codex" as const;

  async testConnection(_account: Account): Promise<ConnectionStatus> {
    return {
      kind: "error",
      code: "unsupported",
      message: UNSUPPORTED_MESSAGE,
      retriable: false,
    };
  }

  async fetchCredits(_account: Account): Promise<CreditSnapshot> {
    throw new ProviderError("unsupported", UNSUPPORTED_MESSAGE, { retriable: false });
  }
}
