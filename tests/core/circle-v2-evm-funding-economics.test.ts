/**
 * QA 0.5.51 CIRCLE-RECEIPT-ECONOMICS-001 and CIRCLE-NEXT-ACTION-001: the completed route shows the USDC it actually
 * credited and the issuer fee it actually paid (gross 40100, max fee 100, min mint 40000, fee 5 → net 40095 on Sei, as
 * operation 4b84d79c… did), pending facts stay null, and every phase names the owner step it waits for.
 * Synthetic CPU-only observations driven through the real lifecycle; no network, no keys.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CircleRepository, validateCircleFundingAdvance } from "../../src/circle-v2-evm/repository.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { advanceCircleFundingOperation, circleFundingFingerprint, publicCircleFundingOperation, sealCircleFundingOperation,
  type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { circleEnvelope, type CircleEffect } from "../../src/circle-v2-evm/operation-model.js";
import { CIRCLE_MESSENGER, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { bindCircleAttestation, CIRCLE_ZERO, circleWord, decodeCircleDestination, decodeCircleMessage, decodeCircleSource, encodeCircleApproval,
  encodeCircleBurn, encodeCircleMint } from "../../src/circle-v2-evm/protocol.js";
import { approveCircleFundingMint, approveCircleFundingSource, assertCircleFundingEffectGuard, type CircleFundingLifecyclePorts } from "../../src/circle-v2-evm/funding-lifecycle.js";
import type { CircleFundingMaterial } from "../../src/circle-v2-evm/funding-custody.js";
import { idempotency, reservationIdFor, seal as sealUsage } from "../../src/asset-usage-ledger-record.js";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { StateStore } from "../../src/state.js";
import { at, fundingIdentity, initial } from "./circle-v2-evm-nonce-runtime-fixtures.js";
import { event, message, observation, snapshot } from "./circle-v2-evm-runtime-fixtures.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const CHAIN = 1329, tx = `0x${"11".repeat(32)}` as Hex, recipient = getAddress("0x69691Ec6B104f6482F6547e1a201619115854332");
const params = { recipient, amountAtomic: "40100", maxFeeAtomic: "100", minMintAtomic: "40000" };
const ZERO = getAddress(`0x${"00".repeat(20)}`), FEE_RECIPIENT = getAddress("0xfc1BDd1Ff58200761d56cCbCE73f6F42EBe56379");
type Next = { next_actions: readonly string[]; actual_economics: Record<string, unknown> };

function prepared(): readonly [CircleFundingOperationV2, CircleFundingOperationV2] {
  const legacy = initial(join(tmpdir(), "qa0551-circle"), CHAIN), b = circleFundingBinding(CHAIN, fundingIdentity(legacy), params);
  const feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const { schemaVersion: _v, integrityHash: _h, transitions: _t, externalFulfillment: _e, nonceRetirement: _n, ...rest } = legacy;
  const effects = rest.effects.map(e => { const { envelopeHash: _old, ...envelope } = e.envelope;
    return { ...e, envelope: circleEnvelope({ ...envelope, data: e.role === "burn" ? encodeCircleBurn(CHAIN, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...rest, schemaVersion: "apn.circle-v2-evm-operation.v2", funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic,
    state: "awaiting_source", policies: rest.policies.map(p => ({ ...p, activationDigest: "a".repeat(64) })), expiresAt: new Date(at + 900000).toISOString(), effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) });
  op = advanceCircleFundingOperation(op, {}, "prepared", at);
  return [op, advanceCircleFundingOperation(op, { usage: holds(op) }, "reserved", at)];
}
function holds(op: CircleFundingOperationV2, target: "reserved" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted" = "reserved") {
  return ["usdc", "approval", "burn", "cleanup", "mint"].map((key, i) => {
    const identity = { account: i === 4 ? op.funding.gasPayer : CIRCLE_SOURCE_OWNER, chain: i === 4 ? `eip155:${CHAIN}` : "eip155:42161",
      asset: i === 0 ? { kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native" as const, identifier: null } }, ih = idempotency(`${op.operationId}:${key}`);
    const state = target === "finalized" && i === 3 ? "failed_confirmed_revert" : target, settled = ["finalized", "failed_confirmed_revert"].includes(state);
    return sealUsage({ schemaVersion: "apn.asset-usage-reservation.v1", reservationId: reservationIdFor(identity, ih), idempotencyHash: ih,
      policyDigest: op.policies.find(x => x.profileHash === (i === 4 ? op.destinationProfileHash : op.profileHash))!.policyDigest, registryVersion: "synthetic-qa0551",
      ...identity, rail: "bridge", amountAtomic: i === 0 ? op.funding.amountAtomic : i === 4 ? circleRoute(CHAIN).destinationNativeCap : i === 3 ? "15000000000000" : "30000000000000",
      state, reservedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), effectAt: settled ? new Date(at).toISOString() : null,
      outcomeDigest: settled || ["failed_before_effect", "released_unsubmitted"].includes(state) ? "8".repeat(64) : null, ...(state === "failed_confirmed_revert" ? { consumedAtomic: "0" } : {}) });
  });
}
function fundingMessage(op: CircleFundingOperationV2, attested: boolean, fee: bigint): Hex {
  let bytes = message(CHAIN, attested, fee);
  const put = (offset: number, word: string) => { bytes = `${bytes.slice(0, 2 + offset * 2)}${word}${bytes.slice(2 + (offset + 32) * 2)}` as Hex; };
  put(184, circleWord(op.funding.recipient).slice(2)); put(216, BigInt(op.funding.amountAtomic).toString(16).padStart(64, "0"));
  put(280, BigInt(op.funding.maxFeeAtomic).toString(16).padStart(64, "0")); return bytes;
}
function burnObservation(op: CircleFundingOperationV2, finalityTag: "included" | "finalized") {
  const b = op.funding;
  return { ...observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, encodeCircleBurn(CHAIN, b), [
    event("MessageSent", CIRCLE_TRANSMITTER, { message: fundingMessage(op, false, 0n) }, 0),
    event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: BigInt(b.amountAtomic), depositor: CIRCLE_SOURCE_OWNER, mintRecipient: circleWord(b.recipient),
      destinationDomain: b.destinationDomain, destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: BigInt(b.maxFeeAtomic), minFinalityThreshold: 1000, hookData: "0x" }, 1)]), finalityTag };
}
async function issuer(op: CircleFundingOperationV2, burnTx: Hex, fee: bigint) {
  const bytes = fundingMessage(op, true, fee), m = decodeCircleMessage(bytes, CHAIN, true, op.funding);
  const signers = [1n, 2n].map(n => privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`)).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
  const sigs = await Promise.all(signers.map(s => s.sign({ hash: keccak256(bytes) })));
  return { sourceTxHash: burnTx, messages: [{ cctpVersion: 2, status: "complete", eventNonce: m.nonce, message: bytes, attestation: `0x${sigs.map(s => s.slice(2)).join("")}`,
    decodedMessage: { sourceDomain: "3", destinationDomain: String(op.funding.destinationDomain), nonce: m.nonce, sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER),
      destinationCaller: CIRCLE_ZERO, messageBody: m.body, minFinalityThreshold: "1000", finalityThresholdExecuted: "1000", decodedMessageBody: { burnToken: circleWord(CIRCLE_SOURCE_TOKEN),
        mintRecipient: circleWord(recipient), amount: params.amountAtomic, messageSender: circleWord(CIRCLE_SOURCE_OWNER), maxFee: params.maxFeeAtomic, feeExecuted: m.feeExecutedAtomic,
        expirationBlock: m.expirationBlock, hookData: "0x" } } }] };
}
/** The real lifecycle from a prepared route to a completed one, recording the public view after every owner step. */
async function journey(fee: bigint) {
  const [first, start] = prepared(), net = BigInt(params.amountAtomic) - fee, token = circleRoute(CHAIN).token, journal = [first, start];
  const included = decodeCircleSource(burnObservation(start, "included"), CHAIN, start.funding), finalized = decodeCircleSource(burnObservation(start, "finalized"), CHAIN, start.funding);
  const attested = await bindCircleAttestation(included, await issuer(start, included.transactionHash, fee), snapshot(CHAIN), start.funding);
  const mintLogs = [event("Transfer", token, { from: ZERO, to: recipient, value: net }, 0), ...(fee === 0n ? [] : [event("Transfer", token, { from: ZERO, to: FEE_RECIPIENT, value: fee }, 1)]),
    event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: recipient, amount: net, mintToken: token, feeCollected: fee }, 2),
    event("MessageReceived", CIRCLE_TRANSMITTER, { caller: start.funding.gasPayer, sourceDomain: 3, nonce: attested.nonce, sender: circleWord(CIRCLE_MESSENGER), finalityThresholdExecuted: 1000, messageBody: attested.body }, 3)];
  const mint = observation(CHAIN, start.funding.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(attested), mintLogs);
  const approvalProof = { transactionHash: tx, blockHash: tx, blockNumberAtomic: "10", receiptHash: "a".repeat(64), actualFeeAtomic: "1112215830000", finalityBlockHash: tx,
    finalityBlockNumberAtomic: "10", transactionHashBinding: "a".repeat(64), logsHash: "b".repeat(64), finalityTag: "included" as const };
  let current = start, clock = at + 1, minted = false; const views: Next[] = [];
  const material = (o: CircleFundingOperationV2, e: CircleEffect): CircleFundingMaterial => ({ schemaVersion: "apn.circle-v2-evm-effect.v2", operationId: o.operationId, role: e.role,
    fingerprint: o.fingerprint, envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: tx, materialHash: "9".repeat(64) });
  const ports: CircleFundingLifecyclePorts = { now: () => clock, save: async o => { validateCircleFundingAdvance(current, o); current = o; journal.push(o); views.push(publicCircleFundingOperation(o) as Next); },
    assertOwnerPolicyAndConflicts: async () => {}, authorizationDeadline: async () => new Date(at + 900000).toISOString(), approve: async () => {}, preflight: async () => {},
    seal: async (o, e, g) => { assertCircleFundingEffectGuard(o, e, g); return material(o, e); }, loadMaterial: async (o, e) => material(o, e),
    broadcast: async (e, _raw, g) => { g(); if (e.role === "mint") minted = true; return tx; },
    observeEffect: async (_o, e) => e.role === "approval" ? approvalProof : e.role === "burn" ? included : null,
    observeSource: async (_o, final) => final ? finalized : included, observeDestination: async o => minted ? decodeCircleDestination(o.source!, o.attestation!, mint, "1", undefined, undefined, o.funding) : null,
    allowance: async () => "0", attestation: async () => attested,
    mintEnvelope: async o => circleEnvelope({ chainId: CHAIN, from: o.funding.gasPayer, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(o.attestation!), valueAtomic: "0", nonceAtomic: "10",
      gasLimitAtomic: "500000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" }),
    cleanupEnvelope: async () => { throw Error("no cleanup in this journey"); }, usage: async (o, t) => holds(o, t) };
  const initialView = publicCircleFundingOperation(start) as Next;
  const sourced = await approveCircleFundingSource(start, ports); clock += 1;
  const done = await approveCircleFundingMint(sourced, ports);
  return { start, initialView, views, sourced, done, journal, net: net.toString() };
}
const run = (id: string, command: string) => `apn circle evm ${command} --operation ${id}`;

