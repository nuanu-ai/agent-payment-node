import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { relayNativeRoute, relayNativeQuoteRequest, validateRelayNativeQuote, verifySavedRelayNativeQuote,
  RELAY_BASE_SOURCE, RELAY_POLYGON_RECIPIENT, RELAY_BNB_SOURCE, RELAY_BASE_FULL_FEE } from "../../src/relay/native-quote.js";
import { verifyRelayBaseFunding } from "../../src/relay/base-source-guard.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce } from "../../src/relay/native-source.js";
import { proveRelayNativeDestination, type RelayBnbProofPorts } from "../../src/relay/destination-proof.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
const clock = 1791517419;
const raw = async (mega = true): Promise<any> => JSON.parse(await readFile(`tests/core/relay-fixtures/relay-base-${mega ? "mega-usdm" : "polygon-pol"}-quote-20261009.json`, "utf8"));
const intent = (mega = true) => ({ payer: RELAY_BASE_SOURCE, recipient: mega ? RELAY_POLYGON_RECIPIENT : RELAY_BNB_SOURCE,
  amountAtomic: "50000000000000", minimumOutputWei: mega ? "90000000000000000" : "700000000000000000", nowSeconds: clock });
async function op(state: StateStore, mega = true) {
  const quote = await validateRelayNativeQuote(await raw(mega), intent(mega));
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: state.profileHash("evm-live-seller"), operationId: (mega ? "1" : "2").repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 8453, destinationChainId: mega ? 4326 : 137, sourceAccount: quote.payer, recipient: quote.recipient,
    quoteDigest: quote.quoteDigest, nativeQuote: quote, statusLocator: quote.statusLocator!, policyDigest: "5".repeat(64), policyRevision: 1,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: quote.principalAtomic, minOutputAtomic: quote.minimumOutputWei,
    createdAt: new Date(clock * 1000).toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
}
for (const mega of [true, false]) test(`finite Base ${mega ? "USDm" : "POL"} quote verifies official order, signature and exact deposit`, async () => {
  const q = await validateRelayNativeQuote(await raw(mega), intent(mega));
  assert.equal(q.deposit.chainId, 8453); assert.equal(q.deposit.maximumNetworkFeeWei, RELAY_BASE_FULL_FEE.toString());
  assert.equal(q.orderId, (await raw(mega)).protocol.v2.orderId); await verifySavedRelayNativeQuote(q);
  const request = relayNativeQuoteRequest(intent(mega)); assert.equal(request.originChainId, 8453); assert.equal(request.destinationChainId, mega ? 4326 : 137);
  assert.throws(() => relayNativeQuoteRequest({ ...intent(mega), amountAtomic: "50000000000001" }));
  assert.throws(() => relayNativeQuoteRequest({ ...intent(mega), minimumOutputWei: "1" }));
  const edits: Array<(q: any) => void> = [q => { q.steps[0].items[0].data.chainId = 56; }, q => { q.steps[0].items[0].data.value = "1"; },
    q => { q.protocol.v2.orderData.output.calls = [{}]; }, q => { q.protocol.v2.orderData.inputs[0].refunds[1].currency = RELAY_BASE_SOURCE; },
    q => { q.protocol.v2.orderData.output.payments[0].minimumAmount = "1"; }, q => { q.protocol.v2.orderData.inputs[0].refunds[1].recipient = RELAY_BASE_SOURCE; },
    q => { q.protocol.v2.orderSignature = `0x${"11".repeat(65)}`; }, q => { q.steps[0].items[0].data.data += "00"; },
    q => { q.details.currencyOut.currency.chainId = mega ? 137 : 4326; }, q => { q.steps[0].items[0].data.maxFeePerGas = "100000000000"; }];
  for (const edit of edits) { const bad = await raw(mega); edit(bad); await assert.rejects(validateRelayNativeQuote(bad, intent(mega))); }
  await assert.rejects(validateRelayNativeQuote(await raw(!mega), intent(mega)));
  const changed = { ...q, deposit: { ...q.deposit, maximumNetworkFeeWei: "2" } }; const { quoteDigest: _, ...projection } = changed;
  await assert.rejects(verifySavedRelayNativeQuote({ ...changed, quoteDigest: hashObject(projection) }));
});
function active(mega = true) {
  const r = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "relay-base-finite.test.1",
    publishedAt: "2026-10-09T00:00:00.000Z", effectiveDate: "2026-10-09", effectiveAt: "2026-10-09T00:00:00.000Z", expiresAt: "2026-10-17T00:00:00.000Z",
    chains: [{ chain: "eip155:8453", family: "evm", name: "Base", assets: [{ kind: "native", identifier: null, symbol: "ETH", decimals: 18,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false }, railCaps: { bridge: { maximumPerTransferAtomic: "50000000000000", dailyLimitAtomic: "100000000000000" } },
      mechanismOptions: { bridge: [true, false].map(m => ({ provider: "relay", maximumPerTransferAtomic: "50000000000000", reference: relayNativeRoute(RELAY_BASE_SOURCE, intent(m).recipient).reference })) } }] }] });
  return { profile: "evm-live-seller", registry: r, digest: r.policyDigest, revision: 1, accounts: { evm: RELAY_BASE_SOURCE }, activationDigest: "a".repeat(64), activatedAt: new Date(clock * 1000).toISOString() };
}
test("normal CLI prepare uses seller Base policy alternatives, saves durable quote, replays and rejects cross-lane key", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const state = new StateStore(tmp.root); let calls = 0;
  const input = { profile: "evm-live-seller", recipient: intent().recipient, amountAtomic: intent().amountAtomic, minOutputAtomic: intent().minimumOutputWei,
    maxDepositNetworkFeeWei: "1000000000000", idempotencyKey: "relay-base-mega-0001" };
  const bound = bindArgv(["relay", "native", "prepare", "--profile", input.profile, "--recipient", input.recipient, "--amount-atomic", input.amountAtomic,
    "--min-output-atomic", input.minOutputAtomic, "--max-deposit-network-fee-wei", input.maxDepositNetworkFeeWei, "--idempotency-key", input.idempotencyKey]);
  assert.deepEqual(bound.request, { command: "relay.native.prepare", ...input });
  const service = new RelayUnsignedPrepareService(state, { now: () => new Date(clock * 1000) }, undefined, {
    activePolicy: async () => active(), publicAccount: async () => RELAY_BASE_SOURCE, dailyUsage: async () => "0",
    nativeQuote: async i => { calls++; return validateRelayNativeQuote(await raw(), i); } });
  const first = await service.prepareNative(input); assert.equal(first.sourceChainId, 8453); assert.equal(first.destinationChainId, 4326);
  assert.equal(first.state, "prepared"); assert.deepEqual(await service.prepareNative(input), first); assert.equal(calls, 1);
  await assert.rejects(service.prepareNative({ ...input, recipient: intent(false).recipient, minOutputAtomic: intent(false).minimumOutputWei }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.prepareNative({ ...input, idempotencyKey: "relay-base-mega-0002", maxDepositNetworkFeeWei: "1000000000001" }), { code: "APN_INVALID_INPUT" });
  assert.equal(calls, 1);
});
test("Base runtime pin, gas estimate and OP Stack L1/operator fee enforce full budget", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const saved = await op(new StateStore(tmp.root));
  const code = JSON.parse(await readFile("tests/core/relay-fixtures/base-depository-runtime-20261009.json", "utf8")).code;
  const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
  const rpc = (rows: unknown[]) => ({ batchCall: async (calls: readonly unknown[]) => { assert.equal(calls.length, 4); return rows; } });
  await verifyRelayBaseFunding(saved, rpc([code, "0x7fc9", word(1000n), word(1000n)]), "0x1");
  for (const rows of [["0x", "0x7fc9", word(0n), word(0n)], [code, "0xffff", word(0n), word(0n)], [code, "0x7fc9", word(1000000000000n), word(0n)]])
    await assert.rejects(verifyRelayBaseFunding(saved, rpc(rows), "0x1"), { code: "APN_OPERATION_BLOCKED" });
});
test("Base durable dispatch marker prevents ambiguous retry and wrong raw transaction", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const state = new StateStore(tmp.root), saved = await op(state);
  await new RelayUnsignedOperationRepository(tmp.root).persistLocked(saved); const store = new RelayNativeSourceJournalRepository(tmp.root);
  let j = await store.advance(saved, null, "pending"); j = await store.advance(saved, j.integrityHash, "signing_started");
  const bytes = "0x0102" as Hex; j = await store.advance(saved, j.integrityHash, "sealed", keccak256(bytes)); let sends = 0;
  await assert.rejects(dispatchRelayNativeDepositOnce(saved, j, store, async () => "", "0x0201", new Date()));
  const sent = await dispatchRelayNativeDepositOnce(saved, j, store, async () => { sends++; throw new Error("ambiguous"); }, bytes, new Date());
  assert.equal(sent.phase, "submitting"); assert.deepEqual(await dispatchRelayNativeDepositOnce(saved, sent, store, async () => { sends++; return ""; }, bytes, new Date()), sent);
  assert.equal(sends, 1);
});
test("Mega USDm proof needs pinned token runtime, canonical finality, exact transfer and adjacent balance", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const saved = await op(new StateStore(tmp.root));
  const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`, amount = BigInt(saved.minOutputAtomic);
  let changed = false, low = false;
  const ports: RelayBnbProofPorts = { chainId: async () => 4326,
    transaction: async () => ({ hash, chainId: 4326, to: RELAY_BASE_SOURCE, valueWei: 0n, blockNumber: 100n, blockHash }),
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash, logs: [{ address: "0xfafddbb3fc7688494971a79cc65dca3ef82079e7",
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(64)}`, `0x${saved.recipient.slice(2).padStart(64, "0")}`], data: `0x${(low ? 1n : amount).toString(16).padStart(64, "0")}` }] }),
    block: async number => ({ number, hash: blockHash }), finalityCheckpoint: async () => ({ number: 101n, hash: blockHash }), nativeTrace: async () => null,
    tokenIdentityAndBalances: async () => ({ proxyHash: changed ? hash : "0xfdf85d183a122fe611bc878683b722b2b22633e13900c4b13767742b9f5f5a90",
      implementation: "0xAC37677261885fDB372A37Ac8D5d47044196073C", implementationHash: "0x781c9c39ab69e9b7d099ec75e5a28df41dc891c8fffbe0148c94ed5adc8b0c09", before: 0n, after: amount }) };
  const proof = await proveRelayNativeDestination(saved, hash, [hash], ports); assert.equal(proof.status, "recipient_credit_proven"); assert.equal(proof.relayOrderFulfillmentProven, false);
  changed = true; assert.equal((await proveRelayNativeDestination(saved, hash, [hash], ports)).status, "mismatch");
  changed = false; low = true; assert.equal((await proveRelayNativeDestination(saved, hash, [hash], ports)).status, "mismatch");
});
test("Base funding rechecks chain, balance plus full fee, nonce and pinned block before sign", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const state = new StateStore(tmp.root), saved = await op(state);
  const { RelayNativeSourceRuntime } = await import("../../src/relay/native-source.js");
  const runtime = new RelayNativeSourceRuntime(state, { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) },
    { confirm: async () => true, rpc: { batchCall: async () => [], submitRawTransaction: async () => "0x00" as Hex } });
  const code = JSON.parse(await readFile("tests/core/relay-fixtures/base-depository-runtime-20261009.json", "utf8")).code;
  const hash = `0x${"b".repeat(64)}`, word = `0x${"0".repeat(64)}`;
  function rpc(balance = 51000000000000n, drift = false) {
    let n = 0;
    return { batchCall: async () => {
      n++; if (n === 1) return ["0x2105", { number: "0x1", hash }];
      if (n === 2) return [{ number: "0x1", hash }, `0x${balance.toString(16)}`, "0x1", "0x100000", "0x2105"];
      if (n === 3) return [code, "0x7fc9", word, word];
      return [{ number: "0x1", hash: drift ? `0x${"c".repeat(64)}` : hash }];
    }, submitRawTransaction: async () => { throw new Error("no send in funding"); } };
  }
  assert.equal(await (runtime as any).funding(saved, rpc()), 1n);
  await assert.rejects((runtime as any).funding(saved, rpc(50999999999999n)), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects((runtime as any).funding(saved, rpc(51000000000000n, true)), { code: "APN_OPERATION_BLOCKED" });
});
for (const mega of [true, false]) test(`Base ${mega ? "USDm" : "POL"} unsigned crash closes native usage and permits exact seller retirement`, async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup); const state = new StateStore(tmp.root);
  const { AssetUsageLedger, assetUsageReservationId } = await import("../../src/asset-usage-ledger.js");
  const { RelayNativeSourceRuntime } = await import("../../src/relay/native-source.js");
  const { RelayRetireService } = await import("../../src/relay/retire.js");
  const original = await op(state, mega), { integrityHash: _, ...fields } = original;
  const saved = freezeRelayUnsignedOperation({ ...fields, policyDigest: active().digest });
  await new RelayUnsignedOperationRepository(tmp.root).persistLocked(saved);
  const profile = "evm-live-seller", now = new Date(clock * 1000), walletFields = { schemaVersion: "apn.state.v1" as const,
    profile, profileHash: saved.profileHash, address: RELAY_BASE_SOURCE as Hex, createdAt: now.toISOString(),
    bindingHash: hashObject({ profile, address: RELAY_BASE_SOURCE, createdAt: now.toISOString() }) };
  await state.writeNewWallet({ ...walletFields, integrityHash: hashObject(walletFields) });
  const identity = { account: RELAY_BASE_SOURCE, chain: "eip155:8453", asset: { kind: "native" as const, identifier: null } };
  const ledger = new AssetUsageLedger(tmp.root), key = `relay-native-execute:${saved.operationId}`, reservationId = assetUsageReservationId(identity, key);
  await ledger.reserve({ ...identity, registry: active().registry, rail: "bridge", mechanism: { provider: "relay", reference: saved.nativeQuote!.routeReference },
    amountAtomic: saved.amountAtomic, idempotencyKey: key, now });
  const journals = new RelayNativeSourceJournalRepository(tmp.root); let j = await journals.advance(saved, null, "pending", null, now);
  j = await journals.advance(saved, j.integrityHash, "signing_started", null, now);
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const runtime = new RelayNativeSourceRuntime(state, wrapping, { confirm: async () => true, rpc: {
    batchCall: async () => { throw new Error("no RPC after unsigned crash"); }, submitRawTransaction: async () => { throw new Error("no send after unsigned crash"); } } }, { now: () => now });
  Object.assign(runtime, { wallets: { describe: async () => ({ identity: { address: RELAY_BASE_SOURCE }, secret: { directEffects: {} } }), clear: () => {} } });
  assert.equal((await runtime.execute(saved.operationId)).phase, "failed_before_effect");
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal((await runtime.execute(saved.operationId)).phase, "failed_before_effect");
  assert.equal((await new RelayRetireService(state, { now: () => now }, wrapping).retire({ profile, operationId: saved.operationId })).state, "retired");
});
