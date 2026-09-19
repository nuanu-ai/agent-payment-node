import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getAddress } from "viem";
import { GaslessUsdtOperationService } from "../../src/gasless-usdt/service.js";
import { UsdtOperationRepository } from "../../src/gasless-usdt/operation.js";
import { temporaryState } from "./helpers.js";

const PROFILE = "a".repeat(64), POLICY = "b".repeat(64);
const SENDER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");

test("gasless USDT service binds profile, preserves canonical records, and keeps status/resume read-only", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const repository = new UsdtOperationRepository(temporary.root), service = new GaslessUsdtOperationService(repository, PROFILE);
  const operation = await service.prepare({ policyDigest: POLICY, sender: SENDER, recipient: RECIPIENT, grossAtomic: 1_000_000n,
    maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n, nonce: 7n, expiresAt: 1_700_000_900, now: 1_700_000_000 }, "service-001");
  const path = `${repository.directory}/${PROFILE}/${operation.operationId}.json`, before = await readFile(path, "utf8");
  assert.deepEqual(await service.status(operation.operationId), operation);
  assert.deepEqual(await service.resume(operation.operationId), operation);
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(() => new GaslessUsdtOperationService(repository, "c".repeat(64)).status(operation.operationId), { code: "APN_OPERATION_NOT_FOUND" });
});

test("gasless USDT service never exposes effect-capable approval, signer, dispatch, or recovery", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const service = new GaslessUsdtOperationService(new UsdtOperationRepository(temporary.root), PROFILE);
  for (const action of [() => service.approve(), () => service.execute(), () => service.sign(), () => service.dispatch(), () => service.recover()]) {
    assert.throws(action, { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  }
});
