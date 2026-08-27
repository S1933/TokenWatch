import { readFile } from "node:fs/promises";

export async function readCredentialsFile(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as unknown;
}
