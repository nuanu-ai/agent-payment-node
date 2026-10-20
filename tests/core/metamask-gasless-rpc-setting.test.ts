/**
 * METAMASK-MISSING-RPC-DIAGNOSTIC-001: an unset, empty or non-public-HTTPS chain RPC setting is a configuration refusal
 * that names the variable and the chain, raised before any network request, provider call, record or signature; a
 * reachable RPC of another chain stays a strict binding refusal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { metaMaskGaslessRpcFactory } from "../../src/metamask-gasless/chain/rpc.js";
import type { MetaMaskGaslessChainId } from "../../src/metamask-gasless/model.js";
import { temporaryState } from "./helpers.js";
import { mmFixture } from "./metamask-gasless-helpers.js";

const clock = { now: () => new Date("2026-10-19T00:00:00.000Z") };
function transport(chainId: bigint) {
  const methods: string[] = [];
  const port: GaslessTransport = { async request(_endpoint, _verb, body) {
    const requests = JSON.parse(body ?? "null") as { id: string; method: string } | { id: string; method: string }[];
    const one = (request: { id: string; method: string }) => { methods.push(request.method);
      return { jsonrpc: "2.0", id: request.id, result: request.method === "eth_chainId" ? `0x${chainId.toString(16)}` : null }; };
    return { status: 200, body: JSON.stringify(Array.isArray(requests) ? requests.map(one) : one(requests)) };
  } };
  return { port, methods };
}

for (const [chainId, variable, slug] of [[1, "APN_ETHEREUM_RPC_URL", "ethereum-mainnet"], [137, "APN_POLYGON_RPC_URL", "polygon-mainnet"],
  [10, "APN_OPTIMISM_RPC_URL", "optimism-mainnet"], [59144, "APN_LINEA_RPC_URL", "linea-mainnet"], [143, "APN_MONAD_RPC_URL", "monad-mainnet"]] as const) {
  test(`eip155:${chainId}: a missing, empty or malformed ${variable} is named before any request; a public HTTPS URL builds the port`, () => {
    const network = transport(BigInt(chainId));
    for (const [environment, state] of [[{}, "it is not set"], [{ [variable]: "" }, "it is not set"],
      [{ [variable]: "http://rpc.example" }, "its value is not one"], [{ [variable]: "https://user:secret@rpc.example" }, "its value is not one"],
      [{ APN_BASE_RPC_URL: "https://base.example" }, "it is not set"]] as const) {
      assert.throws(() => metaMaskGaslessRpcFactory(environment, clock, network.port)(chainId as MetaMaskGaslessChainId), (error: unknown) => {
        const failure = error as { code: string; message: string; details: Record<string, unknown> };
        assert.equal(failure.code, "APN_RPC_CONFIG");
        assert.equal(failure.message, `MetaMask gasless on eip155:${chainId} (${slug}) needs ${variable} set to a public, credential-free ` +
          `HTTPS RPC endpoint of that chain; ${state}.`);
        assert.deepEqual(failure.details, { reason: "mm_gasless_rpc_setting", chainId: `eip155:${chainId}`, environmentVariable: variable });
        return true;
      });
    }
    const rpc = metaMaskGaslessRpcFactory({ [variable]: "https://public.example/rpc" }, clock, network.port)(chainId as MetaMaskGaslessChainId);
    assert.deepEqual([rpc.chainId, rpc.endpointOrigin, network.methods], [chainId, "https://public.example", []]);
  });
}

test("an endpoint of another chain stays a strict binding refusal at its first read", async () => {
  const wrong = transport(8453n);
  const rpc = metaMaskGaslessRpcFactory({ APN_ETHEREUM_RPC_URL: "https://base-not-ethereum.example" }, clock, wrong.port)(1);
  await assert.rejects(rpc.balance("0x1111111111111111111111111111111111111111"), (error: unknown) =>
    (error as { code: string }).code !== "APN_RPC_CONFIG" && (error as { details?: { reason?: string } }).details?.reason !== "mm_gasless_rpc_setting");
  assert.equal(wrong.methods[0], "eth_chainId");
});

test("gasless transfer prepare without the chain's RPC setting refuses with the variable named: no provider call, record or signature", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 1), network = transport(1n);
  const core = new ApnCore({ state: f.state, clock: f.clock, wait: f.wait,
    metaMaskGasless: { ...f.dependencies, rpcFor: metaMaskGaslessRpcFactory({}, f.clock, network.port) } });
  const refused = await core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: "mm-missing-rpc-0001" });
  assert.equal(refused.ok, false);
  assert.deepEqual([refused.error?.code, refused.error?.details?.reason, refused.error?.details?.environmentVariable, refused.operation],
    ["APN_RPC_CONFIG", "mm_gasless_rpc_setting", "APN_ETHEREUM_RPC_URL", null]);
  assert.deepEqual(refused.next_actions, ["Set APN_ETHEREUM_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);
  assert.deepEqual([f.provider.calls, network.methods, f.approval.calls.length], [[], [], 0]);
  assert.equal(await core.metaMaskGasless.records.findOperation("0".repeat(64)), null);
  // Once the setting exists the same intent reaches the next independent precondition (here the fixture's own RPC).
  const ready = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: "mm-missing-rpc-0001" });
  assert.equal(ready.ok, true, JSON.stringify(ready.error));
});
