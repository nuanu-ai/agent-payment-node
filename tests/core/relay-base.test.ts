import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { proveRelayBaseDestination, type RelayBnbProofPorts } from "../../src/relay/destination-proof.js";
import { RelayBaseObserveService } from "../../src/relay/base-observe.js";
import { RelayBnbReadOnlyRpc } from "../../src/relay/observe-rpc.js";
import type { HttpsBaseRpc } from "../../src/rpc.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { ETHEREUM_DEPOSITORY } from "../../src/relay/quote.js";
import { relayQuoteRequest, validateRelayQuote } from "../../src/relay/quote.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { freezeRelayUnsignedOperation, publicRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const intent = { payer, recipient, amountAtomic: "2500000", minimumOutputWei: "891439003839815",
  nowSeconds: 1790800000, destinationChainId: 8453 as const };
const fixture = async (): Promise<any> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));

test("Base request pins Ethereum USDC, native Base ETH, amount and recipient", () => {
  const request = relayQuoteRequest(intent);
  assert.equal(request.originChainId, 1); assert.equal(request.destinationChainId, 8453);
  assert.equal(request.originCurrency, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(request.destinationCurrency, "0x0000000000000000000000000000000000000000");
  assert.equal(request.amount, "2500000"); assert.equal(request.recipient, recipient);
  assert.equal(request.usePermit, false); assert.equal(request.useDepositAddress, false);
  assert.equal(bindArgv(["relay", "base", "prepare", "--profile", "default", "--recipient", recipient,
    "--amount-atomic", "2500000", "--min-output-atomic", "891439003839815",
    "--max-approval-network-fee-wei", "100000000000000", "--max-deposit-network-fee-wei", "100000000000000",
    "--idempotency-key", "relay-base-test-01"]).request.command, "relay.base.prepare");
  assert.equal(bindArgv(["relay", "base", "observe", "--operation", "a".repeat(64),
    "--rpc-url", "https://base.example", "--ethereum-rpc-url", "https://ethereum.example"]).ethereumRpcUrl,
  "https://ethereum.example");
});

test("BNB quote and route mismatches cannot validate as Base", async () => {
  const raw = await fixture();
  await assert.rejects(validateRelayQuote(raw, intent), /order identity/);
  raw.protocol.v2.orderData.output.chainId = "base";
  raw.protocol.v2.orderData.inputs[0].refunds[1].chainId = "base";
  raw.details.currencyOut.currency.chainId = 8453;
  await assert.rejects(validateRelayQuote(raw, intent), /order id/);
  raw.protocol.v2.paymentDetails.depository = recipient;
  await assert.rejects(validateRelayQuote(raw, intent));
});

test("saved Base quote hides provider locator and cannot turn a candidate into paid acceptance", async () => {
  const old = await validateRelayQuote(await fixture(), { ...intent, destinationChainId: 56,
    minimumOutputWei: "3000000000000000" });
  const { quoteDigest: _oldDigest, ...fields } = old;
  const quoteFields = { ...fields, routeReference: "ethereum-usdc-base-eth-v1" as const,
    orderData: { ...fields.orderData, inputs: [{ ...fields.orderData.inputs[0]!, refunds: [
      fields.orderData.inputs[0]!.refunds[0]!, { ...fields.orderData.inputs[0]!.refunds[1]!, chainId: "base" as const } ] }],
      output: { ...fields.orderData.output, chainId: "base" as const } } };
  const quote = { ...quoteFields, quoteDigest: hashObject(quoteFields) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 8453,
    sourceAccount: payer.toLowerCase(), recipient: recipient.toLowerCase(), quoteDigest: quote.quoteDigest, quote,
    ...(quote.statusLocator === undefined ? {} : { statusLocator: quote.statusLocator }), policyDigest: "5".repeat(64),
    policyRevision: 1, approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "2500000",
    minOutputAtomic: quote.minimumOutputWei, createdAt: "2026-09-30T00:00:00.000Z",
    deadline: new Date(quote.deadline * 1000).toISOString() });
  const publicView = publicRelayUnsignedOperation(op);
  assert.equal("statusLocator" in publicView, false);
  assert.equal("statusLocator" in publicView.quote!, false);
  const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`, safeHash = `0x${"c".repeat(64)}`;
  const ports: RelayBnbProofPorts = { chainId: async () => 8453,
    transaction: async () => ({ hash, chainId: 8453, to: recipient, valueWei: BigInt(op.minOutputAtomic),
      blockNumber: 100n, blockHash }),
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash }),
    block: async number => ({ number, hash: number === 100n ? blockHash : safeHash }),
    finalityCheckpoint: async () => ({ number: 101n, hash: safeHash }), nativeTrace: async () => null };
  const proof = await proveRelayBaseDestination(op, [hash], ports);
  assert.equal(proof.status, "recipient_credit_proven"); assert.equal(proof.paidAcceptance, false);
  assert.equal(proof.relayOrderFulfillmentProven, false);
  if (proof.status === "recipient_credit_proven") assert.equal(proof.proof.sourceDepositHash, null);
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...ports, chainId: async () => 56 })).status, "mismatch");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...ports, transaction: async () => ({
    hash, chainId: 8453, to: payer, valueWei: BigInt(op.minOutputAtomic), blockNumber: 100n, blockHash }) })).status, "unproven");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...ports, transaction: async () => ({
    hash, chainId: 8453, to: recipient, valueWei: 1n, blockNumber: 100n, blockHash }) })).status, "mismatch");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...ports,
    finalityCheckpoint: async () => ({ number: 99n, hash: safeHash }) })).status, "pending");
  const router = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
  const codeHash = "0xde894e5c12e9513d50613c8fff375ecbf19b5d9a53bec0662e2b9667e3ec8f15";
  const topic = "0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6";
  const amount = BigInt(op.minOutputAtomic);
  const event = { address: router, topics: [topic],
    data: `0x${op.recipient.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` };
  const contract: RelayBnbProofPorts = { ...ports,
    transaction: async () => ({ hash, chainId: 8453, to: router, valueWei: amount,
      blockNumber: 100n, blockHash }),
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash, logs: [event] }),
    routerCodeHash: async () => codeHash,
    adjacentBalances: async () => [100n, 100n + amount],
  };
  const credited = await proveRelayBaseDestination(op, [hash], contract);
  assert.equal(credited.status, "recipient_credit_proven");
  assert.equal(credited.paidAcceptance, false);
  assert.equal(credited.relayOrderFulfillmentProven, false);
  if (credited.status === "recipient_credit_proven") {
    assert.equal(credited.proof.method, "verified_relay_router_event_balance");
    assert.equal(credited.proof.creditedWei, amount.toString());
  }
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash,
      logs: [{ ...event, address: recipient }] }) })).status, "unproven");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash,
      logs: [{ ...event, data: `0x${op.recipient.slice(2).padStart(64, "0")}${(amount + 1n).toString(16).padStart(64, "0")}` }] }) })).status, "unproven");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    adjacentBalances: async () => [100n, 101n + amount] })).status, "unproven");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    routerCodeHash: async () => safeHash })).status, "mismatch");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    finalityCheckpoint: async () => ({ number: 99n, hash: safeHash }) })).status, "pending");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    block: async number => ({ number, hash: number === 100n ? safeHash : blockHash }) })).status, "mismatch");
  assert.equal((await proveRelayBaseDestination(op, [hash], { ...contract,
    nativeTrace: async () => ({ transactionHash: hash, blockHash, complete: true,
      revertedCallsExcluded: true, transfers: [] }) })).status, "unproven");
});

test("Base observe reads one provider candidate and never promotes credit to paid acceptance", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const old = await validateRelayQuote(await fixture(), { ...intent, destinationChainId: 56,
    minimumOutputWei: "3000000000000000" });
  const { quoteDigest: _discard, ...fields } = old;
  const requestId = `0x${"d".repeat(64)}`;
  const locator = { requestId, endpoint: `https://api.relay.link/intents/status/v3?requestId=${requestId}` };
  const quoteFields = { ...fields, routeReference: "ethereum-usdc-base-eth-v1" as const, statusLocator: locator,
    orderData: { ...fields.orderData, inputs: [{ ...fields.orderData.inputs[0]!, refunds: [
      fields.orderData.inputs[0]!.refunds[0]!, { ...fields.orderData.inputs[0]!.refunds[1]!, chainId: "base" as const } ] }],
      output: { ...fields.orderData.output, chainId: "base" as const } } };
  const quote = { ...quoteFields, quoteDigest: hashObject(quoteFields) };
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.1", publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29",
    effectiveAt: "2026-09-29T00:00:00.000Z", expiresAt: "2026-10-02T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: "ethereum-usdc-base-eth-v1" } } }] }] });
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 8453,
    sourceAccount: payer.toLowerCase(), recipient: recipient.toLowerCase(), quoteDigest: quote.quoteDigest, quote,
    statusLocator: locator, policyDigest: registry.policyDigest, policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "2500000",
    minOutputAtomic: quote.minimumOutputWei, createdAt: "2026-09-30T00:00:00.000Z",
    deadline: new Date(quote.deadline * 1000).toISOString() });
  await new RelayUnsignedOperationRepository(temporary.root).persistLocked(op);
  const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`, safeHash = `0x${"c".repeat(64)}`;
  let rpcCalls = 0, statusCalls = 0;
  const ports: RelayBnbProofPorts = { chainId: async () => { rpcCalls++; return 8453; },
    transaction: async () => ({ hash, chainId: 8453, to: recipient, valueWei: BigInt(op.minOutputAtomic), blockNumber: 100n, blockHash }),
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash }),
    block: async number => ({ number, hash: number === 100n ? blockHash : safeHash }),
    finalityCheckpoint: async () => ({ number: 101n, hash: safeHash }), nativeTrace: async () => null };
  const fetcher = (async () => { statusCalls++; return new Response(JSON.stringify({ status: "success", originChainId: 1,
    destinationChainId: 8453, txHashes: [hash] }), { status: 200 }); }) as typeof fetch;
  const service = new RelayBaseObserveService(state, () => ports, new RelayKeylessStatusService(state, fetcher));
  const observed = await service.observe(op.operationId);
  assert.equal(observed.state, "recipient_credit_observed");
  assert.equal(observed.destinationProof?.status, "recipient_credit_proven");
  assert.equal(observed.paidAcceptance, false); assert.equal(observed.sourceFinalized, false);
  assert.equal(observed.sourceObservationReason, "source_effect_not_recorded");
  assert.equal(observed.operationalAcceptance, false);
  assert.equal(statusCalls, 1); assert.equal(rpcCalls, 1);
  const routedService = new RelayBaseObserveService(state, () => ({ ...ports }),
    new RelayKeylessStatusService(state, fetcher));
  const core = createApnCore(bindArgv(["relay", "base", "observe", "--operation", op.operationId,
    "--rpc-url", "https://base.example"]), { stateRoot: temporary.root, relayBaseObserve: routedService });
  const routed = await core.execute({ command: "relay.base.observe", operationId: op.operationId });
  assert.equal(routed.ok, true, JSON.stringify(routed));
  assert.equal(core.context.relayBaseObserve, routedService);
  const effects = new RelayEffectJournalRepository(temporary.root);
  let journal = await effects.create(op.profileHash, op.operationId, "2026-09-30T00:00:00.000Z");
  const sourceHash = `0x${"e".repeat(64)}`;
  for (const [role, transactionHash] of [["approval", `0x${"f".repeat(64)}`], ["deposit", sourceHash]] as const) {
    journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
      { kind: "mark_signing", role, marker: "a".repeat(64), at: "2026-09-30T00:00:01.000Z" });
    journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
      { kind: "seal_signed", role, transactionHash });
    journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
      { kind: "mark_submitting", role, at: "2026-09-30T00:00:01.000Z" });
    if (role === "approval") journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
      { kind: "observe", role, outcome: "confirmed", at: "2026-09-30T00:00:02.000Z" });
  }
  const boundFetcher = (async () => new Response(JSON.stringify({ status: "success", originChainId: 1,
    destinationChainId: 8453, inTxHashes: [sourceHash], txHashes: [hash] }), { status: 200 })) as typeof fetch;
  const finalized = { finalizedDeposit: async () => ({
    transaction: { hash: sourceHash, from: op.sourceAccount, to: ETHEREUM_DEPOSITORY,
      input: op.quote!.deposit.data, value: 0n, chainId: 1 },
    receipt: { transactionHash: sourceHash, status: "success" as const, blockNumber: 90n, blockHash },
    canonicalBlockHash: blockHash,
  }) };
  const usage = new AssetUsageLedger(temporary.root);
  const identity = { account: payer, chain: "eip155:1", asset: { kind: "token" as const,
    identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } };
  const reservationId = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
  await usage.reserve({ ...identity, registry, rail: "bridge", amountAtomic: op.amountAtomic,
    idempotencyKey: `relay-execute:${op.operationId}`, now: new Date("2026-09-30T00:00:00.000Z") });
  await usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "submitted",
    now: new Date("2026-09-30T00:00:01.000Z") });
  const router = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
  const amount = BigInt(op.minOutputAtomic);
  const fallbackPorts: RelayBnbProofPorts = { ...ports,
    transaction: async () => ({ hash, chainId: 8453, to: router, valueWei: amount,
      blockNumber: 100n, blockHash }),
    receipt: async () => ({ transactionHash: hash, status: "success", blockNumber: 100n, blockHash,
      logs: [{ address: router,
        topics: ["0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6"],
        data: `0x${op.recipient.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` }] }),
    routerCodeHash: async () => "0xde894e5c12e9513d50613c8fff375ecbf19b5d9a53bec0662e2b9667e3ec8f15",
    adjacentBalances: async () => [100n, 100n + amount],
  };
  const operationalService = new RelayBaseObserveService(state, () => ({ ...fallbackPorts }),
    new RelayKeylessStatusService(state, boundFetcher), finalized, usage);
  const operational = await operationalService.observe(op.operationId);
  assert.equal(operational.state, "operational_acceptance");
  assert.equal(operational.sourceFinalized, true);
  assert.equal(operational.sourceObservationReason, "source_finalized");
  assert.equal(operational.providerStatusBound, true);
  assert.equal(operational.sourceUsageFinalized, true);
  assert.equal(operational.sourceDepositHash, sourceHash);
  assert.equal(operational.paidAcceptance, false);
  assert.equal(operational.causalLinkCryptographicallyProven, false);
  const confirmedJournal = await effects.load(op.profileHash, op.operationId);
  const finalizedUsage = await usage.load(identity, reservationId);
  assert.equal(confirmedJournal?.effects[1].phase, "confirmed");
  assert.equal(finalizedUsage?.state, "finalized");
  assert.equal(finalizedUsage?.outcomeDigest, confirmedJournal?.integrityHash);
  assert.equal((await operationalService.observe(op.operationId)).state, "operational_acceptance");
  assert.equal((await effects.load(op.profileHash, op.operationId))?.integrityHash, confirmedJournal?.integrityHash);
  assert.equal((await usage.load(identity, reservationId))?.reservationDigest, finalizedUsage?.reservationDigest);
  const finalizedObservation = await finalized.finalizedDeposit();
  for (const [source, expectedReason] of [
    [{ finalizedDeposit: async () => { throw new Error("private RPC response and credential"); } }, "source_rpc_unavailable"],
    [{ finalizedDeposit: async () => null }, "source_observation_pending"],
    [{ finalizedDeposit: async () => ({ ...finalizedObservation,
      transaction: { ...finalizedObservation.transaction, from: recipient } }) }, "source_identity_mismatch"],
    [{ finalizedDeposit: async () => ({ ...finalizedObservation,
      receipt: { ...finalizedObservation.receipt, status: "reverted" as const } }) }, "source_deposit_reverted"],
  ] as const) {
    const diagnostic = await new RelayBaseObserveService(state, () => ({ ...fallbackPorts }),
      new RelayKeylessStatusService(state, boundFetcher), source, usage).observe(op.operationId);
    assert.equal(diagnostic.sourceObservationReason, expectedReason);
    assert.equal(diagnostic.sourceFinalized, false);
    assert.equal(diagnostic.sourceUsageFinalized, false);
    assert.equal(diagnostic.operationalAcceptance, false);
    assert.equal(JSON.stringify(diagnostic).includes("private RPC response and credential"), false);
  }
  const directOnly = await new RelayBaseObserveService(state, () => ({ ...ports }),
    new RelayKeylessStatusService(state, boundFetcher), finalized, usage).observe(op.operationId);
  assert.equal(directOnly.state, "recipient_credit_observed");
  assert.equal(directOnly.operationalAcceptance, false);
  const unfinalized = await new RelayBaseObserveService(state, () => ({ ...fallbackPorts }),
    new RelayKeylessStatusService(state, boundFetcher), { finalizedDeposit: async () => null }, usage).observe(op.operationId);
  assert.equal(unfinalized.state, "recipient_credit_observed");
  assert.equal(unfinalized.operationalAcceptance, false);
  const unboundFetcher = (async () => new Response(JSON.stringify({ status: "success", originChainId: 1,
    destinationChainId: 8453, inTxHashes: [`0x${"9".repeat(64)}`], txHashes: [hash] }),
    { status: 200 })) as typeof fetch;
  const unbound = await new RelayBaseObserveService(state, () => ({ ...fallbackPorts }),
    new RelayKeylessStatusService(state, unboundFetcher), finalized, usage).observe(op.operationId);
  assert.equal(unbound.state, "recipient_credit_observed");
  assert.equal(unbound.operationalAcceptance, false);
  const missingUsage = await new RelayBaseObserveService(state, () => ({ ...fallbackPorts }),
    new RelayKeylessStatusService(state, boundFetcher), finalized,
    { load: async () => null } as any).observe(op.operationId);
  assert.equal(missingUsage.operationalAcceptance, false);
});

test("Base adapter obtains code and both adjacent balances within eight paced POSTs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const txHash = `0x${"a".repeat(64)}`, inclusionHash = `0x${"b".repeat(64)}`,
    safeHash = `0x${"c".repeat(64)}`;
  const previousHash = `0x${"d".repeat(64)}`;
  const batches: string[][] = [];
  const rpc = { batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    batches.push(calls.map(call => call.method));
    return calls.map(call => {
      switch (call.method) {
        case "eth_chainId": return "0x2105";
        case "eth_getTransactionByHash": return { hash: txHash, chainId: "0x2105", to: recipient,
          value: "0x1", blockNumber: "0x64", blockHash: inclusionHash };
        case "eth_getTransactionReceipt": return { transactionHash: txHash, status: "0x1",
          blockNumber: "0x64", blockHash: inclusionHash, logs: [] };
        case "eth_getBlockByNumber": return call.params[0] === "safe"
          ? { number: "0x65", hash: safeHash } : call.params[0] === "0x63"
            ? { number: "0x63", hash: previousHash } : call.params[0] === "0x64"
              ? { number: "0x64", hash: inclusionHash, parentHash: previousHash } :
                { number: "0x65", hash: safeHash };
        case "eth_getCode": return "0x6000";
        case "eth_getBalance": return call.params[1] === "0x63" ? "0x64" : "0x65";
        default: throw new Error(`Unexpected RPC ${call.method}`);
      }
    });
  } } as unknown as HttpsBaseRpc;
  const adapter = new RelayBnbReadOnlyRpc("https://base.example", state, rpc, undefined, 8453);
  assert.equal(await adapter.chainId(), 8453);
  assert.ok(await adapter.transaction(txHash));
  assert.ok(await adapter.receipt(txHash));
  assert.ok(await adapter.block(100n));
  assert.deepEqual(await adapter.finalityCheckpoint(), { number: 101n, hash: safeHash });
  assert.ok(await adapter.block(101n));
  assert.ok(await adapter.routerCodeHash(recipient, 100n));
  assert.deepEqual(await adapter.adjacentBalances(recipient, 100n, inclusionHash), [100n, 101n]);
  assert.equal(adapter.physicalPosts, 8);
  assert.equal(batches.length, 8);
  assert.deepEqual(batches[7], ["eth_getBalance", "eth_getBalance", "eth_getBlockByNumber", "eth_getBlockByNumber"]);
  await assert.rejects(adapter.chainId(), { code: "APN_RPC_BUDGET_EXCEEDED" });
  const split = new RelayBnbReadOnlyRpc("https://base.example", state, rpc, undefined, 8453);
  await assert.rejects(split.adjacentBalances(recipient, 100n, safeHash), { code: "APN_RPC_PROTOCOL" });
});
