import type { ProviderAdapter } from "../adapter.js";
import { ProviderError } from "../errors.js";
import type { Account } from "../types/account.js";
import type { CreditSnapshot, CreditWindow, WindowType } from "../types/credit.js";
import type { ConnectionStatus } from "../types/status.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterAdapterDeps {
  keychainResolver: (ref: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface AuthKeyResponse {
  data?: {
    label?: string;
    usage?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    limit_reset?: string | null;
    include_byok_usage_in_limit?: boolean;
  };
  error?: { message?: string; code?: number };
}

interface CreditsResponse {
  data?: { total_credits?: number; total_usage?: number };
  error?: { message?: string; code?: number };
}

const RESET_PATTERN = /(\d+)\s*(d|h|m|s)/g;

export function parseLimitReset(input: string): number {
  let total = 0;
  for (const match of input.matchAll(RESET_PATTERN)) {
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n < 0) continue;
    switch (match[2]) {
      case "d":
        total += n * 86400;
        break;
      case "h":
        total += n * 3600;
        break;
      case "m":
        total += n * 60;
        break;
      case "s":
        total += n;
        break;
    }
  }
  return total;
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly slug = "openrouter" as const;
  private readonly baseUrl: string;
  private readonly keychainResolver: (ref: string) => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: OpenRouterAdapterDeps) {
    this.keychainResolver = deps.keychainResolver;
    this.baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async testConnection(account: Account): Promise<ConnectionStatus> {
    if (account.credentials.kind !== "api_key") {
      return {
        kind: "error",
        code: "unsupported",
        message: "OpenRouter requires api_key credentials",
        retriable: false,
      };
    }
    try {
      const key = await this.keychainResolver(account.credentials.keychainRef);
      const res = await this.fetchImpl(`${this.baseUrl}/auth/key`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401 || res.status === 403) {
        return {
          kind: "error",
          code: "auth_invalid",
          message: `OpenRouter returned ${res.status}`,
          retriable: false,
        };
      }
      if (res.status === 429) {
        return {
          kind: "error",
          code: "rate_limited",
          message: "OpenRouter rate limit hit",
          retriable: true,
        };
      }
      if (!res.ok) {
        return {
          kind: "error",
          code: "unknown",
          message: `OpenRouter returned ${res.status}`,
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
      throw new ProviderError("unsupported", "OpenRouter requires api_key credentials", {
        retriable: false,
      });
    }
    const key = await this.keychainResolver(account.credentials.keychainRef);

    // Pay-as-you-go balance. /credits reports acCOUNT-level spend
    // (total_credits prepaid minus total_usage) which is the correct
    // "how much do I have left" for a regular key. /auth/key only exposes
    // per-key usage (often 0) — prefer /credits when reachable, fall back
    // to /auth/key otherwise.
    const credits = await this.tryCredits(key);
    if (credits?.total_credits != null) {
      const limit = credits.total_credits;
      const used = Math.max(0, Math.min(credits.total_usage ?? 0, limit));
      const window: CreditWindow = {
        type: "monthly",
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        unit: "usd",
        resetAt: null,
      };
      return { accountId: account.id, fetchedAt: new Date(), windows: [window] };
    }

    // Fallback: per-key limit from /auth/key (no wallet balance exposed).
    const auth = await this.callJson<AuthKeyResponse>(`${this.baseUrl}/auth/key`, key);
    const keyData = auth.data;
    if (!keyData) {
      throw new ProviderError("parse", "OpenRouter /auth/key returned no data", {
        retriable: false,
      });
    }

    const usage = keyData.usage ?? 0;
    const explicitLimit = keyData.limit ?? null;
    const limitReset = keyData.limit_reset ?? null;

    const cap = explicitLimit ?? usage;
    const used = Math.min(usage, cap);
    const remaining = Math.max(cap - used, 0);
    const resetAt =
      limitReset != null ? new Date(Date.now() + parseLimitReset(limitReset) * 1000) : null;

    const window: CreditWindow = {
      type: pickWindowType(explicitLimit != null, limitReset),
      used,
      limit: cap,
      remaining,
      unit: "usd",
      resetAt,
    };

    return {
      accountId: account.id,
      fetchedAt: new Date(),
      windows: [window],
    };
  }

  private async tryCredits(key: string): Promise<CreditsResponse["data"] | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/credits`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as CreditsResponse;
      return json.data ?? null;
    } catch {
      return null;
    }
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
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth_invalid", `OpenRouter returned ${res.status}`, {
        retriable: false,
      });
    }
    if (res.status === 429) {
      throw new ProviderError("rate_limited", "OpenRouter rate limit hit", {
        retriable: true,
      });
    }
    if (!res.ok) {
      throw new ProviderError("unknown", `OpenRouter returned ${res.status}`, {
        retriable: false,
      });
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ProviderError("parse", "Failed to parse OpenRouter response", {
        retriable: false,
        cause: err,
      });
    }
  }
}

function pickWindowType(hasLimit: boolean, limitReset: string | null): WindowType {
  if (!hasLimit) return "monthly";
  if (limitReset == null) return "monthly";
  const seconds = parseLimitReset(limitReset);
  const days = seconds / 86400;
  if (days <= 1.5) return "daily";
  if (days <= 9) return "weekly";
  return "monthly";
}
