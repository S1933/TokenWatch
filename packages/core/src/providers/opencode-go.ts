import type { ProviderAdapter } from "../adapter.js";
import { ProviderError } from "../errors.js";
import type { Account } from "../types/account.js";
import type { CreditSnapshot, CreditWindow } from "../types/credit.js";
import type { ConnectionStatus } from "../types/status.js";

const DEFAULT_BASE_URL = "https://opencode.ai";

export interface OpenCodeGoAdapterDeps {
  keychainResolver: (ref: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface UsageWindow {
  usageDollars?: number;
  limitDollars?: number;
  usagePercent?: number;
  resetInSec?: number;
}

interface UsageResponse {
  rolling5h?: UsageWindow | null;
  weekly?: UsageWindow | null;
  monthly?: UsageWindow | null;
  subscribedAt?: string;
  error?: { message?: string; code?: number };
}

const WINDOW_KEYS = ["rolling5h", "weekly", "monthly"] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];

const WINDOW_TYPE_MAP: Record<WindowKey, CreditWindow["type"]> = {
  rolling5h: "5h",
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
    const json = await this.callJson<UsageResponse>(`${this.baseUrl}/zen/go/v1/usage`, key);
    if (process.env["TOKENWATCH_DEBUG"] === "1") {
      process.stderr.write(`[opencode-go raw] ${JSON.stringify(json)}\n`);
    }
    const now = new Date();
    const windows: CreditWindow[] = [];
    for (const key of WINDOW_KEYS) {
      const w = json[key];
      if (!w) continue;
      const limit = w.limitDollars ?? 0;
      const used = w.usageDollars ?? 0;
      if (limit <= 0) continue;
      windows.push({
        type: WINDOW_TYPE_MAP[key],
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        unit: "usd",
        resetAt: w.resetInSec != null ? new Date(now.getTime() + w.resetInSec * 1000) : null,
      });
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
    let body: string;
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
