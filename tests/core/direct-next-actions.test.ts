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

test("default next actions no longer send every RPC configuration failure to a Base --rpc-url", async () => {
  const config = failureEnvelope("x", "r", new ApnError("APN_RPC_CONFIG", "APN_TRON_RPC_URL is required."));
  assert.doesNotMatch(config.next_actions.join(" "), /Base/u);
  assert.match(config.next_actions[0] ?? "", /RPC setting named in the error \(its --rpc-url or APN_\*_RPC_URL\)/u);
  assert.match(failureEnvelope("x", "r", new ApnError("APN_REPREPARE_REQUIRED", "swap quote expired")).next_actions[0] ?? "", /^Prepare a new operation/u);
});
