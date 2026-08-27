import { resolve } from "node:path";
import { createDb, initSchema, ensureProvider, type Db } from "@tokenwatch/db";
import { PROVIDER_LABELS } from "@tokenwatch/core";
import { createServer } from "./server.js";
import { buildRegistry } from "./services/registry.js";
import { macOSKeychainStore } from "./services/keychain.js";
import { readCredentialsFile } from "./services/credentials-file.js";
import { startBackgroundRefresh } from "./services/refresh.js";

const DB_PATH = process.env["TOKENWATCH_DB"] ?? "./data/tokenwatch.db";
const PORT = Number(process.env["PORT"] ?? 4000);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const REFRESH_INTERVAL_MS = Number(process.env["REFRESH_INTERVAL_MS"] ?? 5 * 60 * 1000);
const MIGRATIONS_FOLDER = resolve(
  import.meta.dirname,
  "../../../packages/db/drizzle",
);

const handle = createDb({ path: DB_PATH });
initSchema(handle, MIGRATIONS_FOLDER);
seedProviders(handle.db);

const keychain = macOSKeychainStore();
const keychainResolver = (ref: string) => keychain.get(ref);
const registry = buildRegistry({
  keychainResolver,
  credentialsFileReader: readCredentialsFile,
});

const app = await createServer({
  db: handle.db,
  registry,
  keychain,
  keychainResolver,
  credentialsFileReader: readCredentialsFile,
});

const background = startBackgroundRefresh(handle.db, registry, REFRESH_INTERVAL_MS);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  background.stop();
  await app.close();
  handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

function seedProviders(db: Db): void {
  for (const slug of Object.keys(PROVIDER_LABELS) as Array<keyof typeof PROVIDER_LABELS>) {
    ensureProvider(db, { slug, name: PROVIDER_LABELS[slug] });
  }
}
