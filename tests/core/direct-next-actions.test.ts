import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { failureEnvelope } from "../../src/output.js";
import { asRateLimited } from "../../src/rpc-rate-limit.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

test("a direct transfer reports an RPC 429 as a rate limit with a rerun action, not as a protocol failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  Object.assign(setup.rpc.evm, { balance: async () => {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", { rpcMethod: "batch", httpStatus: 429 });
  } });
  const result = await setup.core.execute({ ...EVM_REQUEST, idempotencyKey: "rate-limited-0001" });
  assert.equal(result.error?.code, "APN_RPC_RATE_LIMITED");
  assert.equal(result.error?.details?.httpStatus, 429);
  assert.match(result.next_actions[0] ?? "", /rate-limit window, then rerun the same command/u);
  // The TRON transport reports its status as a string; any other protocol failure is left untouched.
  assert.equal((asRateLimited(new ApnError("APN_RPC_PROTOCOL", "x", { httpStatus: "429" })) as ApnError).code, "APN_RPC_RATE_LIMITED");
  assert.equal((asRateLimited(new ApnError("APN_RPC_PROTOCOL", "x", { httpStatus: 503 })) as ApnError).code, "APN_RPC_PROTOCOL");
});

test("a refused generic approval names the exact re-prepare command with stored values and this invocation's RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root), rpcUrl = "https://rpc.example/v2?key=a&b";
  await ensureDirectWallet(setup);
  const core = new ApnCore({ state: setup.state, rpc: setup.rpc, native: setup.local, clock: setup.clock, rpcUrl });
  const prepared = await core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "next-action-0001" }) as { operation_id: string; next_actions: string[] };
  assert.deepEqual(prepared.next_actions, [`apn pay transfer approve --operation ${prepared.operation_id} --rpc-url '${rpcUrl}'`,
    `apn operation status --operation ${prepared.operation_id}`]);
  setup.rpc.nonceAtomic = "8";
  const refused = await core.execute({ command: "transfer.approve", operationId: prepared.operation_id });
  assert.equal(refused.error?.code, "APN_REPREPARE_REQUIRED");
  const key = `retry-${prepared.operation_id.slice(0, 16)}`;
  assert.deepEqual(refused.next_actions, [`apn pay transfer prepare-asset --profile default --chain eip155:8453 --asset native --to ${EVM_REQUEST.recipient} ` +
    `--amount ${EVM_REQUEST.amount} --max-fee-wei ${EVM_REQUEST.maxFeeWei} --idempotency-key ${key} --rpc-url '${rpcUrl}'`]);
  const offline = await setup.core.execute({ command: "operation.status", operationId: prepared.operation_id });
  assert.match((offline.operation as { next_actions: string[] }).next_actions[0] ?? "", /--idempotency-key retry-[0-9a-f]{16} --rpc-url <https-url>$/u);
});

test("default next actions name the RPC variable the failure names, else the generic RPC setting", async () => {
  const config = failureEnvelope("x", "r", new ApnError("APN_RPC_CONFIG", "APN_TRON_RPC_URL is required."));
  assert.deepEqual(config.next_actions, ["Set APN_TRON_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);
  const bridge = failureEnvelope("x", "r", new ApnError("APN_RPC_CONFIG", "Bridge RPC is not configured.", { reason: "missing_APN_LINEA_RPC_URL" }));
  assert.deepEqual(bridge.next_actions, ["Set APN_LINEA_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);
  const generic = failureEnvelope("x", "r", new ApnError("APN_RPC_CONFIG", "RPC endpoint must be public HTTPS."));
  assert.match(generic.next_actions[0] ?? "", /RPC setting named in the error \(its --rpc-url or APN_\*_RPC_URL\)/u);
  assert.match(failureEnvelope("x", "r", new ApnError("APN_REPREPARE_REQUIRED", "swap quote expired")).next_actions[0] ?? "", /^Prepare a new operation/u);
});

test("a 429 reaches the caller as a rate limit and an unexpected exception carries only its class", () => {
  const limited = failureEnvelope("x", "r", new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", { rpcMethod: "eth_call", httpStatus: 429 }));
  assert.equal(limited.error?.code, "APN_RPC_RATE_LIMITED");
  assert.match(limited.next_actions[0] ?? "", /rate-limit window/u);
  const other = failureEnvelope("x", "r", new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", { httpStatus: 503 }));
  assert.equal(other.error?.code, "APN_RPC_PROTOCOL");
  const internal = failureEnvelope("x", "r", new TypeError("SECRET_CANARY cannot read properties"));
  assert.equal(internal.error?.code, "APN_INTERNAL");
  assert.deepEqual(internal.error?.details, { internal_class: "TypeError" });
  assert.equal(JSON.stringify(internal).includes("SECRET_CANARY"), false);
  assert.deepEqual(failureEnvelope("x", "r", "plain string").error?.details, { internal_class: "string" });
});
