import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { hashObject } from "../../src/canonical.js";
import { proveRelayBaseDestination, type RelayBnbProofPorts } from "../../src/relay/destination-proof.js";
import { RelayBaseObserveService } from "../../src/relay/base-observe.js";
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
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 8453,
    sourceAccount: payer.toLowerCase(), recipient: recipient.toLowerCase(), quoteDigest: quote.quoteDigest, quote,
    statusLocator: locator, policyDigest: "5".repeat(64), policyRevision: 1,
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
  assert.equal(observed.operationalAcceptance, false);
  assert.equal(statusCalls, 1); assert.equal(rpcCalls, 1);
});
