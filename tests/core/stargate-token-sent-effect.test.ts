import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { StargateJsonRpc } from "../../src/stargate-v2/native-runtime.js";
import { executeStargateV2Token, prepareStargateV2Token } from "../../src/stargate-v2/token-execution.js";
import { request, setup } from "./stargate-token-support.js";

test("an RPC refusal while a sent approval is observed names the sent transaction and the rerun that never resends it", async () => {
  const s = setup(), prepared = await prepareStargateV2Token(request(), s.ports, s.journal);
  const waitSourceReceipt = s.ports.waitSourceReceipt;
  let refuse = true;
  (s.ports as any).waitSourceReceipt = async (...args: Parameters<typeof waitSourceReceipt>) => {
    if (refuse) { refuse = false; throw new ApnError("APN_RPC_CONFIG", "Stargate native runtime unavailable: rpc_status 503.", { reason: "rpc_status", httpStatus: 503 }); }
    return await waitSourceReceipt(...args);
  };
  const id = prepared.operationId;
  await assert.rejects(executeStargateV2Token(id, s.ports, s.journal), (error: unknown) => {
    assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_CONFIG"); assert.equal(error.details?.reason, "rpc_status");
    assert.equal(error.details?.sent_effect, "approval"); assert.equal(error.details?.operation_phase, "allowance_submitted");
    assert.equal(error.details?.sent_transaction_hash, s.journal.value!.approvalTransactionHash);
    const actions = error.details?.nextActions as readonly string[];
    assert.equal(actions.length, 1); assert.ok(actions[0]!.endsWith(`apn stargate token execute --operation ${id}`));
    return true;
  });
  assert.equal(s.journal.value!.phase, "allowance_submitted"); assert.equal(s.counts().sends, 1);
  const observed = await executeStargateV2Token(id, s.ports, s.journal);
  assert.equal(observed.phase, "observed"); assert.deepEqual(s.counts(), { sends: 2, signs: 2, approvals: 1 });
});

test("a failure before any sent effect keeps its own error", async () => {
  const s = setup(), prepared = await prepareStargateV2Token(request(), s.ports, s.journal);
  const original = new ApnError("APN_RPC_CONFIG", "TEST before any effect.", { reason: "rpc_status" });
  (s.ports as any).approve = async () => { throw original; };
  await assert.rejects(executeStargateV2Token(prepared.operationId, s.ports, s.journal), (error: unknown) => error === original);
  assert.equal(s.counts().sends, 0);
});

test("Stargate RPC names a non-200 status and tells a rate limit from a configuration fault", async () => {
  for (const [status, code] of [[429, "APN_RPC_RATE_LIMITED"], [403, "APN_RPC_CONFIG"], [503, "APN_RPC_CONFIG"]] as const) {
    const rpc = new StargateJsonRpc("https://rpc.example.test/op", { request: async () => ({ status, body: "" }) });
    for (const run of [() => rpc.call("eth_chainId", []), () => rpc.batchCall([{ method: "eth_chainId", params: [] }])]) {
      await assert.rejects(run(), (error: unknown) => error instanceof ApnError && error.code === code &&
        error.details?.reason === "rpc_status" && error.details?.httpStatus === status);
    }
  }
});