for (const fee of [5n, 0n]) test(`completed owned mint (fee ${fee}) shows the actual net and issuer fee; every earlier phase named its owner step`, async () => {
  const { start, initialView, views, sourced, done, net } = await journey(fee), id = start.operationId;
  assert.equal(done.state, "completed"); assert.equal(done.terminal, true);
  // Before any source effect: approve-source, then the cleanup exit (after the preparation window it is the only one).
  assert.deepEqual(initialView.next_actions, [run(id, "approve-source"), run(id, "cleanup")]);
  assert.deepEqual(initialView.actual_economics.actual_source_gross_atomic, null); assert.equal(initialView.actual_economics.actual_destination_net_atomic, null);
  // A possibly-sent effect is only observed; a confirmed approval with an unsigned burn goes back to approve-source.
  const submitted = views.find(v => (v as unknown as { effects: { role: string; phase: string }[] }).effects[0]!.phase === "submitted")!;
  assert.deepEqual(submitted.next_actions, [run(id, "observe")]);
  const approvalOnly = views.find(v => { const e = (v as unknown as { effects: { phase: string }[] }).effects; return e[0]!.phase === "confirmed" && e[1]!.phase === "prepared"; })!;
  assert.deepEqual(approvalOnly.next_actions, [run(id, "approve-source"), run(id, "cleanup")]);
  // Burn and attestation verified, no mint yet: approve-mint (it was observe, a loop, in 0.5.51).
  const awaiting = publicCircleFundingOperation(sourced) as Next;
  assert.equal(sourced.state, "awaiting_mint"); assert.deepEqual(awaiting.next_actions, [run(id, "approve-mint")]);
  assert.equal(awaiting.actual_economics.actual_source_gross_atomic, "40100"); assert.equal(awaiting.actual_economics.source_burn_finality, "included");
  assert.equal(awaiting.actual_economics.actual_destination_net_atomic, null); assert.equal(awaiting.actual_economics.actual_issuer_fee_atomic, null);
  const finality = views.find(v => (v as unknown as { state: string }).state === "awaiting_finality");
  if (finality !== undefined) assert.deepEqual(finality.next_actions, [run(id, "observe")]);
  const view = publicCircleFundingOperation(done) as Next & Record<string, unknown>;
  assert.deepEqual(view.next_actions, []);
  assert.deepEqual(view.actual_economics, { asset: { symbol: "USDC", decimals: 6, source_chain: "eip155:42161", source_token: CIRCLE_SOURCE_TOKEN,
    destination_chain: "eip155:1329", destination_token: circleRoute(CHAIN).token }, actual_source_gross_atomic: "40100", source_burn_transaction_hash: tx,
    source_burn_finality: "finalized", actual_destination_net_atomic: net, actual_issuer_fee_atomic: fee.toString(), destination_mint: "owned",
    destination_mint_transaction_hash: tx, destination_mint_finality: "safe" });
  // The caps keep their own names beside the facts.
  assert.equal(view.amount_atomic, "40100"); assert.equal(view.minimum_output_atomic, "40000"); assert.equal(view.maximum_issuer_fee_atomic, "100");
});

