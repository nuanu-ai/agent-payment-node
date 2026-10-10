import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { StateStore } from "../../src/state.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import type { CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import type { CircleLifecyclePorts } from "../../src/circle-v2-evm/lifecycle.js";
import type { CircleAttesterSnapshot, CircleSourceProof } from "../../src/circle-v2-evm/protocol.js";

test("full actual Iris COMPLETE response passes runtime API parsing and real enabled-attester signatures", async t => {
  const original = JSON.parse(await readFile("docs/evidence/circle-v2-evm-iris-v2-actual-response-20261009.json", "utf8"));
  const context = JSON.parse(await readFile("docs/evidence/circle-v2-evm-iris-v2-actual-source-context-20261009.json", "utf8")) as { source: CircleSourceProof; attesters: CircleAttesterSnapshot };
  const op = { source: context.source, destinationChain: 59144, destinationProfile: "evm-live-buyer" } as CircleOperationV1;
  let response = structuredClone(original), apiCalls = 0, deploymentCalls = 0;
  const service = new CircleEvmService(new StateStore("/tmp/circle-actual-iris-no-effects"), { load: async () => { throw new Error("private_material_forbidden"); } } as never, {}, Date.now, {}, {
    request: async (url: string, method: string) => { assert.equal(url, `https://iris-api.circle.com/v2/messages/3?transactionHash=${context.source.transactionHash}`); assert.equal(method, "GET"); apiCalls++; return { status: 200, body: JSON.stringify(response), headers: {} }; },
  } as never);
  const internal = service as unknown as { preflightDeployments(source: CircleRpc, destination: CircleRpc, chain: number): Promise<{ digest: string }>; ports(op: CircleOperationV1): CircleLifecyclePorts };
  t.mock.method(internal, "preflightDeployments", async (source: CircleRpc, destination: CircleRpc, chain: number) => { assert.equal(source.chainId, 42161); assert.equal(destination.chainId, 59144); assert.equal(chain, 59144); deploymentCalls++; return { digest: context.attesters.deploymentDigest }; });
  t.mock.method(CircleRpc.prototype, "identity", async () => {});
  t.mock.method(CircleRpc.prototype, "block", async () => ({ number: `0x${BigInt(context.attesters.blockNumberAtomic).toString(16)}`, hash: context.attesters.blockHash }));
  t.mock.method(CircleRpc.prototype, "read", async (_to: unknown, name: string, args: readonly unknown[] = []) => {
    if (name === "signatureThreshold") return BigInt(context.attesters.threshold);
    if (name === "getNumEnabledAttesters") return BigInt(context.attesters.enabledAttesters.length);
    if (name === "getEnabledAttester") return context.attesters.enabledAttesters[Number(args[0])];
    throw new Error(`unexpected_read:${name}`);
  });
  const ports = internal.ports(op), attested = await ports.attestation(op); assert.ok(attested);
  assert.equal(attested.nonce, "0x61e1723eed95d9ff527f852541862ac14b5399f6be5d56ff029620d74e1d6384");
  assert.equal(attested.feeExecutedAtomic, "5"); assert.equal(attested.receivedAtomic, "40095"); assert.equal(attested.signers.length, 2);
  assert.equal(apiCalls, 1); assert.equal(deploymentCalls, 1); assert.deepEqual(response, original);
  for (const hook of ["0x01", "", 0, false, {}, []]) { response = structuredClone(original); response.messages[0].decodedMessage.decodedMessageBody.hookData = hook; await assert.rejects(ports.attestation(op), /iris_hook/); }
  response = structuredClone(original); response.messages[0].message += "00"; await assert.rejects(ports.attestation(op), /hex/);
  response = structuredClone(original); response.messages[0].decodedMessage.decodedMessageBody.feeExecuted = "6"; await assert.rejects(ports.attestation(op), /iris_decoded_optional/);
  response = structuredClone(original); response.messages[0].decodedMessage.messageBody += "00"; await assert.rejects(ports.attestation(op), /iris_decoded_binding/);
  response = structuredClone(original); response.messages[0].attestation = `0x${"00".repeat(130)}`; await assert.rejects(ports.attestation(op), /signature/);
});
