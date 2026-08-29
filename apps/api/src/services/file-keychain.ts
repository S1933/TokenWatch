import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface KeychainStore {
  get(ref: string): Promise<string>;
  set(ref: string, secret: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

const DEFAULT_SECRETS_PATH = resolve(homedir(), ".config", "tokenwatch", "secrets.json");
const FILE_MODE = 0o600;

type SecretsFile = Record<string, string>;

async function ensureSecretsPath(path: string): Promise<void> {
  const dir = resolve(path, "..");
  await mkdir(dir, { recursive: true });
}

async function readSecrets(path: string): Promise<SecretsFile> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SecretsFile;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeSecrets(path: string, secrets: SecretsFile): Promise<void> {
  await ensureSecretsPath(path);
  await writeFile(path, JSON.stringify(secrets, null, 2) + "\n", { mode: FILE_MODE });
  // writeFile mode only applies on creation; enforce regardless so an existing
  // permissive file is tightened back down.
  try {
    await chmod(path, FILE_MODE);
  } catch {
    /* best-effort */
  }
}

/**
 * Linux / non-macOS fallback for the Keychain. Persists ref -> secret in a
 * single JSON file under ~/.config/tokenwatch/secrets.json with mode 0600 —
 * never in plaintext tracked by git, never across the chat boundary.
 */
export class FileKeychainStore implements KeychainStore {
  private readonly path: string;
  #cachedWrite: Promise<void> | null = null;

  constructor(path?: string) {
    this.path = resolve(path ?? DEFAULT_SECRETS_PATH);
  }

  async get(ref: string): Promise<string> {
    const secrets = await readSecrets(this.path);
    const value = secrets[ref];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Secret not found for ref '${ref}'. Run: pnpm add-account --provider ... --name ... --secret-file <path>`,
      );
    }
    return value;
  }

  async set(ref: string, secret: string): Promise<void> {
    const secrets = await readSecrets(this.path);
    secrets[ref] = secret;
    // Serialize concurrent writes to avoid clobbering the file.
    this.#cachedWrite ??= writeSecrets(this.path, secrets).finally(() => {
      this.#cachedWrite = null;
    });
    await this.#cachedWrite;
  }

  async delete(ref: string): Promise<void> {
    const secrets = await readSecrets(this.path);
    if (!(ref in secrets)) return;
    delete secrets[ref];
    this.#cachedWrite ??= writeSecrets(this.path, secrets).finally(() => {
      this.#cachedWrite = null;
    });
    await this.#cachedWrite;
  }
}

export const SECRETS_FILE_PATH = DEFAULT_SECRETS_PATH;