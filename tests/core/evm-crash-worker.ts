import { evmCore } from "./evm-helpers.js";

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
if (phase === "sign-crash") {
  await setup.core.transfer.approve(operationId);
  throw new Error("expected process loss was not injected");
}
if (phase !== "resume") throw new Error("unsupported synthetic phase");
setup.approval.rejection = new Error("recovery must not request a replacement signature");
const result = await setup.core.transfer.resume(operationId);
console.log(JSON.stringify({ result, approvals: setup.approval.intents.length, submissions: setup.rpc.submissions.length }));
