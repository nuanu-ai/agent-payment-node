import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getAddress } from "viem";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { OperationService } from "../../src/operation-service.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import type { RelayBnbProofPorts } from "../../src/relay/destination-proof.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { RelayObserveService } from "../../src/relay/observe.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RelayKeylessStatusService } from "../../src/relay/status.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

/**
 * QA 0.5.51 RELAY-OBSERVE-TERMINAL-CLAIM-001 (49d4d136…, Ethereum USDC -> BNB): `relay observe` proved the deposit final and
 * the BNB credit, but left the deposit journal `submitting`, so the operation stayed `prepared` and blocked its account.
 */
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase(), recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const sourceHash = hash("a"), sourceBlock = hash("b"), bnbHash = hash("c"), bnbBlock = hash("d"), safeHash = hash("e"), at = "2026-09-30T00:00:01.000Z";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const raw = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const base = await validateRelayQuote(raw, { payer, recipient, amountAtomic: "2500000", minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, statusLocator: _old, ...projection } = base, statusLocator = relayStatusLocator(hash("f"));
  const fields = { ...projection, statusLocator }, quote = { ...fields, quoteDigest: hashObject(fields) };
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z", expiresAt: "2026-10-02T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: ETHEREUM_USDC, symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } } }] }] });
  const state = new StateStore(temp.root);
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: state.profileHash("default"), operationId: "2".repeat(64), idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64),
    sourceChainId: 1, destinationChainId: 56, sourceAccount: payer, recipient, quoteDigest: quote.quoteDigest, quote, statusLocator,
    policyDigest: registry.policyDigest, policyRevision: 1, approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: "2026-09-30T00:00:00.000Z", deadline: new Date(quote.deadline * 1000).toISOString() });
  await new RelayUnsignedOperationRepository(temp.root).persistLocked(op);
  // What `relay execute` leaves when the deposit was sent once and not yet final: approval confirmed, deposit submitting.
  const effects = new RelayEffectJournalRepository(temp.root);
  let journal = await effects.create(op.profileHash, op.operationId, "2026-09-30T00:00:00.000Z");
  for (const [role, transactionHash] of [["approval", hash("7")], ["deposit", sourceHash]] as const) {
    for (const event of [{ kind: "mark_signing", role, marker: "6".repeat(64), at }, { kind: "seal_signed", role, transactionHash },
      { kind: "mark_submitting", role, at }] as const) journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash, event);
    if (role === "approval") journal = await effects.transition(op.profileHash, op.operationId, journal.integrityHash,
      { kind: "observe", role, outcome: "confirmed", at });
  }
  const ledger = new AssetUsageLedger(temp.root), identity = { account: getAddress(payer), chain: "eip155:1", asset: { kind: "token" as const, identifier: ETHEREUM_USDC } };
  const reservationId = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
  await ledger.reserve({ ...identity, registry, rail: "bridge", amountAtomic: op.amountAtomic, idempotencyKey: `relay-execute:${op.operationId}`,
    now: new Date("2026-09-30T00:00:00.000Z") });
  await ledger.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "submitted", now: new Date(at) });
  const finalized = { transaction: { hash: sourceHash, from: payer, to: ETHEREUM_DEPOSITORY, input: quote.deposit.data, value: 0n, chainId: 1 },
    receipt: { transactionHash: sourceHash, status: "success" as const, blockNumber: 100n, blockHash: sourceBlock }, canonicalBlockHash: sourceBlock };
  const bnb: RelayBnbProofPorts = { chainId: async () => 56,
    transaction: async () => ({ hash: bnbHash, chainId: 56, to: recipient, valueWei: BigInt(op.minOutputAtomic), blockNumber: 200n, blockHash: bnbBlock }),
    receipt: async () => ({ transactionHash: bnbHash, status: "success", blockNumber: 200n, blockHash: bnbBlock }),
    block: async number => ({ number, hash: number === 200n ? bnbBlock : safeHash }), finalityCheckpoint: async () => ({ number: 205n, hash: safeHash }) };
  const payload = { status: "success", originChainId: 1, destinationChainId: 56, inTxHashes: [sourceHash], txHashes: [bnbHash] };
  const observe = async (source: { finalizedDeposit(): Promise<typeof finalized | null> } = { finalizedDeposit: async () => finalized }, body: object = payload) => {
    const service = new RelayObserveService(state, source, () => ({ ...bnb }), new RelayKeylessStatusService(state, async () => new Response(JSON.stringify(body))));
    const result = await runCli(["relay", "observe", "--profile", "default", "--operation", op.operationId, "--rpc-url", "https://ethereum-rpc.publicnode.com",
      "--destination-rpc-url", "https://bsc-rpc.publicnode.com"], {}, { stateRoot: temp.root, relayObserve: service });
    assert.equal(result.ok, true, JSON.stringify(result.error)); return result.data as Awaited<ReturnType<RelayObserveService["observe"]>>;
  };
  const status = async () => (await runCli(["operation", "status", "--operation", op.operationId], {}, { stateRoot: temp.root })).operation as { state: string; terminal: boolean };
  const accountFree = async () => await new OperationService(state).assertEvmAccountAvailable(state.profileHash("other"), 1, payer);
  return { temp, op, effects, ledger, identity, reservationId, finalized, payload, observe, status, accountFree };
}

