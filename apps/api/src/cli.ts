import { resolve } from "node:path";
import { createDb, initSchema, ensureProvider, type Db } from "@tokenwatch/db";
import {
  createAccount,
  deleteAccount,
  getLatestSnapshot,
  listAccounts,
  listAccountsWithCredentials,
} from "@tokenwatch/db";
import {
  CodexUnsupportedAdapter,
  OpenCodeGoAdapter,
  OpenRouterAdapter,
  ClaudeCodeAdapter,
  ProviderRegistry,
  PROVIDER_LABELS,
  PROVIDER_SLUGS,
  type AccountCredentials,
  type ProviderSlug,
} from "@tokenwatch/core";
import {
  macOSKeychainStore,
  type KeychainStore,
} from "./services/keychain.js";
import { FileKeychainStore } from "./services/file-keychain.js";
import { readCredentialsFile } from "./services/credentials-file.js";
import {
  refreshAccount,
  refreshAll,
  type RefreshResult,
} from "./services/refresh.js";

const DB_PATH = process.env["TOKENWATCH_DB"] ?? "./data/tokenwatch.db";
const MIGRATIONS_FOLDER = resolve(
  import.meta.dirname,
  "../../../packages/db/drizzle",
);

export function resolveStore(): KeychainStore {
  return process.platform === "darwin"
    ? macOSKeychainStore()
    : new FileKeychainStore(process.env["TOKENWATCH_SECRETS_FILE"]);
}

interface SerializedSnapshot {
  id: string;
  accountId: string;
  fetchedAt: string;
  error: { code: string; message: string } | null;
  windows: Array<{
    type: string;
    used: number;
    limit: number;
    remaining: number;
    unit: string;
    resetAt: string | null;
  }>;
}

interface OutputAccount {
  id: string;
  providerId: ProviderSlug;
  providerName: string;
  name: string;
  status: string;
  snapshot: SerializedSnapshot | null;
}

interface Output {
  fetchedAt: string;
  accounts: OutputAccount[];
}

function buildRegistry(keychain: KeychainStore): ProviderRegistry {
  const resolver = (ref: string) => keychain.get(ref);
  const registry = new ProviderRegistry();
  registry.register(new OpenRouterAdapter({ keychainResolver: resolver }));
  registry.register(new OpenCodeGoAdapter({ keychainResolver: resolver }));
  registry.register(
    new ClaudeCodeAdapter({ credentialsFileReader: readCredentialsFile }),
  );
  registry.register(new CodexUnsupportedAdapter());
  return registry;
}

function seedProviders(db: Db): void {
  for (const slug of Object.keys(PROVIDER_LABELS) as Array<keyof typeof PROVIDER_LABELS>) {
    ensureProvider(db, { slug, name: PROVIDER_LABELS[slug] });
  }
}

function openDb(): { handle: ReturnType<typeof createDb>; close: () => void } {
  const handle = createDb({ path: DB_PATH });
  initSchema(handle, MIGRATIONS_FOLDER);
  seedProviders(handle.db);
  return {
    handle,
    close: () => handle.close(),
  };
}

function snapshotToJson(snap: ReturnType<typeof getLatestSnapshot>): SerializedSnapshot | null {
  if (!snap) return null;
  return {
    id: snap.id,
    accountId: snap.accountId,
    fetchedAt: snap.fetchedAt.toISOString(),
    error: snap.errorCode
      ? { code: snap.errorCode, message: snap.errorMessage ?? "" }
      : null,
    windows: snap.windows.map((w) => ({
      type: w.type,
      used: w.used,
      limit: w.limit,
      remaining: w.remaining,
      unit: w.unit,
      resetAt: w.resetAt ? w.resetAt.toISOString() : null,
    })),
  };
}

function buildOutput(db: Db): Output {
  const accounts = listAccounts(db);
  return {
    fetchedAt: new Date().toISOString(),
    accounts: accounts.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      providerName: PROVIDER_LABELS[a.providerId],
      name: a.name,
      status: a.status,
      snapshot: snapshotToJson(getLatestSnapshot(db, a.id)),
    })),
  };
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

const STATUS_DOT: Record<string, string> = {
  healthy: "●",
  warning: "●",
  error: "●",
  unsupported: "○",
  manual: "●",
};

const STATUS_COLOR: Record<string, (s: string) => string> = {
  healthy: (s) => `\x1b[32m${s}\x1b[0m`,
  warning: (s) => `\x1b[33m${s}\x1b[0m`,
  error: (s) => `\x1b[31m${s}\x1b[0m`,
  unsupported: (s) => `\x1b[90m${s}\x1b[0m`,
  manual: (s) => `\x1b[36m${s}\x1b[0m`,
};

