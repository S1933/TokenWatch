import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Db } from "@tokenwatch/db";
import type { ProviderRegistry } from "@tokenwatch/core";
import { registerRoutes } from "./routes.js";

export interface ServerDeps {
  db: Db;
  registry: ProviderRegistry;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  });
  await app.register(cors, { origin: true });
  await registerRoutes(app, deps);
  return app;
}
