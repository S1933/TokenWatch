export type ConnectionErrorCode =
  | "auth_invalid"
  | "auth_expired"
  | "rate_limited"
  | "network"
  | "unsupported"
  | "parse"
  | "unknown";

export type ConnectionStatus =
  | { kind: "ok" }
  | {
      kind: "error";
      code: ConnectionErrorCode;
      message: string;
      retriable: boolean;
    };

export type AccountStatus =
  | "healthy"
  | "warning"
  | "error"
  | "unsupported"
  | "manual";
