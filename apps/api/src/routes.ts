import type { FastifyInstance } from "fastify";
import {
  createAccount,
  deleteAccount,
  getLatestSnapshot,
  listAccounts,
  listAccountsWithCredentials,
  listProviders,
} from "@tokenwatch/db";
import { PROVIDER_LABELS, PROVIDER_SLUGS, type ProviderRegistry } from "@tokenwatch/core";
import { CreateAccountBodySchema } from "./schemas.js";
import { refreshAccount, refreshAll } from "./services/refresh.js";
import { serializeSnapshot } from "./serialize.js";
import type { Db } from "@tokenwatch/db";

export interface RoutesDeps {
  db: Db;
  registry: ProviderRegistry;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  const { db, registry } = deps;

  app.get("/api/providers", async () => {
    const list = listProviders(db);
    return {
      providers: list.map((p) => ({
        slug: p.slug,
        name: p.name,
      })),
    };
  });

  app.get("/api/accounts", async () => {
    const list = listAccountsWithCredentials(db);
    return {
      accounts: list.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        providerName: PROVIDER_LABELS[a.providerId],
        name: a.name,
        status: a.status,
        credentialsKind: a.credentials.kind,
        lastSnapshot: serializeSnapshot(getLatestSnapshot(db, a.id)),
      })),
    };
  });

  app.post("/api/accounts", async (req, reply) => {
    const parsed = CreateAccountBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid body", details: parsed.error.issues });
    }
    const { providerId, name, credentials } = parsed.data;
    const acc = createAccount(db, { providerId, name, credentials });
    return reply.status(201).send({
      id: acc.id,
      providerId: acc.providerId,
      name: acc.name,
      status: acc.status,
    });
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    const ok = deleteAccount(db, req.params.id);
    if (!ok) return reply.status(404).send({ error: "Account not found" });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/accounts/:id/credits", async (req, reply) => {
    const acc = listAccounts(db).find((a) => a.id === req.params.id);
    if (!acc) return reply.status(404).send({ error: "Account not found" });
    return {
      accountId: acc.id,
      providerId: acc.providerId,
      status: acc.status,
      snapshot: serializeSnapshot(getLatestSnapshot(db, acc.id)),
    };
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh", async (req, reply) => {
    const result = await refreshAccount(db, registry, req.params.id);
    if (result.errorCode === "unknown" && result.errorMessage === "Account not found") {
      return reply.status(404).send({ error: "Account not found" });
    }
    return result;
  });

  app.get("/api/credits", async () => {
    const accounts = listAccounts(db);
    return {
      fetchedAt: new Date().toISOString(),
      accounts: accounts.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        providerName: PROVIDER_LABELS[a.providerId],
        name: a.name,
        status: a.status,
        snapshot: serializeSnapshot(getLatestSnapshot(db, a.id)),
      })),
    };
  });

  app.post("/api/refresh", async () => {
    const results = await refreshAll(db, registry);
    return { results };
  });

  app.get("/api/health", async () => ({
    status: "ok",
    providers: PROVIDER_SLUGS,
  }));
}
