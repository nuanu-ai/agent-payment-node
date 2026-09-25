import assert from "node:assert/strict";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { relayExecutionRoute } from "../../src/relay/execution-route.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
const input = { profile: "default", owner, amountAtomic: "500000", minOutputAtomic: "94065",
  maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
  maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-prepare-0001" };

function active() {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}

test("offline command prepares one durable unsigned Arbitrum operation and replay does not reopen the quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let reads = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined, {
    activePolicy: async () => active(), dailyUsage: async () => "0",
    arbitrumQuoteFile: async () => { reads++; if (reads > 1) throw new Error("replay must not read quote file");
      return JSON.parse(await readFile(quoteFile, "utf8")) as unknown; },
  });
  const argv = ["relay", "arbitrum", "prepare", "--profile", "default", "--owner", owner,
    "--amount-atomic", input.amountAtomic, "--min-output-atomic", input.minOutputAtomic,
    "--max-provider-fee-atomic", input.maxProviderFeeAtomic,
    "--max-approval-network-fee-wei", input.maxApprovalNetworkFeeWei,
    "--max-deposit-network-fee-wei", input.maxDepositNetworkFeeWei,
    "--quote-file", quoteFile, "--idempotency-key", input.idempotencyKey];
  assert.deepEqual(bindArgv(argv).request, { command: "relay.arbitrum.prepare", ...input });
  const core = new ApnCore({ state, clock: { now: () => now }, relayPrepare: service });
  const first = await core.execute({ command: "relay.arbitrum.prepare", ...input });
  assert.equal(first.ok, true, JSON.stringify(first.error));
  const prepared = first.operation as { operationId: string; sourceChainId: number; destinationChainId: number;
    recipient: string; arbitrumSource: { orderId: string; providerFeeCeilingAtomic: string }; executionAdmitted: boolean;
    arbitrumDraft?: unknown; quoteDigest: string };
  assert.equal(prepared.sourceChainId, 42161);
  assert.equal(prepared.destinationChainId, 1);
  assert.equal(prepared.recipient, RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase());
  assert.equal(prepared.arbitrumSource.providerFeeCeilingAtomic, input.maxProviderFeeAtomic);
  assert.equal(prepared.executionAdmitted, false);
  assert.equal(prepared.arbitrumDraft, undefined);
  assert.equal(reads, 1);
  const replay = await core.execute({ command: "relay.arbitrum.prepare", ...input });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.operation, first.operation);
  assert.equal(reads, 1);
  const reopened = new OperationService(new StateStore(temporary.root));
  const required = await reopened.required(prepared.operationId);
  assert.equal(required.kind, "relay_unsigned");
  if (required.kind !== "relay_unsigned") throw new Error("wrong operation kind");
  assert.equal(required.record.arbitrumDraft?.quoteDigest, prepared.quoteDigest);
  assert.throws(() => relayExecutionRoute(required.record), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new RelayRetireService(state, { now: () => now }).retire({ profile: "default",
    operationId: prepared.operationId }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(reopened.assertEvmAccountAvailable(required.record.profileHash, 42161, owner),
    { code: "APN_OPERATION_BLOCKED" });
  await reopened.assertEvmAccountAvailable(required.record.profileHash, 1, owner);
  const restarted = new RelayUnsignedPrepareService(new StateStore(temporary.root), { now: () => now }, undefined, {
    arbitrumQuoteFile: async () => { throw new Error("restarted replay must not read quote file"); },
  });
  assert.deepEqual(await restarted.prepareArbitrum(input), first.operation);
  const changed = await core.execute({ command: "relay.arbitrum.prepare", ...input, maxProviderFeeAtomic: "401483" });
  assert.equal(changed.ok, false);
  assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");
});

test("default reader refuses a quote-file symlink before creating an operation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const alias = join(temporary.root, "quote-alias.json");
  await symlink(quoteFile, alias);
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined, {
    activePolicy: async () => active(), dailyUsage: async () => "0",
  });
  await assert.rejects(service.prepareArbitrum({ ...input, quoteFile: alias,
    idempotencyKey: "relay-arb-prepare-0003" }), { code: "APN_INVALID_INPUT" });
  assert.equal((await new RelayUnsignedOperationRepository(temporary.root).listAllOperations()).length, 0);
});

test("default quote-file reader persists offline and rejects signed-order corruption on reopen", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined, {
    activePolicy: async () => active(), dailyUsage: async () => "0",
  });
  const prepared = await service.prepareArbitrum({ ...input, idempotencyKey: "relay-arb-prepare-0002" });
  const path = join(temporary.root, "relay-unsigned-operations", state.profileHash("default"), `${prepared.operationId}.json`);
  const saved = JSON.parse(await readFile(path, "utf8")) as any;
  saved.arbitrumDraft.rawQuote.protocol.v2.orderData.output.payments[0].recipient = owner;
  const { integrityHash: _draftHash, ...draftBody } = saved.arbitrumDraft;
  saved.arbitrumDraft.integrityHash = hashObject(draftBody);
  const { integrityHash: _recordHash, ...recordBody } = saved;
  saved.integrityHash = hashObject(recordBody);
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  await assert.rejects(new RelayUnsignedOperationRepository(temporary.root).loadOperation(state.profileHash("default"), prepared.operationId),
    { code: "APN_STATE_CORRUPT" });
});