test("observe that proves the deposit final closes the source: terminal status, finalized hold, the account admits the next operation", async (t) => {
  const f = await fixture(t);
  const before = await f.status(); assert.deepEqual([before.state, before.terminal], ["prepared", false]);
  await assert.rejects(f.accountFree(), (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.blockingOperationId === f.op.operationId);
  const result = await f.observe();
  assert.deepEqual([result.state, result.sourceFinalized, result.operationalAcceptance, result.paidAcceptance, result.causalLinkCryptographicallyProven],
    ["operational_acceptance", true, true, false, false]);
  const journal = (await f.effects.load(f.op.profileHash, f.op.operationId))!, deposit = journal.effects[1];
  assert.deepEqual([deposit.phase, deposit.attempt?.attemptNumber, deposit.attempt?.transactionHash], ["confirmed", 1, sourceHash]);
  const hold = await f.ledger.load(f.identity, f.reservationId);
  assert.deepEqual([hold?.state, hold?.outcomeDigest], ["finalized", journal.integrityHash]);
  const after = await f.status(); assert.deepEqual([after.state, after.terminal], ["source_confirmed", true]);
  await f.accountFree();
  assert.equal((await f.observe()).state, "operational_acceptance");
  assert.equal((await f.effects.load(f.op.profileHash, f.op.operationId))?.integrityHash, journal.integrityHash, "a repeated observe changes nothing");
});

test("a finalized deposit closes the source even while the destination is unproven; an unfinal or failed one closes nothing", async (t) => {
  const pending = await fixture(t);
  for (const source of [{ finalizedDeposit: async () => null },
    { finalizedDeposit: async () => ({ ...pending.finalized, receipt: { ...pending.finalized.receipt, status: "reverted" as const } }) },
    { finalizedDeposit: async () => ({ ...pending.finalized, canonicalBlockHash: hash("9") }) },
    { finalizedDeposit: async () => ({ ...pending.finalized, transaction: { ...pending.finalized.transaction, from: recipient } }) }]) {
    const result = await pending.observe(source as never);
    assert.equal(result.state, "source_unproven"); assert.equal(result.operationalAcceptance, false);
    assert.equal((await pending.effects.load(pending.op.profileHash, pending.op.operationId))?.effects[1].phase, "submitting");
    assert.equal((await pending.ledger.load(pending.identity, pending.reservationId))?.state, "submitted");
    assert.equal((await pending.status()).terminal, false);
  }
  const unbound = await pending.observe(undefined, { ...pending.payload, status: "failure" });
  assert.deepEqual([unbound.state, unbound.operationalAcceptance], ["recipient_credit_observed", false]);
  assert.deepEqual([(await pending.status()).state, (await pending.ledger.load(pending.identity, pending.reservationId))?.state], ["source_confirmed", "finalized"]);
});

test("acceptance is not claimed while the saved hold cannot be bound to the proven deposit", async (t) => {
  const f = await fixture(t);
  await f.ledger.transition({ ...f.identity, reservationId: f.reservationId, policyDigest: f.op.policyDigest!, state: "unknown_finality", now: new Date(at) });
  const result = await f.observe();
  assert.deepEqual([result.state, result.reason, result.operationalAcceptance], ["recipient_credit_observed", "source_journal_unreconciled", false]);
  assert.equal((await f.effects.load(f.op.profileHash, f.op.operationId))?.effects[1].phase, "submitting");
  assert.equal((await f.status()).terminal, false);
});
