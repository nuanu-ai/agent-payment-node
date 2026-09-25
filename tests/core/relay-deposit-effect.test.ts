import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RelayDepositEffectService, RelayEncryptedDepositCustody, type RelayDepositObservation, type RelayDepositPorts,
  type RelaySignedDeposit } from "../../src/relay/deposit-effect.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const owner = account.address.toLowerCase();
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const now = new Date("2026-09-30T00:00:00.000Z");
const blockHash = `0x${"a".repeat(64)}`;
const requestId = `0x${"b".repeat(64)}`;
const approvalHash = `0x${"c".repeat(64)}` as Hex;
const word = (hex: string) => `0x${hex.slice(2).padStart(64, "0")}`;
const approvalTopic = keccak256(toBytes("Approval(address,address,uint256)"));
const depositAbi = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
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
async function setup(t: { after: (fn: () => Promise<void>) => void }, createApproval = true) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const fixture = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quoted = await validateRelayQuote(fixture, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, ...body } = quoted;
  const locator = relayStatusLocator(requestId);
  const data = encodeFunctionData({ abi: depositAbi, functionName: "depositErc20",
    args: [owner as Hex, ETHEREUM_USDC as Hex, 2500000n, quoted.orderId as Hex] });
  const modified = { ...body, statusLocator: locator, payer: owner, sourceRefundRecipient: owner,
    approval: { ...quoted.approval, from: owner }, deposit: { ...quoted.deposit, from: owner, data } };
  const quote = { ...modified, quoteDigest: hashObject(modified) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("default"), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: owner, recipient, quoteDigest: quote.quoteDigest, quote, statusLocator: locator,
    policyDigest: policy().digest, policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
  const repo = new RelayUnsignedOperationRepository(temp.root); await repo.initialize(); await repo.persistLocked(op);
  const effects = new RelayEffectJournalRepository(temp.root);
  if (createApproval) {
    let journal = await effects.create(op.profileHash, op.operationId, now.toISOString());
    for (const event of [
    { kind: "mark_signing", role: "approval", marker: "d".repeat(64), at: now.toISOString() },
    { kind: "seal_signed", role: "approval", transactionHash: approvalHash },
    { kind: "mark_submitting", role: "approval", at: now.toISOString() },
    { kind: "observe", role: "approval", outcome: "confirmed", at: now.toISOString() },
    ] as const) journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash, event);
  }
  let signed: RelaySignedDeposit | null = null;
  let observed: RelayDepositObservation | null = null;
  let signs = 0, sends = 0, observations = 0;
  const ports: RelayDepositPorts = {
    now: () => now, activePolicy: async () => policy(), publicAccount: async () => owner,
    dailyUsage: async () => "0", executionAdmission: async operation => ({ requestId,
      operationIntegrityHash: operation.integrityHash, quoteDigest: operation.quoteDigest }),
    funding: async () => ({ chainId: 1, nativeBalanceWei: 10n ** 18n,
      tokenBalanceAtomic: 2500000n, allowanceAtomic: 2500000n, currentMaxFeePerGasWei: 1n, nextNonce: 8n }),
    observeApproval: async () => ({ transaction: { hash: approvalHash, from: owner,
      to: ETHEREUM_USDC, input: quote.approval.data, chainId: 1 }, receipt: {
        transactionHash: approvalHash, status: "success", blockNumber: 10n, blockHash,
        logs: [{ address: ETHEREUM_USDC, topics: [approvalTopic, word(owner), word(ETHEREUM_DEPOSITORY)],
          data: word(`0x${BigInt(op.amountAtomic).toString(16)}`), transactionHash: approvalHash, blockHash }] },
      canonicalBlockHash: blockHash }),
    sign: async operation => { signs++; const d = operation.quote!.deposit;
      return account.signTransaction({ type: "eip1559", chainId: 1, to: d.to as Hex, data: d.data as Hex,
        value: 0n, nonce: 8, gas: BigInt(d.gas), maxFeePerGas: BigInt(d.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(d.maxPriorityFeePerGas), accessList: [] }); },
    custody: { load: async () => signed, seal: async (_op, value) => { if (signed) throw new Error("duplicate seal"); signed = value; } },
    send: async () => { sends++; return signed!.transactionHash; },
    observe: async () => { observations++; return observed; },
  };
  const receipt = (hash: Hex): RelayDepositObservation => ({ transaction: { hash, from: owner,
    to: ETHEREUM_DEPOSITORY, input: quote.deposit.data, value: 0n, chainId: 1 },
    receipt: { transactionHash: hash, status: "success", blockNumber: 11n, blockHash }, canonicalBlockHash: blockHash });
  return { state, op, ports, receipt, setObservation: (v: RelayDepositObservation | null) => { observed = v; },
    get counts() { return { signs, sends, observations }; } };
}

test("exact saved deposit signs and sends once; canonical source receipt confirms only deposit", async t => {
  const f = await setup(t); const service = new RelayDepositEffectService(f.state, f.ports);
  let journal = await service.run(f.op.operationId);
  assert.equal(journal.effects[1].phase, "submitting"); assert.equal(journal.effects[1].attempt?.attemptNumber, 1);
  assert.deepEqual(f.counts, { signs: 1, sends: 1, observations: 1 });
  f.setObservation(f.receipt(journal.effects[1].attempt!.transactionHash as Hex));
  journal = await service.run(f.op.operationId);
  assert.equal(journal.effects[1].phase, "confirmed"); assert.equal(journal.effects[0].phase, "confirmed");
  await service.run(f.op.operationId);
  assert.deepEqual(f.counts, { signs: 1, sends: 1, observations: 2 });
});

