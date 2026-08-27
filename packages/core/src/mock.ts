import type { ProviderAdapter } from "./adapter.js";
import { ProviderError } from "./errors.js";
import type { Account } from "./types/account.js";
import type {
  CreditSnapshot,
  CreditUnit,
  CreditWindow,
  WindowType,
} from "./types/credit.js";
import type { ProviderSlug } from "./types/provider.js";
import type { ConnectionStatus } from "./types/status.js";

export interface MockWindowSpec {
  type: WindowType;
  used: number;
  limit: number;
  unit: CreditUnit;
  resetInSec?: number;
}

export interface MockSnapshotSpec {
  windows: MockWindowSpec[];
  testConnectionStatus?: ConnectionStatus;
  throwOnFetch?: ProviderError;
  delayMs?: number;
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly slug: ProviderSlug;
  private readonly snapshots = new Map<string, MockSnapshotSpec>();

  constructor(slug: ProviderSlug) {
    this.slug = slug;
  }

  setSnapshot(accountId: string, spec: MockSnapshotSpec): void {
    this.snapshots.set(accountId, spec);
  }

  clearSnapshot(accountId: string): void {
    this.snapshots.delete(accountId);
  }

  async testConnection(account: Account): Promise<ConnectionStatus> {
    const spec = this.snapshots.get(account.id);
    return spec?.testConnectionStatus ?? { kind: "ok" };
  }

  async fetchCredits(account: Account): Promise<CreditSnapshot> {
    const spec = this.snapshots.get(account.id);
    if (!spec) {
      return {
        accountId: account.id,
        fetchedAt: new Date(),
        windows: [],
      };
    }
    if (spec.throwOnFetch) {
      throw spec.throwOnFetch;
    }
    if (spec.delayMs) {
      await new Promise((r) => setTimeout(r, spec.delayMs));
    }
    const now = new Date();
    return {
      accountId: account.id,
      fetchedAt: now,
      windows: spec.windows.map<CreditWindow>((w) => ({
        type: w.type,
        used: w.used,
        limit: w.limit,
        remaining: w.limit - w.used,
        unit: w.unit,
        resetAt: w.resetInSec != null ? new Date(now.getTime() + w.resetInSec * 1000) : null,
      })),
    };
  }
}
