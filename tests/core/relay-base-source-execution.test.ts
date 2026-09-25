import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { hashObject } from "../../src/canonical.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayApprovalEffectService, type RelayApprovalPorts } from "../../src/relay/approval-effect.js";
import { RelayDepositEffectService, type RelayDepositPorts } from "../../src/relay/deposit-effect.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RELAY_BASE_ACCOUNT, relayExecutionRoute } from "../../src/relay/execution-route.js";
import { ETHEREUM_USDC, relayStatusLocator, validateRelayQuote, type ValidatedRelayQuote } from "../../src/relay/quote.js";
import { RELAY_BASE_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { RelayEthereumSourceRuntime } from "../../src/relay/source-runtime.js";
import { StateStore } from "../../src/state.js";
import { TtyRelayExecuteConfirmation } from "../../src/tty-approval.js";
import { temporaryState } from "./helpers.js";

const owner = RELAY_BASE_ACCOUNT.toLowerCase();
const oldRecipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const now = new Date("2026-09-30T00:00:00.000Z");
const locator = relayStatusLocator(`0x${"b".repeat(64)}`);

async function savedBaseOperation(profileHash = "1".repeat(64)) {
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const old = await validateRelayQuote(raw, { payer: owner, recipient: oldRecipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _discard, ...fields } = old;
  const input = fields.orderData.inputs[0]!;
  const body = { ...fields, routeReference: RELAY_BASE_ROUTE_REFERENCE, statusLocator: locator,
    recipient: owner, orderData: { ...fields.orderData, inputs: [{ ...input, refunds: [
      input.refunds[0]!, { ...input.refunds[1]!, chainId: "base" as const, recipient: owner } ] }],
      output: { ...fields.orderData.output, chainId: "base" as const, payments: [
        { ...fields.orderData.output.payments[0]!, recipient: owner }] } } };
  const quote = { ...body, quoteDigest: hashObject(body) } as ValidatedRelayQuote;
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash, operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 8453,
    sourceAccount: owner, recipient: owner, quoteDigest: quote.quoteDigest, quote, statusLocator: locator,
    policyDigest: "5".repeat(64), policyRevision: 2,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
}

test("Base source admits only the saved fixed route, recipient, depository, and call shape", async () => {
  const op = await savedBaseOperation();
  assert.equal(relayExecutionRoute(op), RELAY_BASE_ROUTE_REFERENCE);
  const quote = op.quote!;
  const variants = [
    { ...op, recipient: oldRecipient },
    { ...op, sourceAccount: oldRecipient },
    { ...op, destinationChainId: 56 },
    { ...op, quote: { ...quote, routeReference: undefined } },
    { ...op, quote: { ...quote, paymentDetails: { ...quote.paymentDetails, depository: oldRecipient } } },
    { ...op, quote: { ...quote, orderData: { ...quote.orderData, output: {
      ...quote.orderData.output, calls: [{ to: oldRecipient }] } } } },
    { ...op, quote: { ...quote, orderData: { ...quote.orderData, output: {
      ...quote.orderData.output, payments: [{ ...quote.orderData.output.payments[0]!, recipient: oldRecipient }] } } } },
    { ...op, quote: { ...quote, orderData: { ...quote.orderData, inputs: [{
      ...quote.orderData.inputs[0]!, refunds: [quote.orderData.inputs[0]!.refunds[0]!,
        { ...quote.orderData.inputs[0]!.refunds[1]!, chainId: "bnb" }] }] } } },
  ];
  for (const variant of variants) assert.throws(() => relayExecutionRoute(variant as typeof op),
    { code: "APN_OPERATION_BLOCKED" });
});

test("Base source rejects a changed saved recipient before any RPC, signing, or journal effect", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const good = await savedBaseOperation(state.profileHash("default"));
  const { integrityHash: _old, ...body } = good;
  const oldQuote = body.quote!;
  const { quoteDigest: _previousDigest, ...quoteFields } = oldQuote;
  const newQuoteBody = { ...quoteFields, recipient: oldRecipient, orderData: { ...oldQuote.orderData,
    inputs: [{ ...oldQuote.orderData.inputs[0]!, refunds: [oldQuote.orderData.inputs[0]!.refunds[0]!,
      { ...oldQuote.orderData.inputs[0]!.refunds[1]!, recipient: oldRecipient }] }],
    output: { ...oldQuote.orderData.output, payments: [
      { ...oldQuote.orderData.output.payments[0]!, recipient: oldRecipient }] } } };
  const newQuote = { ...newQuoteBody, quoteDigest: hashObject(newQuoteBody) } as ValidatedRelayQuote;
  const changed = { ...body, recipient: oldRecipient, quote: newQuote, quoteDigest: newQuote.quoteDigest };
  const op = freezeRelayUnsignedOperation(changed);
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  let rpc = 0, confirmations = 0;
  const runtime = new RelayEthereumSourceRuntime(state,
    { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) },
    { batchCall: async () => { rpc++; return []; }, submitRawTransaction: async () => { rpc++; return "0x"; } },
    { confirm: async () => { confirmations++; return true; } }, { now: () => now });
  await assert.rejects(runtime.execute(op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(rpc, 0); assert.equal(confirmations, 0);
  assert.equal(await new RelayEffectJournalRepository(temp.root).load(op.profileHash, op.operationId), null);
});

test("Base approval revalidation requires the Base policy pin", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const op = await savedBaseOperation(state.profileHash("default"));
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  let fundingReads = 0;
  const active = (reference: string) => {
    const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
      registryVersion: "test.1", publishedAt: "2026-09-29T00:00:00.000Z",
      effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
      expiresAt: "2026-10-02T00:00:00.000Z", chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum",
        assets: [{ kind: "token", identifier: ETHEREUM_USDC, symbol: "USDC", decimals: 6,
          rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
          railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
          mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
    return { profile: "default" as const, registry, digest: op.policyDigest!, revision: op.policyRevision!,
      accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
  };
  const ports = (reference: string): RelayApprovalPorts => ({ now: () => now,
    activePolicy: async () => active(reference), publicAccount: async () => owner, dailyUsage: async () => "0",
    executionAdmission: async operation => ({ requestId: locator.requestId,
      operationIntegrityHash: operation.integrityHash, quoteDigest: operation.quoteDigest }),
    funding: async () => { fundingReads++; throw new Error("funding reached"); },
    custody: { load: async () => null, seal: async () => {} },
    sign: async () => { throw new Error("unexpected signing"); },
    send: async () => { throw new Error("unexpected send"); }, observe: async () => null });
  await assert.rejects(new RelayApprovalEffectService(state, ports("ethereum-usdc-bnb-native-v1")).run(op.operationId),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "route_pin" } });
  assert.equal(fundingReads, 0);
  await assert.rejects(new RelayApprovalEffectService(state, ports(RELAY_BASE_ROUTE_REFERENCE)).run(op.operationId),
    /funding reached/u);
  assert.equal(fundingReads, 1);
});

test("interrupted Base approval and deposit markers resume without a second signature or send", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  const op = await savedBaseOperation(state.profileHash("default"));
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  const effects = new RelayEffectJournalRepository(temp.root);
  let journal = await effects.create(op.profileHash, op.operationId, now.toISOString());
  journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_signing", role: "approval", marker: "d".repeat(64), at: now.toISOString() });
  let signs = 0, sends = 0;
  const common = { now: () => now, activePolicy: async () => null, publicAccount: async () => owner,
    dailyUsage: async () => "0", executionAdmission: async () => null,
    funding: async () => { throw new Error("unexpected funding"); },
    sign: async () => { signs++; throw new Error("unexpected signing"); },
    send: async () => { sends++; return "0x"; } };
  const approval = { ...common, custody: { load: async () => null, seal: async () => {} },
    observe: async () => null } as RelayApprovalPorts;
  const resumedApproval = await new RelayApprovalEffectService(state, approval).run(op.operationId);
  assert.equal(resumedApproval.effects[0].phase, "signing_started");
  assert.deepEqual({ signs, sends }, { signs: 0, sends: 0 });
  journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "seal_signed", role: "approval", transactionHash: `0x${"a".repeat(64)}` });
  journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submitting", role: "approval", at: now.toISOString() });
  journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "observe", role: "approval", outcome: "confirmed", at: now.toISOString() });
  journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_signing", role: "deposit", marker: "e".repeat(64), at: now.toISOString() });
  const deposit = { ...common, custody: { load: async () => null, seal: async () => {} },
    observeApproval: async () => null, observe: async () => null } as RelayDepositPorts;
  const resumedDeposit = await new RelayDepositEffectService(state, deposit).run(op.operationId);
  assert.equal(resumedDeposit.effects[1].phase, "signing_started");
  assert.deepEqual({ signs, sends }, { signs: 0, sends: 0 });
});

test("Base foreground prompt names Base and redacts the saved request ID", async () => {
  const op = await savedBaseOperation();
  let prompt = "";
  const terminal = { fd: 0, write: async (value: string) => { prompt += value; },
    read: async function* () { yield Buffer.from("decline\n"); }, close: async () => {} };
  const approval = new TtyRelayExecuteConfirmation({ openTerminal: async () => terminal,
    isTerminal: () => true });
  const accepted = await approval.confirm({ operationId: op.operationId, sourceChainId: 1,
    destinationChainId: 8453, sourceAccount: op.sourceAccount, sourceToken: op.quote!.paymentDetails.currency,
    amountAtomic: op.amountAtomic, recipient: op.recipient, minOutputAtomic: op.minOutputAtomic,
    deadline: op.deadline, requestId: locator.requestId, quoteDigest: op.quoteDigest,
    approvalNetworkFeeCeilingWei: op.approvalNetworkFeeCeilingWei!,
    depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei! });
  assert.equal(accepted, false);
  assert.match(prompt, /Destination chain: Base \(eip155:8453\)/u);
  assert.equal(prompt.includes(locator.requestId), false);
});
