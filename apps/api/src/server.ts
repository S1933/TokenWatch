import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Db } from "@tokenwatch/db";
import type { ProviderRegistry } from "@tokenwatch/core";
import { registerRoutes } from "./routes.js";
import type { KeychainStore } from "./services/keychain.js";

export interface ServerDeps {
  db: Db;
  registry: ProviderRegistry;
  keychain: KeychainStore;
  keychainResolver: (ref: string) => Promise<string>;
  credentialsFileReader: (path: string) => Promise<unknown>;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  });
  await app.register(cors, { origin: true });
  await registerRoutes(app, deps);
  return app;
}
