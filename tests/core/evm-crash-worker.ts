import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { EVM_BLOCK_HASH, evmCore } from "./evm-helpers.js";

const [phase, root, operationId] = process.argv.slice(2);
if (root === undefined || operationId === undefined) throw new Error("missing synthetic test arguments");
const setup = evmCore(root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
  const result = await native.request(request);
  if (phase === "sign-crash" && request.operation === "directTransfer.approveAndSign") process.exit(74);
  return result;
} }));
const frozen = await setup.state.findOperation(operationId);
if (frozen === null) throw new Error("missing synthetic frozen operation");
setup.rpc.chainId = frozen.chainId;
if (frozen.chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
if (phase === "observe") {
  Object.assign(setup.rpc.evm, { receipt: async (chainId: Parameters<typeof setup.rpc.evm.receipt>[0], transactionHash: Parameters<typeof setup.rpc.evm.receipt>[1]) => {
    await setup.rpc.evm.assertChain(chainId);
    assert.equal(transactionHash, frozen.transactionHash);
    return { transactionHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH, status: "success" as const,
      observedAt: new Date().toISOString(), rpcOrigin: setup.rpc.rpcOrigin, logs: [] };
  } });
}
if (phase === "dispatch-before-crash" || phase === "dispatch-after-crash") {
  const submit = setup.rpc.submitRawTransaction.bind(setup.rpc);
  setup.rpc.submitRawTransaction = async raw => {
    if (phase === "dispatch-before-crash") process.exit(75);
    await submit(raw);
    await writeFile(join(root, "fake-dispatch-witness.json"), JSON.stringify({ transactionHash: setup.rpc.returnedHash, sends: 1 }), { mode: 0o600 });
    process.exit(76);
  };
}
if (phase === "sign-crash" || phase === "dispatch-before-crash" || phase === "dispatch-after-crash") {
  await setup.core.transfer.approve(operationId);
  throw new Error("expected process loss was not injected");
}
if (phase !== "resume" && phase !== "observe") throw new Error("unsupported synthetic phase");
setup.approval.rejection = new Error("recovery must not request a replacement signature");
const result = await setup.core.transfer.resume(operationId, undefined, phase === "observe" ? true : undefined);
console.log(JSON.stringify({ result, approvals: setup.approval.intents.length, submissions: setup.rpc.submissions.length }));
