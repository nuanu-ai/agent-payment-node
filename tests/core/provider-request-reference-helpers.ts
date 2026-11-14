/** Shared doubles for the sealed provider request reference tests (QA F26). Synthetic wrapping secret only. */
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../../src/canonical.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";

/** A login-Keychain stand-in: counts loads, can lose its secret, or refuse as a locked Keychain would. */
export class ReferenceTestSecret implements WrappingSecretPort {
  loads = 0;
  secret: Buffer | null = Buffer.alloc(32, 7);
  failure: Error | undefined;
  async load(): Promise<Buffer | null> {
    this.loads += 1;
    if (this.failure !== undefined) throw this.failure;
    return this.secret === null ? null : Buffer.from(this.secret);
  }
  async create(): Promise<Buffer> {
    if (this.failure !== undefined) throw this.failure;
    this.secret ??= Buffer.alloc(32, 7);
    return Buffer.from(this.secret);
  }
}

/** Every regular file under `root`, as text. */
export async function stateFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path); else if (entry.isFile()) files.set(path, await readFile(path, "utf8"));
    }
  };
  await visit(root);
  return files;
}

// Envelope files are JSON shaped per store; the tests change them structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rewrite(path: string, change: (value: Record<string, any>) => Record<string, any>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
  await writeFile(path, `${canonicalJson(change(value))}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function flipped(encoded: string): string {
  const bytes = Buffer.from(encoded, "base64");
  bytes[0] = bytes[0]! ^ 1;
  return bytes.toString("base64");
}