test("CLI receipt and status and MCP receipt and status return the same completed economics", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const { done, journal } = await journey(5n), repo = new CircleRepository(tmp.root); await new StateStore(tmp.root).initialize();
  for (const step of journal) await repo.saveFunding(step); // the same journal, every advance validated as the runtime writes it
  // A trap custody secret: reading a receipt must never touch private material.
  const wrappingSecret = { load: async () => { throw Error("private forbidden"); }, create: async () => { throw Error("private forbidden"); } };
  const server = createMcpServer({ stateRoot: tmp.root, wrappingSecret }); const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b);
  const client = new Client({ name: "qa0551-circle", version: "1" }); await client.connect(a); t.after(async () => { await client.close(); await server.close(); });
  const mcp = async (name: string) => (await client.callTool({ name, arguments: { operation: done.operationId } })).structuredContent as unknown as OutputEnvelope;
  const cliReceipt = await runCli(["receipt", "get", "--operation", done.operationId], {}, { stateRoot: tmp.root, wrappingSecret });
  const cliStatus = await runCli(["operation", "status", "--operation", done.operationId], {}, { stateRoot: tmp.root, wrappingSecret });
  const mcpReceipt = await mcp("apn_receipt_get"), mcpStatus = await mcp("apn_operation_status");
  for (const envelope of [cliReceipt, cliStatus, mcpReceipt, mcpStatus]) assert.equal(envelope.ok, true, JSON.stringify(envelope));
  assert.deepEqual(mcpReceipt.receipt, cliReceipt.receipt); assert.deepEqual(mcpStatus.operation, cliStatus.operation); assert.deepEqual(cliStatus.operation, cliReceipt.receipt);
  const economics = (cliReceipt.receipt as Next).actual_economics;
  assert.equal(economics.actual_destination_net_atomic, "40095"); assert.equal(economics.actual_issuer_fee_atomic, "5"); assert.equal(economics.destination_mint, "owned");
});
