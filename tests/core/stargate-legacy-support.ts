import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLegacyStargateRecord, loadLegacyStargateRecord, type LegacyStargateFamily, type LegacyStargateRecord } from "../../src/legacy/stargate-v2/reader.js";
import type { FinalizedBatchRead } from "../../src/evm-finalized-proof.js";
import type { LegacyChainRead } from "../../src/legacy/stargate-v2/status.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";

/** The golden records of the unreleased Stargate schemas, written by the 60b247d5^ writer (see the corpus manifest). */
export const GOLDEN_CASES = ["61-unreleased-stargate-native-v1", "62-unreleased-stargate-token-v1", "63-unreleased-stargate-token-v2",
  "64-unreleased-stargate-token-v3", "65-unreleased-stargate-token-v4"] as const;
export const CORPUS = join("tests", "fixtures", "legacy-corpus");
/** A directory of read-only copies of real unreleased-schema records (owner data, never committed), named by
 * `APN_STARGATE_LEGACY_COPIES`; the test that reads them skips when it is unset. */
export const OWNER_COPIES = process.env.APN_STARGATE_LEGACY_COPIES;
export const DIRECTORY: Readonly<Record<LegacyStargateFamily, string>> = { stargate_native: "stargate-v2-native", stargate_token: "stargate-v2-token" };
export const TERMINAL_PHASES: Readonly<Record<LegacyStargateFamily, readonly string[]>> = {
  stargate_native: ["observed", "failed_confirmed_revert"], stargate_token: ["observed", "cleaned"] };
export const CHAIN: Readonly<Record<LegacyStargateFamily, number>> = { stargate_native: 1, stargate_token: 10 };

export interface Golden { readonly family: LegacyStargateFamily; readonly record: LegacyStargateRecord }

/** Installs one golden case and returns its records, read back through the frozen reader. */
export async function installGolden(caseName: typeof GOLDEN_CASES[number], root: string): Promise<readonly Golden[]> {
  await installLegacyCase(join(CORPUS, caseName), root);
  const family: LegacyStargateFamily = caseName.includes("native") ? "stargate_native" : "stargate_token", out: Golden[] = [];
  for (const name of (await readdir(join(root, DIRECTORY[family]))).filter(file => /^[a-f0-9]{64}\.json$/u.test(file)).sort()) {
    const record = await loadLegacyStargateRecord(root, family, name.slice(0, -".json".length));
    assert.ok(record !== null && isLegacyStargateRecord(record), `${caseName}/${name}`);
    out.push({ family, record });
  }
  return out;
}
export function golden(records: readonly Golden[], phase: string): Golden {
  const found = records.find(item => item.record.phase === phase);
  assert.ok(found !== undefined, `golden ${phase}`);
  return found;
}

/** Copies record files into a state root with the owner-only modes the journals require. */
export async function seedRecords(root: string, files: readonly { readonly directory: string; readonly name: string; readonly bytes: string }[]): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  for (const file of files) {
    await mkdir(join(root, file.directory), { recursive: true, mode: 0o700 }); await chmod(join(root, file.directory), 0o700);
    await writeFile(join(root, file.directory, file.name), file.bytes, { mode: 0o600 });
  }
}
export async function ownerCopies(): Promise<readonly { readonly directory: string; readonly name: string; readonly bytes: string }[] | null> {
  if (OWNER_COPIES === undefined || OWNER_COPIES === "") return null;
  const root = OWNER_COPIES, files: { directory: string; name: string; bytes: string }[] = [];
  for (const directory of Object.values(DIRECTORY)) {
    let names: string[];
    try { names = await readdir(join(root, directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    for (const name of names.filter(file => /^[a-f0-9]{64}\.json$/u.test(file))) files.push({ directory, name, bytes: await readFile(join(root, directory, name), "utf8") });
  }
  return files;
}

/** A public-RPC stand-in for the closure check: chain id, finalized nonce per account, transactions by hash; counts calls. */
export function mockChain(chainId: number, finalizedNonce: bigint, transactions: Readonly<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const rpc: LegacyChainRead = {
    async call(method, params) {
      calls.push(method);
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_getTransactionCount") { assert.equal(params[1], "finalized", "the nonce is read at the finalized tag only"); return `0x${finalizedNonce.toString(16)}`; }
      return transactions[String(params[0]).toLowerCase()] ?? null;
    },
  };
  /** The never-lands proof's one-node batch: each row answered as `call` answers it. */
  const batch: FinalizedBatchRead = async rows => await Promise.all(rows.map(async row => await rpc.call(row.method, row.params)));
  return { rpc, batch, calls };
}
