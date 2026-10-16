import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERIC_OPERATION_KINDS } from "../../src/operation-coverage.js";
import { StateStore } from "../../src/state.js";
import { TestNative, makeCore, temporaryState } from "./helpers.js";

test("generic operation commands name an uncovered family instead of answering not found", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await new StateStore(temporary.root).initialize();
  const operationId = "7".repeat(64);
  await mkdir(join(temporary.root, "stargate-v2-token"), { mode: 0o700 });
  await writeFile(join(temporary.root, "stargate-v2-token", `${operationId}.json`), "{}\n", { mode: 0o600 });
  const core = makeCore({ root: temporary.root, native: new TestNative() });
  for (const request of [{ command: "operation.status", operationId }, { command: "receipt.get", operationId },
    { command: "operation.abandon", operationId }] as const) {
    const result = await core.execute(request);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_UNSUPPORTED_COMMAND", JSON.stringify(result));
    assert.equal(result.error?.details?.reason, "operation_kind_not_covered");
    assert.equal(result.error?.details?.family, "stargate_token");
    assert.deepEqual(result.next_actions, ["apn stargate token status"]);
  }

  const unknown = await core.execute({ command: "operation.status", operationId: "8".repeat(64) });
  assert.equal(unknown.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.deepEqual(unknown.error?.details?.covered_kinds, GENERIC_OPERATION_KINDS);
});
