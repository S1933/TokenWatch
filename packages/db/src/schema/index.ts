import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["healthy", "warning", "error", "unsupported", "manual"],
    })
      .notNull()
      .default("healthy"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    providerIdx: index("accounts_provider_idx").on(t.providerId),
  }),
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["api_key", "oauth_file", "oauth_cookie", "manual"],
  }).notNull(),
  keychainRef: text("keychain_ref"),
  meta: text("meta", { mode: "json" }).$type<{ path?: string; workspaceId?: string }>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const creditSnapshots = sqliteTable(
  "credit_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    accountFetchedIdx: index("snapshots_account_fetched_idx").on(t.accountId, t.fetchedAt),
  }),
);

export const creditWindows = sqliteTable(
  "credit_windows",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => creditSnapshots.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["5h", "daily", "weekly", "monthly"] }).notNull(),
    used: real("used").notNull(),
    limit: real("limit").notNull(),
    remaining: real("remaining").notNull(),
    unit: text("unit", {
      enum: ["credits", "usd", "percent", "tokens", "messages"],
    }).notNull(),
    resetAt: integer("reset_at", { mode: "timestamp" }),
  },
  (t) => ({
    snapshotIdx: index("windows_snapshot_idx").on(t.snapshotId),
  }),
);
