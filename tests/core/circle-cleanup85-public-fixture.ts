import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StateStore } from "../../src/state.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { validateCircle, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import type { CircleNonceRetirementIntent } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import type { WalletRecord } from "../../src/model.js";
import type { ProviderProfileRecord } from "../../src/provider-profile.js";
/** Authentic unsigned public parent/claim/custody metadata. No private wallet or encrypted bytes.
 * Material files below are explicit dummy ciphertext headers for metadata-only checks, not seals. */
export async function installCleanup85PublicFixture(root: string) {
  const input = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/circle-cleanup85/metadata.json"), "utf8")) as { parent: CircleOperationV1; retirement: { intent: CircleNonceRetirementIntent; authority: unknown; sign: unknown }; wallets: Record<string, WalletRecord>; providers: Record<string, ProviderProfileRecord | null> };
  const state = new StateStore(root); await state.initialize(); const op = validateCircle(input.parent);
  for (const wallet of Object.values(input.wallets)) await state.writeNewWallet(wallet);
  for (const provider of Object.values(input.providers)) if (provider !== null) await state.writeNewProviderProfile(provider);
  const write = async (directory: string, filename: string, value: unknown) => { await mkdir(join(root, directory), { recursive: true, mode: 0o700 }); await writeFile(join(root, directory, filename), canonicalJson(value), { mode: 0o600 }); };
  await write("circle-v2-evm", `${op.operationId}.json`, op);
  for (const row of op.usage) { const identity = { account: row.account, chain: row.chain, asset: row.asset }; await write(`asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}`, `${row.reservationId}.json`, row); }
  for (const [suffix, value] of Object.entries(input.retirement)) await write("circle-v2-nonce-retirements", `${op.operationId}-${suffix}.json`, value);
  for (const effect of op.effects) await write("circle-v2-evm-effects", `${op.operationId}-${effect.role}.json`, { schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, salt: "dummy-public-test-only", nonce: "dummy-public-test-only", ciphertext: "dummy-not-decryptable", tag: "dummy-public-test-only" });
  return { state, op, parent: input.retirement.intent, write };
}
