import type { ProviderAdapter } from "../adapter.js";
import { ProviderError } from "../errors.js";
import type { Account } from "../types/account.js";
import type { CreditSnapshot, CreditWindow } from "../types/credit.js";
import type { ConnectionStatus } from "../types/status.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

export type CredentialsFileReader = (path: string) => Promise<unknown>;
export type OAuthTokenExtractor = (parsed: unknown) => string | null;

export interface ClaudeCodeAdapterDeps {
  credentialsFileReader: CredentialsFileReader;
  oauthTokenExtractor?: OAuthTokenExtractor;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface UsageBucket {
  utilization?: number;
  resets_at?: string | null;
}

interface UsageResponse {
  five_hour?: UsageBucket | null;
  seven_day?: UsageBucket | null;
  seven_day_opus?: UsageBucket | null;
  seven_day_sonnet?: UsageBucket | null;
  error?: { message?: string; type?: string };
}

const DEFAULT_TOKEN_EXTRACTOR: OAuthTokenExtractor = (parsed) => {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const direct = obj["accessToken"] ?? obj["access_token"];
  if (typeof direct === "string") return direct;
  const nested = obj["claudeAiOauth"];
  if (nested && typeof nested === "object") {
    const inner = (nested as Record<string, unknown>)["accessToken"];
    if (typeof inner === "string") return inner;
  }
  return null;
};

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly slug = "claude-code" as const;
  private readonly baseUrl: string;
  private readonly fileReader: CredentialsFileReader;
  private readonly tokenExtractor: OAuthTokenExtractor;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: ClaudeCodeAdapterDeps) {
    this.fileReader = deps.credentialsFileReader;
    this.tokenExtractor = deps.oauthTokenExtractor ?? DEFAULT_TOKEN_EXTRACTOR;
    this.baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async testConnection(account: Account): Promise<ConnectionStatus> {
    if (account.credentials.kind !== "oauth_file") {
      return {
        kind: "error",
        code: "unsupported",
        message: "Claude Code requires oauth_file credentials",
        retriable: false,
      };
    }
    try {
      const token = await this.readAccessToken(account.credentials.path);
      const res = await this.fetchImpl(`${this.baseUrl}/api/oauth/usage`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": OAUTH_BETA_HEADER,
        },
      });
      return this.mapStatus(res.status);
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: "error",
          code: err.code,
          message: err.message,
          retriable: err.retriable,
        };
      }
      return {
        kind: "error",
        code: "network",
        message: err instanceof Error ? err.message : "network failure",
        retriable: true,
      };
    }
  }

  async fetchCredits(account: Account): Promise<CreditSnapshot> {
    if (account.credentials.kind !== "oauth_file") {
      throw new ProviderError(
        "unsupported",
        "Claude Code requires oauth_file credentials",
        { retriable: false },
      );
    }
    const token = await this.readAccessToken(account.credentials.path);
    const json = await this.callJson<UsageResponse>(
      `${this.baseUrl}/api/oauth/usage`,
      token,
    );
    const now = new Date();
    const windows: CreditWindow[] = [];
    this.pushBucket(windows, "5h", json.five_hour);
    this.pushBucket(windows, "weekly", json.seven_day);
    return {
      accountId: account.id,
      fetchedAt: now,
      windows,
    };
  }

  private async readAccessToken(path: string): Promise<string> {
    let parsed: unknown;
    try {
      parsed = await this.fileReader(path);
    } catch (err) {
      throw new ProviderError(
        "auth_invalid",
        `Failed to read Claude Code credentials at ${path}`,
        { retriable: false, cause: err },
      );
    }
    const token = this.tokenExtractor(parsed);
    if (!token) {
      throw new ProviderError(
        "auth_invalid",
        `Could not extract OAuth access token from ${path}`,
        { retriable: false },
      );
    }
    return token;
  }

  private pushBucket(
    out: CreditWindow[],
    type: CreditWindow["type"],
    bucket: UsageBucket | null | undefined,
  ): void {
    if (!bucket || typeof bucket.utilization !== "number") return;
    const utilization = Math.max(0, Math.min(bucket.utilization, 1));
    const used = Math.round(utilization * 10000) / 100;
    out.push({
      type,
      used,
      limit: 100,
      remaining: Math.round((1 - utilization) * 10000) / 100,
      unit: "percent",
      resetAt: bucket.resets_at ? new Date(bucket.resets_at) : null,
    });
  }

  private mapStatus(status: number): ConnectionStatus {
    if (status === 200) return { kind: "ok" };
    if (status === 401 || status === 403) {
      return { kind: "error", code: "auth_invalid", message: `Anthropic returned ${status}`, retriable: false };
    }
    if (status === 429) {
      return { kind: "error", code: "rate_limited", message: "Anthropic rate limit hit", retriable: true };
    }
    return { kind: "error", code: "unknown", message: `Anthropic returned ${status}`, retriable: false };
  }

  private async callJson<T>(url: string, token: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": OAUTH_BETA_HEADER,
        },
      });
    } catch (err) {
      throw new ProviderError("network", err instanceof Error ? err.message : "network", {
        retriable: true,
        cause: err,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth_invalid", `Anthropic returned ${res.status}`, {
        retriable: false,
      });
    }
    if (res.status === 429) {
      throw new ProviderError("rate_limited", "Anthropic rate limit hit", {
        retriable: true,
      });
    }
    if (!res.ok) {
      throw new ProviderError("unknown", `Anthropic returned ${res.status}`, {
        retriable: false,
      });
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ProviderError("parse", "Failed to parse Anthropic response", {
        retriable: false,
        cause: err,
      });
    }
  }
}