function printHuman(output: Output): void {
  const useColor = process.stdout.isTTY === true;
  const colorize = (s: string, status: string) =>
    useColor ? (STATUS_COLOR[status] ?? ((x: string) => x))(s) : s;

  console.log(
    `AI CREDITS — fetched ${new Date(output.fetchedAt).toLocaleString()}`,
  );
  console.log();
  if (output.accounts.length === 0) {
    console.log("  No accounts. Run: pnpm add-account --provider opencode-go --name Personal --secret <key>");
    return;
  }
  for (const a of output.accounts) {
    const dot = colorize(STATUS_DOT[a.status] ?? "?", a.status);
    console.log(`  ${dot} ${a.name}  (${a.providerName})  ${colorize(a.status, a.status)}`);
    if (a.snapshot?.error) {
      console.log(`      ! ${a.snapshot.error.code}: ${a.snapshot.error.message}`);
    }
    if (a.snapshot && a.snapshot.windows.length > 0) {
      for (const w of a.snapshot.windows) {
        const reset =
          w.resetAt != null
            ? `  resets ${new Date(w.resetAt).toLocaleString()}`
            : "";
        const label = displayWindowLabel(a.providerId, w.type);
        console.log(
          `      ${label.padEnd(8)} ${pad(w.used, 7)} / ${pad(w.limit, 7)} ${w.unit.padEnd(8)} (${pad(w.remaining, 7)} remaining)${reset}`,
        );
      }
    } else if (!a.snapshot?.error) {
      console.log(`      (no snapshot yet)`);
    }
  }
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w);
}

type WindowTypeLabel = "5h" | "daily" | "weekly" | "monthly";

function displayWindowLabel(providerId: string, type: string): string {
  // OpenRouter is pay-as-you-go: the "monthly" window actually represents the
  // prepaid USD budget (no reset). Label it "budget" for clarity.
  if (providerId === "openrouter" && type === "monthly") return "budget";
  return type;
}

async function cmdCredits(opts: { refresh: boolean; human: boolean }): Promise<void> {
  const { handle, close } = openDb();
  try {
    if (opts.refresh) {
      const keychain = resolveStore();
      const registry = buildRegistry(keychain);
      const results = await refreshAll(handle.db, registry);
      for (const r of results) {
        if (!r.ok && opts.human) {
          const name =
            listAccounts(handle.db).find((a) => a.id === r.accountId)?.name ??
            r.accountId;
          console.error(`  ! ${name}: ${r.errorCode} — ${r.errorMessage}`);
        }
      }
    }
    const output = buildOutput(handle.db);
    if (opts.human) {
      printHuman(output);
    } else {
      printJson(output);
    }
  } finally {
    close();
  }
}

async function cmdAdd(opts: {
  provider: ProviderSlug;
  name: string;
  secret?: string;
  secretFile?: string;
  path?: string;
}): Promise<void> {
  const { handle, close } = openDb();
  try {
    let credentials: AccountCredentials;
    if (opts.provider === "claude-code") {
      if (!opts.path) {
        throw new Error("--path is required for claude-code (path to credentials JSON file)");
      }
      credentials = { kind: "oauth_file", path: opts.path };
    } else if (opts.provider === "codex") {
      credentials = { kind: "manual" };
    } else {
      if (!opts.secret && !opts.secretFile) {
        throw new Error(
          `--secret (or --secret-file) is required for ${opts.provider}`,
        );
      }
      const secret =
        opts.secretFile !== undefined
          ? await readSecretFile(opts.secretFile)
          : opts.secret!;
      const ref = `acc-${crypto.randomUUID()}`;
      const keychain = resolveStore();
      await keychain.set(ref, secret.trim());
      credentials = { kind: "api_key", keychainRef: ref };
    }
    const acc = createAccount(handle.db, {
      providerId: opts.provider,
      name: opts.name,
      credentials,
    });
    printJson({
      id: acc.id,
      providerId: acc.providerId,
      name: acc.name,
      status: acc.status,
      credentialsKind: credentials.kind,
    });
  } finally {
    close();
  }
}

