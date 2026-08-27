import type { ConnectionErrorCode } from "./types/status.js";

export class ProviderError extends Error {
  readonly code: ConnectionErrorCode;
  readonly retriable: boolean;
  override readonly cause?: unknown;

  constructor(
    code: ConnectionErrorCode,
    message: string,
    options: { retriable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retriable = options.retriable ?? false;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
