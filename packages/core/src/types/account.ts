import type { ProviderSlug } from "./provider.js";

export type AccountCredentials =
  | { kind: "api_key"; keychainRef: string }
  | { kind: "oauth_file"; path: string }
  | { kind: "oauth_cookie"; cookieRef: string; workspaceId: string }
  | { kind: "manual" };

export interface Account {
  id: string;
  provider: ProviderSlug;
  name: string;
  credentials: AccountCredentials;
  createdAt: Date;
  updatedAt: Date;
}
