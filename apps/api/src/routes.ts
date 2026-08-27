import type { FastifyInstance } from "fastify";
import type { AccountCredentials } from "@tokenwatch/core";
import {
  createAccount,
  deleteAccount,
  getLatestSnapshot,
  listAccounts,
  listAccountsWithCredentials,
  listProviders,
} from "@tokenwatch/db";
import { PROVIDER_LABELS, PROVIDER_SLUGS } from "@tokenwatch/core";
import { CreateAccountBodySchema } from "./schemas.js";
import { refreshAccount, refreshAll } from "./services/refresh.js";
import { serializeSnapshot } from "./serialize.js";
import type { KeychainStore } from "./services/keychain.js";
import type { Db } from "@tokenwatch/db";

export interface RoutesDeps {
  db: Db;
  registry: import("@tokenwatch/core").ProviderRegistry;
  keychain: KeychainStore;
  keychainResolver: (ref: string) => Promise<string>;
  credentialsFileReader: (path: string) => Promise<unknown>;
}

type RequestCredentials =
  | { kind: "api_key"; secret: string }
  | { kind: "oauth_file"; path: string }
  | { kind: "oauth_cookie"; cookieRef: string; workspaceId: string }
  | { kind: "manual" };

export async function registerRoutes(
  app: FastifyInstance,
  deps: RoutesDeps,
): Promise<void> {
  const { db, registry, keychain } = deps;

  app.get("/api/health", async () => ({
    status: "ok",
    providers: PROVIDER_SLUGS,
  }));

  app.get("/api/providers", async () => {
    const list = listProviders(db);
    return {
      providers: list.map((p) => ({ slug: p.slug, name: p.name })),
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
      return reply
        .status(400)
        .send({ error: "Invalid body", details: parsed.error.issues });
    }
    const { providerId, name, credentials: reqCreds } = parsed.data;

    let storedRef: string | null = null;
    try {
      const credentials = await buildCredentials(reqCreds, async (ref, secret) => {
        await keychain.set(ref, secret);
        storedRef = ref;
      });
      const acc = createAccount(db, { providerId, name, credentials });
      return reply.status(201).send({
        id: acc.id,
        providerId: acc.providerId,
        name: acc.name,
        status: acc.status,
      });
    } catch (err) {
      if (storedRef) {
        keychain.delete(storedRef).catch(() => {});
      }
      req.log.error({ err }, "failed to create account");
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : "Invalid credentials" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    const acc = listAccountsWithCredentials(db).find((a) => a.id === req.params.id);
    if (!acc) return reply.status(404).send({ error: "Account not found" });
    const ok = deleteAccount(db, req.params.id);
    if (!ok) return reply.status(404).send({ error: "Account not found" });
    if (acc.credentials.kind === "api_key") {
      const ref = acc.credentials.keychainRef;
      keychain.delete(ref).catch((err) => {
        req.log.warn({ err, ref }, "failed to delete keychain entry");
      });
    }
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
}

async function buildCredentials(
  req: RequestCredentials,
  storeApiKey: (ref: string, secret: string) => Promise<void>,
): Promise<AccountCredentials> {
  if (req.kind === "api_key") {
    const ref = `acc-${crypto.randomUUID()}`;
    await storeApiKey(ref, req.secret.trim());
    return { kind: "api_key", keychainRef: ref };
  }
  if (req.kind === "oauth_file") {
    return { kind: "oauth_file", path: req.path };
  }
  if (req.kind === "oauth_cookie") {
    return {
      kind: "oauth_cookie",
      cookieRef: req.cookieRef,
      workspaceId: req.workspaceId,
    };
  }
  return { kind: "manual" };
}
