import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { MetaMaskSmartAccountGaslessProvider } from "../../src/smart-account-gasless/provider.js";
import type { SmartAccountGaslessSealedMaterial } from "../../src/smart-account-gasless/model.js";
import type { SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { saTestIntent, SA_TEST_AT } from "./smart-account-gasless-fixtures.js";

class Transport implements GaslessTransport {
  readonly calls: Array<{ endpoint: string; method: string; body: string | null }> = [];
  constructor(private readonly response: { status: number; body: string }) {}
  async request(endpoint: string, method: "POST" | "GET", body: string | null) {
    this.calls.push({ endpoint, method, body }); return this.response;
  }
}

function material(): SmartAccountGaslessSealedMaterial {
  const intent = saTestIntent();
  const hashes = { encodedRootHash: "1".repeat(64), encodedChildHash: "2".repeat(64),
    permissionContextHash: "3".repeat(64), payloadHash: "4".repeat(64), requirementsHash: "5".repeat(64),
    materialHash: "6".repeat(64), rootDelegationHash: `0x${"7".repeat(64)}` as const,
    childDelegationHash: `0x${"8".repeat(64)}` as const };
  return { phase: "exposed", descriptor: { ...hashes, sealedAt: SA_TEST_AT },
    paymentPayload: { x402Version: 2, accepted: intent.requirements,
      payload: { delegationManager: intent.binding.delegationManager, delegator: intent.binding.ownerAddress,
        permissionContext: "0x1234" } } };
}

function operation(sealed = material()): SmartAccountGaslessOperationRecord {
  return { intent: saTestIntent(), material: sealed.descriptor } as unknown as SmartAccountGaslessOperationRecord;
}

function supportedBody(extraRows: readonly unknown[] = []): string {
  const registry = saRegistry(8453);
  return JSON.stringify({ kinds: [...extraRows, { x402Version: 2, scheme: "exact", network: "eip155:8453",
    extra: { assetTransferMethods: ["eip3009", "erc7710"], note: "benign",
      facilitatorAddresses: registry.facilitatorAddresses } }], extensions: ["gasPayment"],
    signers: { "eip155:*": registry.facilitatorAddresses } });
}

test("supported performs one anonymous GET and freezes exact Base ERC-7710 support", async () => {
  const transport = new Transport({ status: 200, body: supportedBody([
    { x402Version: 2, scheme: "exact", network: "eip155:1", extra: { assetTransferMethods: ["erc7710"],
      facilitatorAddresses: saRegistry(8453).facilitatorAddresses } },
  ]) });
  const provider = new MetaMaskSmartAccountGaslessProvider(transport, () => new Date(SA_TEST_AT));
  const binding = await provider.supported();
  assert.deepEqual(binding.facilitatorAddresses, saRegistry(8453).facilitatorAddresses);
  assert.match(binding.supportedResponseHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(transport.calls, [{ endpoint: `${saRegistry(8453).facilitatorUrl}/supported`, method: "GET", body: null }]);
});

test("supported rejects duplicate, malformed or incompatible Base rows without retries", async () => {
  const base = JSON.parse(supportedBody()).kinds[0];
  for (const body of [supportedBody([base]), JSON.stringify({ kinds: [], extensions: [], signers: {} }), "{\"kinds\":[],\"kinds\":[]}"]) {
    const transport = new Transport({ status: 200, body });
    await assert.rejects(new MetaMaskSmartAccountGaslessProvider(transport).supported());
    assert.equal(transport.calls.length, 1);
  }
});

test("verify sends the exact sealed request once and accepts only valid exact payer", async () => {
  const sealed = material(), op = operation(sealed);
  const transport = new Transport({ status: 200,
    body: JSON.stringify({ isValid: true, payer: op.intent.binding.ownerAddress, extensions: {} }) });
  const verified = await new MetaMaskSmartAccountGaslessProvider(transport, () => new Date(SA_TEST_AT)).verify(op, sealed);
  assert.equal(verified.payer, op.intent.binding.ownerAddress);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0]?.endpoint, `${saRegistry(8453).facilitatorUrl}/verify`);
  assert.equal(transport.calls[0]?.body, canonicalJson({ x402Version: 2, paymentPayload: sealed.paymentPayload,
    paymentRequirements: op.intent.requirements }));
  for (const response of [{ isValid: false, payer: op.intent.binding.ownerAddress },
    { isValid: true, payer: op.intent.binding.sessionAddress }, { isValid: true }, { isValid: true,
      payer: op.intent.binding.ownerAddress, surprise: "secret-canary" }]) {
    const rejected = new Transport({ status: 200, body: JSON.stringify(response) });
    await assert.rejects(new MetaMaskSmartAccountGaslessProvider(rejected).verify(op, sealed));
    assert.equal(rejected.calls.length, 1);
  }
});

test("settle sends the identical frozen request once and returns only a valid untrusted hint", async () => {
  const sealed = material(), op = operation(sealed), transaction = `0x${"a".repeat(64)}`;
  const transport = new Transport({ status: 200, body: JSON.stringify({ success: true,
    payer: op.intent.binding.ownerAddress, transaction, network: "eip155:8453", amount: op.intent.request.grossAtomic }) });
  const settled = await new MetaMaskSmartAccountGaslessProvider(transport, () => new Date(SA_TEST_AT)).settle(op, sealed);
  assert.equal(settled.transactionHash, transaction);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0]?.endpoint, `${saRegistry(8453).facilitatorUrl}/settle`);
  for (const response of [{ success: false, payer: op.intent.binding.ownerAddress, transaction, network: "eip155:8453" },
    { success: true, payer: op.intent.binding.ownerAddress, transaction, network: "eip155:1" },
    { success: true, payer: op.intent.binding.ownerAddress, transaction: "0x01", network: "eip155:8453" },
    { success: true, payer: op.intent.binding.ownerAddress, transaction, network: "eip155:8453", amount: "9999" }]) {
    const rejected = new Transport({ status: 200, body: JSON.stringify(response) });
    await assert.rejects(new MetaMaskSmartAccountGaslessProvider(rejected).settle(op, sealed));
    assert.equal(rejected.calls.length, 1);
  }
});
