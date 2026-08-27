export type ProviderSlug = "opencode-go" | "openrouter" | "claude-code" | "codex";
export type WindowType = "5h" | "daily" | "weekly" | "monthly";
export type CreditUnit = "credits" | "usd" | "percent" | "tokens" | "messages";
export type AccountStatus = "healthy" | "warning" | "error" | "unsupported" | "manual";

export interface CreditWindow {
  type: WindowType;
  used: number;
  limit: number;
  remaining: number;
  unit: CreditUnit;
  resetAt: string | null;
}

export interface Snapshot {
  id: string;
  accountId: string;
  fetchedAt: string;
  error: { code: string; message: string } | null;
  windows: CreditWindow[];
}

export interface AccountSummary {
  id: string;
  providerId: ProviderSlug;
  providerName: string;
  name: string;
  status: AccountStatus;
  credentialsKind: string;
  lastSnapshot: Snapshot | null;
}

export interface RefreshResult {
  accountId: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  status: AccountStatus;
}

export type CreateAccountCredentials =
  | { kind: "api_key"; secret: string }
  | { kind: "oauth_file"; path: string }
  | { kind: "oauth_cookie"; cookieRef: string; workspaceId: string }
  | { kind: "manual" };

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  getCredits: () => jsonFetch<{ fetchedAt: string; accounts: AccountSummary[] }>("/api/credits"),
  getAccounts: () => jsonFetch<{ accounts: AccountSummary[] }>("/api/accounts"),
  getProviders: () =>
    jsonFetch<{ providers: { slug: ProviderSlug; name: string }[] }>("/api/providers"),
  refreshAccount: (id: string) =>
    jsonFetch<RefreshResult>(`/api/accounts/${id}/refresh`, { method: "POST" }),
  refreshAll: () => jsonFetch<{ results: RefreshResult[] }>("/api/refresh", { method: "POST" }),
  createAccount: (body: {
    providerId: ProviderSlug;
    name: string;
    credentials: CreateAccountCredentials;
  }) =>
    jsonFetch<{ id: string }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) =>
    jsonFetch<unknown>(`/api/accounts/${id}`, { method: "DELETE" }),
};
