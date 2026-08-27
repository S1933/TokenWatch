import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KEYCHAIN_SERVICE = "tokenwatch";

export interface KeychainStore {
  get(ref: string): Promise<string>;
  set(ref: string, secret: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

class MacOSKeychainStore implements KeychainStore {
  async get(ref: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", ref, "-w"],
        { timeout: 5000 },
      );
      const value = stdout.trim();
      if (!value) {
        throw new Error(`Empty value in keychain for '${ref}'`);
      }
      return value;
    } catch (err) {
      throw new Error(
        `Failed to read keychain ref '${ref}'. ` +
          `Store the API key with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a "${ref}" -w`,
        { cause: err },
      );
    }
  }

  async set(ref: string, secret: string): Promise<void> {
    try {
      await execFileAsync(
        "security",
        [
          "add-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          ref,
          "-w",
          secret,
          "-U",
        ],
        { timeout: 5000 },
      );
    } catch (err) {
      throw new Error(
        `Failed to write keychain ref '${ref}'. macOS may have denied access.`,
        { cause: err },
      );
    }
  }

  async delete(ref: string): Promise<void> {
    try {
      await execFileAsync(
        "security",
        ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", ref],
        { timeout: 5000 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/SecKeychainSearchCopyNext|could not be found/i.test(message)) {
        return;
      }
      throw new Error(`Failed to delete keychain ref '${ref}'.`, { cause: err });
    }
  }
}

export function macOSKeychainStore(): KeychainStore {
  return new MacOSKeychainStore();
}
