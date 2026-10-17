import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { FacilitatorGaslessOperationRepository } from "../../src/facilitator-gasless/operation-repository.js";
import type { FacilitatorOperationRecord } from "../../src/facilitator-gasless/operation-model.js";
import { facilitatorReceipt } from "../../src/facilitator-gasless/receipt.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { GaslessOperationRepository } from "../../src/gasless/operation-repository.js";
import { gaslessReceipt } from "../../src/gasless/receipt.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { BridgeOperationRepository } from "../../src/lifi/operation-repository.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { metaMaskGaslessReceipt } from "../../src/metamask-gasless/journal/receipt.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import type { MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import { railReceipt, type RailOperationRecord } from "../../src/rail-operation-model.js";
import { RailOperationRepository } from "../../src/rail-operation-repository.js";
import type { SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../src/smart-account-gasless/operation-repository.js";
import { smartAccountGaslessReceipt } from "../../src/smart-account-gasless/receipt.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

/**
 * Phase 4b (CORE-13): the six pure-projection receipts are no longer written; `receipt get` derives them from the
 * operation. The goldens are the receipts 0.5.46 wrote during the family suites, each with its operation as saved at
 * that moment (tests/fixtures/derived-receipts). For every one, the derivation reproduces the stored bytes; a stored
 * file of the current transition is returned as written, and without it the derived receipt is the same.
 */
interface Golden { readonly operation: { readonly profileHash: string; readonly operationId: string }; readonly receipt: unknown }
interface Family {
  readonly derive: (operation: never) => unknown;
  readonly repository: (root: string) => { loadReceipt(profileHash: string, operationId: string): Promise<unknown> };
}
const FAMILIES: Readonly<Record<string, Family>> = {
  rail: { derive: (op: RailOperationRecord) => railReceipt(op), repository: root => new RailOperationRepository(root) },
  gasless: { derive: (op: GaslessOperationRecord) => gaslessReceipt(op), repository: root => new GaslessOperationRepository(root) },
  "metamask-gasless": { derive: (op: MetaMaskGaslessOperationRecord) => metaMaskGaslessReceipt(op),
    repository: root => new MetaMaskGaslessOperationRepository(root) },
  "smart-account-gasless": { derive: (op: SmartAccountGaslessOperationRecord) => smartAccountGaslessReceipt(op),
    repository: root => new SmartAccountGaslessOperationRepository(root) },
  "facilitator-gasless": { derive: (op: FacilitatorOperationRecord) => facilitatorReceipt(op),
    repository: root => new FacilitatorGaslessOperationRepository(root) },
  bridge: { derive: (op: BridgeOperationRecord) => bridgeReceipt(op), repository: root => new BridgeOperationRepository(root) },
};

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${canonicalJson(value)}\n`, { mode: 0o600 });
}

test("every receipt 0.5.46 wrote is derived byte for byte from its saved operation", async (t) => {
  let checked = 0;
  for (const [name, family] of Object.entries(FAMILIES)) {
    const goldens = JSON.parse(await readFile(join("tests", "fixtures", "derived-receipts", `${name}.json`), "utf8")) as readonly Golden[];
    assert.ok(goldens.length > 0, name);
    await t.test(name, async (sub) => {
      const temporary = await temporaryState(); sub.after(temporary.cleanup);
      await new StateStore(temporary.root).initialize();
      for (const golden of goldens) {
        const { profileHash, operationId } = golden.operation, label = `${name} ${(golden.receipt as { state: string }).state}`;
        assert.equal(canonicalJson(family.derive(golden.operation as never)), canonicalJson(golden.receipt), `${label}: derived == stored`);
        const operationPath = join(temporary.root, `${name}-operations`, profileHash, `${operationId}.json`);
        const receiptPath = join(temporary.root, `${name}-receipts`, profileHash, `${operationId}.json`);
        await save(operationPath, golden.operation); await save(receiptPath, golden.receipt);
        const repository = family.repository(temporary.root);
        assert.equal(canonicalJson(await repository.loadReceipt(profileHash, operationId)), canonicalJson(golden.receipt), `${label}: stored file`);
        await rm(receiptPath);
        assert.equal(canonicalJson(await repository.loadReceipt(profileHash, operationId)), canonicalJson(golden.receipt), `${label}: derived`);
        await rm(operationPath);
        checked += 1;
      }
    });
  }
  assert.ok(checked >= 60, `checked ${checked} golden receipts`);
});
