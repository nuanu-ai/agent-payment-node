/** Runs one custody case against a set of envelope files: the golden open plus every tamper, as comparable outcomes. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson } from "../../src/canonical.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import type { CustodyCase } from "./custody-envelope-cases.js";
import { FILE_TAMPERS, FixedSecret, PLAINTEXT_TAMPERS, outcome, referenceSeal, type Json, type Outcome, temporaryRoot } from "./custody-envelope-reference.js";

class EnvelopeFiles extends SecureStateStore {
  async put(path: string, value: unknown): Promise<void> {
    await this.initialize(); await this.ensureDirectory(dirname(path)); await this.writeJson(path, value);
  }
}

/** Reads the files a store wrote, insisting on the exact bytes APN writes (canonical JSON plus a newline). */
export async function readEnvelopeFiles(root: string, paths: readonly string[]): Promise<Record<string, Json>> {
  const files: Record<string, Json> = {};
  for (const path of paths) {
    const text = await readFile(join(root, path), "utf8"), value = JSON.parse(text) as Json;
    if (text !== `${canonicalJson(value)}\n`) throw new Error(`${path} is not the canonical bytes APN writes`);
    files[path] = value;
  }
  return files;
}

export async function withFiles<T>(files: Readonly<Record<string, unknown>>, action: (root: string) => Promise<T>): Promise<T> {
  const temporary = await temporaryRoot();
  try {
    const writer = new EnvelopeFiles(temporary.root);
    for (const [path, value] of Object.entries(files)) await writer.put(path, value);
    return await action(temporary.root);
  } finally { await temporary.cleanup(); }
}

export interface CaseInput {
  readonly files: Readonly<Record<string, Json>>; readonly envelopePath: string; readonly context: Json; readonly plaintext: string;
}
/** Every outcome a golden file records for one store. Empty for a store that no release decrypts. */
export async function caseOutcomes(c: CustodyCase, input: CaseInput, secret: Buffer): Promise<Record<string, Outcome>> {
  const open = c.open; if (open === undefined) return {};
  const run = async (files: Readonly<Record<string, unknown>>, context: Json, key: Buffer | null) =>
    await withFiles(files, async root => await outcome(async () => await open(root, new FixedSecret(key), context)));
  const envelope = input.files[input.envelopePath], replace = (value: Json) => ({ ...input.files, [input.envelopePath]: value });
  const outcomes: Record<string, Outcome> = {
    golden: await run(input.files, input.context, secret),
    "wrong-secret": await run(input.files, input.context, Buffer.alloc(32, 0x5a)),
    "secret-missing": await run(input.files, input.context, null),
  };
  for (const [name, tamper] of Object.entries(FILE_TAMPERS)) outcomes[name] = await run(replace(tamper(c.format, envelope)), input.context, secret);
  for (const [name, tamper] of Object.entries(PLAINTEXT_TAMPERS)) {
    outcomes[name] = await run(replace(referenceSeal(c.format, envelope, secret, tamper(input.plaintext))), input.context, secret);
  }
  if (c.aad !== undefined) {
    const changed = c.aad(input.files, input.context, input.envelopePath);
    outcomes["aad-changed"] = await run(changed.files, changed.context, secret);
  }
  return outcomes;
}
