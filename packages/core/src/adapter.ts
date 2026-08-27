import type { Account } from "./types/account.js";
import type { CreditSnapshot } from "./types/credit.js";
import type { ProviderSlug } from "./types/provider.js";
import type { ConnectionStatus } from "./types/status.js";

export interface ProviderAdapter {
  readonly slug: ProviderSlug;
  testConnection(account: Account): Promise<ConnectionStatus>;
  fetchCredits(account: Account): Promise<CreditSnapshot>;
}
