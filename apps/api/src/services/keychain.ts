import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "tokenwatch";

export async function keychainGet(ref: string): Promise<string> {
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
