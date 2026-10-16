import assert from "node:assert/strict";
import test from "node:test";
import type { CommandRequest } from "../../src/commands.js";
import { ApnError } from "../../src/errors.js";
import { avalancheFacilitatorRpc } from "../../src/facilitator-gasless/rpc.js";
import { gaslessObservationRpcFactory } from "../../src/gasless/observation-rpc.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessRpcFactory } from "../../src/gasless/rpc.js";
import { GASLESS_EIP7702_CHAINS } from "../../src/gasless/validation.js";
import { failureEnvelope } from "../../src/output.js";
import { createSpecialApnCore } from "../../src/runtime-factory-special.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const RPC = "https://rpc.example/path";
const QUERY = "https://rpc.example/?invalid=query";

function guidance(work: () => unknown): string {
  try { work(); } catch (error) {
    const envelope = failureEnvelope("gasless.transfer.prepare", "guidance-test", error);
    assert.equal(envelope.error?.code, "APN_RPC_CONFIG");
    assert.equal(envelope.next_actions.length, 1);
    return envelope.next_actions[0]!;
  }
  assert.fail("expected an RPC configuration failure");
}

/** Every other network's setting and name must be absent from this network's guidance. */
function assertOnlyNetwork(action: string, chainId: number): void {
  for (const other of GASLESS_EIP7702_CHAINS.filter((id) => id !== chainId)) {
    const row = gaslessDeployment(other);
    assert.ok(!action.includes(row.rpcEnv), `${chainId} guidance names ${row.rpcEnv}: ${action}`);
    assert.ok(!action.includes(row.network), `${chainId} guidance names ${row.network}: ${action}`);
  }
}

for (const chainId of GASLESS_EIP7702_CHAINS) {
  const row = gaslessDeployment(chainId);
  test(`${row.network} gasless RPC configuration guidance names ${row.rpcEnv} and the cause`, () => {
    const missing = guidance(() => gaslessRpcFactory({})(chainId));
    assert.equal(missing, `Set ${row.rpcEnv} to a public HTTPS ${row.network} RPC endpoint.`);
    const query = guidance(() => gaslessRpcFactory({ [row.rpcEnv]: QUERY })(chainId));
    assert.match(query, new RegExp(`^Remove the query string or fragment from ${row.rpcEnv}: .*${row.network} RPC`, "u"));
    const plain = guidance(() => gaslessRpcFactory({ [row.rpcEnv]: "http://rpc.example/path" })(chainId));
    assert.equal(plain, `Set ${row.rpcEnv} to a public, credential-free HTTPS ${row.network} RPC endpoint.`);
    const bundler = guidance(() => gaslessRpcFactory({ [row.rpcEnv]: RPC, [row.bundlerEnv]: QUERY })(chainId));
    assert.match(bundler, new RegExp(`from ${row.bundlerEnv}: .*${row.network} bundler`, "u"));
    const observation = guidance(() => gaslessObservationRpcFactory({})(chainId, "APN_RECOVERY_RPC_URL"));
    assert.match(observation, new RegExp(`^Set APN_RECOVERY_RPC_URL to .*${row.network} RPC endpoint`, "u"));
    for (const action of [missing, query, plain, bundler, observation]) assertOnlyNetwork(action, chainId);
  });
}

test("Avalanche facilitator RPC configuration guidance names APN_AVALANCHE_RPC_URL", () => {
  const missing = guidance(() => avalancheFacilitatorRpc({}));
  assert.equal(missing, "Set APN_AVALANCHE_RPC_URL to a public HTTPS Avalanche C-Chain RPC endpoint.");
  const plain = guidance(() => avalancheFacilitatorRpc({ APN_AVALANCHE_RPC_URL: "http://rpc.example/path" }));
  assert.match(plain, /^Set APN_AVALANCHE_RPC_URL to a public, credential-free HTTPS Avalanche C-Chain RPC endpoint/u);
  assert.ok(!`${missing}${plain}`.includes("Base"));
});

test("the public Ethereum quote names --rpc-url and Ethereum, never Base, for a refused endpoint", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const request: CommandRequest = { command: "gasless.transfer.quote", profile: "guidance",
    owner: "0x1111111111111111111111111111111111111111", request: { chainId: 1,
      recipient: "0x2222222222222222222222222222222222222222", grossAtomic: "5000", maxFeeAtomic: "4000", minReceivedAtomic: "1000" } };
  const core = createSpecialApnCore({ request, rpcUrl: QUERY }, {}, state);
  assert.ok(core !== null);
  const refused = await core.execute(request);
  assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_RPC_CONFIG");
  assert.deepEqual(refused.next_actions, ["Remove the query string or fragment from --rpc-url: APN binds the Ethereum RPC endpoint by its exact URL."]);
  assert.throws(() => createSpecialApnCore({ request }, {}, state), (error: any) =>
    error.code === "APN_RPC_CONFIG" && failureEnvelope("gasless.transfer.quote", "id", error).next_actions[0] ===
      "Provide --rpc-url with a public HTTPS Ethereum RPC endpoint.");
});

test("the shared RPC configuration fallback no longer points every network at Base", () => {
  const envelope = failureEnvelope("transfer.prepare", "fallback", new ApnError("APN_RPC_CONFIG", "Ethereum RPC is missing."));
  assert.deepEqual(envelope.next_actions,
    ["Correct the selected network's RPC setting named in the error (its --rpc-url or APN_*_RPC_URL), then retry."]);
  // Producer guidance always wins over the shared fallback.
  const explicit = failureEnvelope("transfer.prepare", "explicit",
    new ApnError("APN_RPC_CONFIG", "Missing.", { nextActions: ["Set APN_ARBITRUM_RPC_URL."] }));
  assert.deepEqual(explicit.next_actions, ["Set APN_ARBITRUM_RPC_URL."]);
});
