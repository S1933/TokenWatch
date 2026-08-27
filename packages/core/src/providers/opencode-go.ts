import type { ProviderAdapter } from "../adapter.js";
import { ProviderError } from "../errors.js";
import type { Account } from "../types/account.js";
import type { CreditSnapshot, CreditWindow, WindowType } from "../types/credit.js";
import type { ConnectionStatus } from "../types/status.js";

const DEFAULT_BASE_URL = "https://opencode.ai";

export interface OpenCodeGoAdapterDeps {
  keychainResolver: (ref: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface UsageBucket {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

interface UsageResponse {
  usage?: {
    rolling?: UsageBucket | null;
    weekly?: UsageBucket | null;
    monthly?: UsageBucket | null;
  };
  error?: { message?: string; type?: string };
}

const WINDOW_KEYS = ["rolling", "weekly", "monthly"] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];

const WINDOW_TYPE_MAP: Record<WindowKey, WindowType> = {
  rolling: "5h",
  weekly: "weekly",
  monthly: "monthly",
};

export class OpenCodeGoAdapter implements ProviderAdapter {
  readonly slug = "opencode-go" as const;
  private readonly baseUrl: string;
  private readonly keychainResolver: (ref: string) => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: OpenCodeGoAdapterDeps) {
    this.keychainResolver = deps.keychainResolver;
    this.baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async testConnection(account: Account): Promise<ConnectionStatus> {
    if (account.credentials.kind !== "api_key") {
      return {
        kind: "error",
        code: "unsupported",
        message: "OpenCode Go requires api_key credentials",
        retriable: false,
      };
    }
    try {
      const key = await this.keychainResolver(account.credentials.keychainRef);
      const res = await this.fetchImpl(`${this.baseUrl}/zen/go/v1/usage`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401 || res.status === 403) {
        return {
          kind: "error",
          code: "auth_invalid",
          message: `OpenCode Go returned ${res.status}`,
          retriable: false,
        };
      }
      if (res.status === 429) {
        return {
          kind: "error",
          code: "rate_limited",
          message: "OpenCode Go rate limit hit",
          retriable: true,
        };
      }
      if (!res.ok) {
        return {
          kind: "error",
          code: "unknown",
          message: `OpenCode Go returned ${res.status}`,
          retriable: false,
        };
      }
      return { kind: "ok" };
    } catch (err) {
      return {
        kind: "error",
        code: "network",
        message: err instanceof Error ? err.message : "network failure",
        retriable: true,
      };
    }
  }

  async fetchCredits(account: Account): Promise<CreditSnapshot> {
    if (account.credentials.kind !== "api_key") {
      throw new ProviderError("unsupported", "OpenCode Go requires api_key credentials", {
        retriable: false,
      });
    }
    const key = await this.keychainResolver(account.credentials.keychainRef);
    const json = await this.callJson<UsageResponse>(
      `${this.baseUrl}/zen/go/v1/usage`,
      key,
    );
    const now = new Date();
    const windows: CreditWindow[] = [];
    const usage = json.usage;
    if (usage) {
      for (const k of WINDOW_KEYS) {
        const bucket = usage[k];
        if (!bucket || typeof bucket.percent !== "number") continue;
        if (bucket.status && bucket.status !== "ok") continue;
        const percent = Math.max(0, Math.min(bucket.percent, 100));
        const used = Math.round(percent * 100) / 100;
        windows.push({
          type: WINDOW_TYPE_MAP[k],
          used,
          limit: 100,
          remaining: Math.round((100 - percent) * 100) / 100,
          unit: "percent",
          resetAt: bucket.resetsAt ? new Date(bucket.resetsAt) : null,
        });
      }
    }
    return {
      accountId: account.id,
      fetchedAt: now,
      windows,
    };
  }

  private async callJson<T>(url: string, key: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (err) {
      throw new ProviderError("network", err instanceof Error ? err.message : "network", {
        retriable: true,
        cause: err,
      });
    }
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    if (process.env["TOKENWATCH_DEBUG"] === "1") {
      process.stderr.write(
        `[opencode-go raw ${res.status}] ${body.slice(0, 2000)}\n`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth_invalid", `OpenCode Go returned ${res.status}`, {
        retriable: false,
      });
    }
    if (res.status === 429) {
      throw new ProviderError("rate_limited", "OpenCode Go rate limit hit", {
        retriable: true,
      });
    }
    if (res.status === 404) {
      throw new ProviderError(
        "unsupported",
        "OpenCode Go /usage endpoint not available — check that the public API is deployed",
        { retriable: false },
      );
    }
    if (!res.ok) {
      throw new ProviderError("unknown", `OpenCode Go returned ${res.status}`, {
        retriable: false,
      });
    }
    try {
      return JSON.parse(body) as T;
    } catch (err) {
      throw new ProviderError("parse", "Failed to parse OpenCode Go response", {
        retriable: false,
        cause: err,
      });
    }
  }
}