async function cmdRemove(id: string): Promise<void> {
  const { handle, close } = openDb();
  try {
    const acc = listAccountsWithCredentials(handle.db).find((a) => a.id === id);
    if (!acc) {
      throw new Error(`Account not found: ${id}`);
    }
    const ok = deleteAccount(handle.db, id);
    if (!ok) throw new Error(`Failed to delete ${id}`);
    if (acc.credentials.kind === "api_key") {
      const keychain = resolveStore();
      await keychain.delete(acc.credentials.keychainRef).catch(() => undefined);
    }
    printJson({ removed: id });
  } finally {
    close();
  }
}

async function cmdAccounts(): Promise<void> {
  const { handle, close } = openDb();
  try {
    const accounts = listAccountsWithCredentials(handle.db);
    printJson({
      accounts: accounts.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        providerName: PROVIDER_LABELS[a.providerId],
        name: a.name,
        status: a.status,
        credentialsKind: a.credentials.kind,
      })),
    });
  } finally {
    close();
  }
}

async function readSecretFile(path: string): Promise<string> {
  const content = await readSecretFileRaw(path);
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(`Secret file '${path}' is empty`);
  }
  return trimmed;
}

async function readSecretFileRaw(path: string): Promise<string> {
  const fs = await import("node:fs/promises");
  try {
    return await fs.readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read secret file '${path}'. Write the secret there with: printf '%s\\n' '<key>' > '${path}' && chmod 600 '${path}'`,
      { cause: err },
    );
  }
}

function printHelp(): void {
  console.log(`TokenWatch CLI

Usage:
  pnpm credits [--refresh] [--human]    Show all accounts' credits (default: last snapshot, JSON)
  pnpm accounts                          List all accounts (JSON)
  pnpm add-account --provider P --name N [--secret S | --path P]
                                        Add a new account
  pnpm remove-account <id>              Remove an account

Providers: ${PROVIDER_SLUGS.join(", ")}

Flags (credits):
  --refresh     Force refresh from providers (default: use last snapshot)
  --human       Human-readable text output (default: JSON)

Flags (add-account):
  --provider    One of: ${PROVIDER_SLUGS.join(", ")}
  --name        Display name (e.g. "Personal")
  --secret      API key (for opencode-go, openrouter)
  --secret-file Path to a local file whose first line is the API key (never in chat/argv)
  --path        Path to credentials file (for claude-code)
                codex requires no credentials

Examples:
  pnpm credits
  pnpm credits --refresh
  pnpm credits --human
  pnpm add-account --provider opencode-go --name Personal --secret 'sk-...'
  printf '%s\n' 'sk-...' > ~/.tokenwatch-opencode.key && chmod 600 ~/.tokenwatch-opencode.key
  pnpm add-account --provider opencode-go --name Personal --secret-file ~/.tokenwatch-opencode.key
  pnpm add-account --provider codex --name Personal
  pnpm add-account --provider claude-code --name Work --path ~/.claude/.credentials.json
  pnpm remove-account 49cdcea6-f62f-4368-8424-ef2bffa3cf50
`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function isProviderSlug(s: string): s is ProviderSlug {
  return (PROVIDER_SLUGS as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  try {
    if (cmd === "credits") {
      const flags = parseFlags(args.slice(1));
      await cmdCredits({
        refresh: flags["refresh"] === true,
        human: flags["human"] === true,
      });
    } else if (cmd === "accounts" || cmd === "ls") {
      await cmdAccounts();
    } else if (cmd === "add-account" || cmd === "add") {
      const flags = parseFlags(args.slice(1));
      const provider = flags["provider"];
      const name = flags["name"];
      if (typeof provider !== "string" || !isProviderSlug(provider)) {
        throw new Error(`--provider must be one of: ${PROVIDER_SLUGS.join(", ")}`);
      }
      if (typeof name !== "string" || name.length === 0) {
        throw new Error("--name is required");
      }
      const opts: {
        provider: ProviderSlug;
        name: string;
        secret?: string;
        secretFile?: string;
        path?: string;
      } = { provider, name };
      const secret = typeof flags["secret"] === "string" ? flags["secret"] : undefined;
      const secretFile = typeof flags["secret-file"] === "string" ? flags["secret-file"] : undefined;
      const path = typeof flags["path"] === "string" ? flags["path"] : undefined;
      if (secret !== undefined) opts.secret = secret;
      if (secretFile !== undefined) opts.secretFile = secretFile;
      if (path !== undefined) opts.path = path;
      await cmdAdd(opts);
    } else if (cmd === "remove-account" || cmd === "remove" || cmd === "rm") {
      const id = args[1];
      if (!id) throw new Error("Usage: remove-account <id>");
      await cmdRemove(id);
    } else {
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
