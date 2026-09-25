import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayApprovalEffectService, type RelayApprovalCustodyPort, type RelayApprovalObservation,
  type RelayApprovalPorts } from "../../src/relay/approval-effect.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, validateRelayQuote } from "../../src/relay/quote.js";
import { RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const owner = account.address.toLowerCase();
const fixturePayer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase();
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const now = new Date("2026-09-30T00:00:00.000Z");
const blockHash = `0x${"a".repeat(64)}`;
const topic = keccak256(toBytes("Approval(address,address,uint256)"));
const word = (hex: string) => `0x${hex.slice(2).padStart(64, "0")}`;

function policy() {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt: "2026-10-02T00:00:00.000Z", chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum",
      assets: [{ kind: "token", identifier: ETHEREUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } } }] }] });
  return { profile: "default" as const, registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const fixture = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quoted = await validateRelayQuote(fixture, { payer: fixturePayer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, ...body } = quoted;
  const modified = { ...body, payer: owner, sourceRefundRecipient: owner,
    approval: { ...quoted.approval, from: owner }, deposit: { ...quoted.deposit, from: owner } };
  const quote = { ...modified, quoteDigest: hashObject(modified) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("default"), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: owner, recipient, quoteDigest: quote.quoteDigest, quote,
    policyDigest: policy().digest, policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
  const repo = new RelayUnsignedOperationRepository(temp.root);
  await repo.initialize(); await repo.persistLocked(op);
  let saved: { rawTransaction: Hex; transactionHash: Hex } | null = null;
  let signs = 0, sends = 0, observations = 0;
  let observation: RelayApprovalObservation | null = null;
  const custody: RelayApprovalCustodyPort = {
    load: async () => saved,
    seal: async (_op, signed) => { if (saved !== null) throw new Error("duplicate seal"); saved = signed; },
  };
  const ports: RelayApprovalPorts = {
    now: () => now, activePolicy: async () => policy(), publicAccount: async () => owner,
    dailyUsage: async () => "0", custody,
    executionAdmission: async operation => ({ requestId: "validated-request-0001",
      operationIntegrityHash: operation.integrityHash, quoteDigest: operation.quoteDigest }),
    sign: async operation => { signs++; const a = operation.quote!.approval;
      return account.signTransaction({ type: "eip1559", chainId: 1, to: a.to as Hex, data: a.data as Hex,
        value: 0n, nonce: 7, gas: BigInt(a.gas), maxFeePerGas: BigInt(a.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(a.maxPriorityFeePerGas), accessList: [] }); },
    send: async () => { sends++; return saved!.transactionHash; },
    observe: async () => { observations++; return observation; },
  };
  const receipt = (hash: Hex, logs: RelayApprovalObservation["receipt"]["logs"]): RelayApprovalObservation => ({
    transaction: { hash, from: owner, to: ETHEREUM_USDC, input: quote.approval.data, chainId: 1 },
    receipt: { transactionHash: hash, status: "success", blockNumber: 10n, blockHash, logs },
    canonicalBlockHash: blockHash,
  });
  const event = (hash: Hex): RelayApprovalObservation["receipt"]["logs"][number] => ({
    address: ETHEREUM_USDC, topics: [topic, word(owner), word(ETHEREUM_DEPOSITORY)],
    data: word(`0x${BigInt(op.amountAtomic).toString(16)}`), transactionHash: hash, blockHash,
  });
  return { state, op, ports, receipt, event, setObservation: (v: RelayApprovalObservation | null) => { observation = v; },
    get counts() { return { signs, sends, observations }; } };
}

test("Relay approval uses the exact saved envelope, sends once, and confirms only the canonical Approval event", async t => {
  const f = await setup(t); const service = new RelayApprovalEffectService(f.state, f.ports);
  let journal = await service.run(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(journal.effects[0].attempt?.attemptNumber, 1);
  assert.deepEqual(f.counts, { signs: 1, sends: 1, observations: 1 });
  const hash = journal.effects[0].attempt!.transactionHash as Hex;
  f.setObservation(f.receipt(hash, [f.event(hash)]));
  journal = await new RelayApprovalEffectService(f.state, f.ports).run(f.op.operationId);
  assert.equal(journal.effects[0].phase, "confirmed");
  assert.equal(journal.effects[1].phase, "pending");
  await service.run(f.op.operationId);
  assert.deepEqual(f.counts, { signs: 1, sends: 1, observations: 2 });
});

test("missing external requestId admission blocks old saved operation before signing", async t => {
  const f = await setup(t);
  const service = new RelayApprovalEffectService(f.state, { ...f.ports, executionAdmission: async () => null });
  await assert.rejects(service.run(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.counts.signs, 0); assert.equal(f.counts.sends, 0);
});

test("retired Relay operation cannot enter approval signing or submission", async t => {
  const f = await setup(t);
  await new RelayRetireService(f.state, { now: () => now }).retire({ profile: "default", operationId: f.op.operationId });
  await assert.rejects(new RelayApprovalEffectService(f.state, f.ports).run(f.op.operationId),
    { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(f.counts, { signs: 0, sends: 0, observations: 0 });
});

test("signer failure and crash before custody seal leave signing marker and never re-sign", async t => {
  const f = await setup(t); let calls = 0;
  const ports = { ...f.ports, sign: async () => { calls++; throw new Error("signer failed"); } };
  const service = new RelayApprovalEffectService(f.state, ports);
  await assert.rejects(service.run(f.op.operationId), /signer failed/);
  const journal = await new RelayEffectJournalRepository(f.state.root).load(f.op.profileHash, f.op.operationId);
  assert.equal(journal!.effects[0].phase, "signing_started");
  await service.run(f.op.operationId);
  assert.equal(calls, 1); assert.equal(f.counts.sends, 0);
});

test("crash after encrypted custody seal recovers the same raw effect for its first send", async t => {
  const f = await setup(t); let crash = true;
  const custody: RelayApprovalCustodyPort = {
    load: f.ports.custody.load,
    seal: async (op, signed) => { await f.ports.custody.seal(op, signed); if (crash) { crash = false; throw new Error("crash after seal"); } },
  };
  await assert.rejects(new RelayApprovalEffectService(f.state, { ...f.ports, custody }).run(f.op.operationId), /crash after seal/);
  assert.equal(f.counts.signs, 1); assert.equal(f.counts.sends, 0);
  const resumed = await new RelayApprovalEffectService(f.state, f.ports).run(f.op.operationId);
  assert.equal(resumed.effects[0].phase, "submitting");
  assert.equal(f.counts.signs, 1); assert.equal(f.counts.sends, 1);
});

test("wrong signed target fails before custody and send", async t => {
  const f = await setup(t);
  const service = new RelayApprovalEffectService(f.state, { ...f.ports,
    sign: async op => { const a = op.quote!.approval;
      return account.signTransaction({ type: "eip1559", chainId: 1, to: ETHEREUM_DEPOSITORY as Hex,
        data: a.data as Hex, value: 0n, nonce: 7, gas: BigInt(a.gas),
        maxFeePerGas: BigInt(a.maxFeePerGas), maxPriorityFeePerGas: BigInt(a.maxPriorityFeePerGas) }); },
  });
  await assert.rejects(service.run(f.op.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(f.counts.sends, 0);
});

test("ambiguous send and replay only observe saved hash", async t => {
  const f = await setup(t);
  const service = new RelayApprovalEffectService(f.state, { ...f.ports, send: async () => { throw new Error("timeout"); } });
  const journal = await service.run(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  await new RelayApprovalEffectService(f.state, f.ports).run(f.op.operationId);
  assert.equal(f.counts.signs, 1); assert.equal(f.counts.sends, 0); assert.equal(f.counts.observations, 2);
});

test("wrong receipt, event, and canonical block fail closed without resending", async t => {
  const f = await setup(t); const service = new RelayApprovalEffectService(f.state, f.ports);
  const journal = await service.run(f.op.operationId); const hash = journal.effects[0].attempt!.transactionHash as Hex;
  for (const wrong of [f.receipt(hash, []),
    { ...f.receipt(hash, [f.event(hash)]), canonicalBlockHash: `0x${"b".repeat(64)}` },
    f.receipt(hash, [{ ...f.event(hash), data: word("0x1") }]),
    { ...f.receipt(hash, [f.event(hash)]), transaction: { ...f.receipt(hash, []).transaction, input: "0x" } }]) {
    f.setObservation(wrong);
    await assert.rejects(service.run(f.op.operationId), { code: "APN_STATE_CORRUPT" });
  }
  assert.equal(f.counts.sends, 1); assert.equal(f.counts.signs, 1);
});
