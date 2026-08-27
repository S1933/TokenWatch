import {
  ensureProvider,
  listAccountsWithCredentials,
  saveSnapshot,
  updateAccountStatus,
  type Db,
} from "@tokenwatch/db";
import {
  ProviderError,
  type AccountStatus,
  type ProviderRegistry,
} from "@tokenwatch/core";
import { PROVIDER_LABELS } from "@tokenwatch/core";

const UNHEALTHY_ERROR_CODES = new Set([
  "auth_invalid",
  "auth_expired",
  "unsupported",
  "parse",
]);

export interface RefreshResult {
  accountId: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  status: AccountStatus;
}

export async function refreshAccount(
  db: Db,
  registry: ProviderRegistry,
  accountId: string,
): Promise<RefreshResult> {
  const account = listAccountsWithCredentials(db).find((a) => a.id === accountId);
  if (!account) {
    return {
      accountId,
      ok: false,
      errorCode: "unknown",
      errorMessage: "Account not found",
      status: "error",
    };
  }
  return refreshOne(db, registry, account);
}

export async function refreshAll(
  db: Db,
  registry: ProviderRegistry,
): Promise<RefreshResult[]> {
  const accounts = listAccountsWithCredentials(db);
  const results = await Promise.allSettled(
    accounts.map((a) => refreshOne(db, registry, a)),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const accountId = accounts[i]?.id ?? "unknown";
    return {
      accountId,
      ok: false,
      errorCode: "unknown",
      errorMessage: r.reason instanceof Error ? r.reason.message : String(r.reason),
      status: "error",
    };
  });
}

async function refreshOne(
  db: Db,
  registry: ProviderRegistry,
  account: {
    id: string;
    providerId: import("@tokenwatch/core").ProviderSlug;
    credentials: import("@tokenwatch/core").AccountCredentials;
  },
): Promise<RefreshResult> {
  ensureProvider(db, {
    slug: account.providerId,
    name: PROVIDER_LABELS[account.providerId],
  });
  const adapter = registry.get(account.providerId);
  if (!adapter) {
    updateAccountStatus(db, account.id, "error");
    return {
      accountId: account.id,
      ok: false,
      errorCode: "unsupported",
      errorMessage: `No adapter registered for provider '${account.providerId}'`,
      status: "error",
    };
  }
  try {
    const snapshot = await adapter.fetchCredits({
      id: account.id,
      provider: account.providerId,
      name: "",
      credentials: account.credentials,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    saveSnapshot(db, {
      accountId: account.id,
      fetchedAt: snapshot.fetchedAt,
      windows: snapshot.windows.map((w) => ({
        type: w.type,
        used: w.used,
        limit: w.limit,
        remaining: w.remaining,
        unit: w.unit,
        resetAt: w.resetAt,
      })),
    });
    const status = deriveHealthyStatus(snapshot.windows);
    updateAccountStatus(db, account.id, status);
    return { accountId: account.id, ok: true, status };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    saveSnapshot(db, {
      accountId: account.id,
      error: { code, message },
    });
    const status: AccountStatus = UNHEALTHY_ERROR_CODES.has(code)
      ? (code as AccountStatus)
      : "error";
    updateAccountStatus(db, account.id, status);
    return { accountId: account.id, ok: false, errorCode: code, errorMessage: message, status };
  }
}

function deriveHealthyStatus(
  windows: ReadonlyArray<{ remaining: number; limit: number; unit: string }>,
): AccountStatus {
  if (windows.length === 0) return "healthy";
  for (const w of windows) {
    if (w.limit <= 0) continue;
    if (w.remaining / w.limit < 0.1) return "warning";
  }
  return "healthy";
}

export function startBackgroundRefresh(
  db: Db,
  registry: ProviderRegistry,
  intervalMs: number,
): { stop: () => void } {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await refreshAll(db, registry);
    } catch {
      // Errors are captured per-account inside refreshAll; top-level only fires on
      // unexpected programmer errors. Swallow so the loop survives.
    }
  };
  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