test("saved request admission, approval receipt, and allowance are required before signing", async t => {
  const f = await setup(t);
  const variants: RelayDepositPorts[] = [
    { ...f.ports, executionAdmission: async () => null },
    { ...f.ports, observeApproval: async () => null },
    { ...f.ports, funding: async () => ({ chainId: 1, nativeBalanceWei: 10n ** 18n,
      tokenBalanceAtomic: 2500000n, allowanceAtomic: 0n, currentMaxFeePerGasWei: 1n, nextNonce: 8n }) },
  ];
  for (const ports of variants) await assert.rejects(new RelayDepositEffectService(f.state, ports).run(f.op.operationId),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.counts.signs, 0); assert.equal(f.counts.sends, 0);
});

test("ambiguous send and replay never sign or send again", async t => {
  const f = await setup(t);
  const journal = await new RelayDepositEffectService(f.state, { ...f.ports,
    send: async () => { throw new Error("timeout"); } }).run(f.op.operationId);
  assert.equal(journal.effects[1].phase, "submitting");
  await new RelayDepositEffectService(f.state, f.ports).run(f.op.operationId);
  assert.deepEqual(f.counts, { signs: 1, sends: 0, observations: 2 });
});

test("signed nonce mismatch fails before the first send", async t => {
  const f = await setup(t);
  const wrongNonce = new RelayDepositEffectService(f.state, { ...f.ports,
    funding: async () => ({ chainId: 1, nativeBalanceWei: 10n ** 18n,
      tokenBalanceAtomic: 2500000n, allowanceAtomic: 2500000n,
      currentMaxFeePerGasWei: 1n, nextNonce: 9n }) });
  await assert.rejects(wrongNonce.run(f.op.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(f.counts.sends, 0);
});

test("receipt hash, chain, order calldata, and canonical block are bound", async t => {
  const f = await setup(t); const service = new RelayDepositEffectService(f.state, f.ports);
  const journal = await service.run(f.op.operationId);
  const hash = journal.effects[1].attempt!.transactionHash as Hex;
  const receipt = f.receipt(hash);
  for (const bad of [
    { ...receipt, transaction: { ...receipt.transaction, hash: approvalHash } },
    { ...receipt, transaction: { ...receipt.transaction, chainId: 56 } },
    { ...receipt, transaction: { ...receipt.transaction, input: "0x" } },
    { ...receipt, canonicalBlockHash: `0x${"e".repeat(64)}` },
  ]) {
    f.setObservation(bad);
    await assert.rejects(service.run(f.op.operationId), { code: "APN_STATE_CORRUPT" });
  }
  assert.equal(f.counts.sends, 1);
});

test("expired saved quote and changed policy refuse deposit", async t => {
  const f = await setup(t);
  await assert.rejects(new RelayDepositEffectService(f.state, { ...f.ports,
    now: () => new Date(f.op.deadline) }).run(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new RelayDepositEffectService(f.state, { ...f.ports,
    activePolicy: async () => null }).run(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.counts.signs, 0);
});

test("retired operation refuses deposit without signing", async t => {
  const f = await setup(t, false);
  await new RelayRetireService(f.state, { now: () => now }).retire({ profile: "default", operationId: f.op.operationId });
  await assert.rejects(new RelayDepositEffectService(f.state, f.ports).run(f.op.operationId),
    { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(f.counts, { signs: 0, sends: 0, observations: 0 });
});

test("missing approval effect refuses deposit without signing", async t => {
  const f = await setup(t, false);
  await assert.rejects(new RelayDepositEffectService(f.state, f.ports).run(f.op.operationId),
    { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(f.counts, { signs: 0, sends: 0, observations: 0 });
});

test("crash after custody seal resumes the same transaction without a second signature", async t => {
  const f = await setup(t);
  let crash = true;
  const custody = { load: f.ports.custody.load,
    seal: async (op: Parameters<typeof f.ports.custody.seal>[0], signed: RelaySignedDeposit) => {
      await f.ports.custody.seal(op, signed);
      if (crash) { crash = false; throw new Error("crash after seal"); }
    } };
  await assert.rejects(new RelayDepositEffectService(f.state, { ...f.ports, custody }).run(f.op.operationId),
    /crash after seal/);
  assert.deepEqual(f.counts, { signs: 1, sends: 0, observations: 0 });
  const journal = await new RelayDepositEffectService(f.state, f.ports).run(f.op.operationId);
  assert.equal(journal.effects[1].phase, "submitting");
  assert.deepEqual(f.counts, { signs: 1, sends: 1, observations: 1 });
});

test("encrypted deposit custody survives restart and rejects a changed binding", async t => {
  const f = await setup(t);
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const wallets = new EncryptedWalletStore(f.state, wrapping);
  const key = `0x${"1".repeat(64)}` as Hex;
  await wallets.importNew("default", key, account.address);
  const rawTransaction = await f.ports.sign(f.op);
  const signed = { rawTransaction, transactionHash: keccak256(rawTransaction) };
  await new RelayEncryptedDepositCustody(f.state, wrapping).seal(f.op, signed);
  assert.deepEqual(await new RelayEncryptedDepositCustody(f.state, wrapping).load(f.op), signed);
  await assert.rejects(new RelayEncryptedDepositCustody(f.state, wrapping).seal(f.op, signed),
    { code: "APN_OPERATION_BLOCKED" });
  const changed = { ...f.op, quoteDigest: "f".repeat(64) };
  await assert.rejects(new RelayEncryptedDepositCustody(f.state, wrapping).load(changed),
    { code: "APN_STATE_CORRUPT" });
});
