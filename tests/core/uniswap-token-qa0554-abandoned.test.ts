import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Hex } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { idempotency, seal } from "../../src/asset-usage-ledger-record.js";
import { domainHash } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { envelopeOf } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenEffectJournal } from "../../src/swap/uniswap-v3/token-effects.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { UniswapTokenJournal, validateUniswapTokenOperation, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { temporaryState } from "./helpers.js";
import { CapturedState, movingNode, pinsLikeProduction, tokenSession, usageBucket, WRAPPING } from "./uniswap-token-qa0552-harness.js";

/**
 * Execute is a foreground CLI command (MCP hands it off); status is compared across CLI and MCP.
 * QA 0.5.54 UNISWAP-TOKEN-SEND-CAPACITY-001-partial054: 867244e9… is `abandoned_unknown` (owner abandon before 0.5.54) with
 * its usage reserved, the hashless swap marker at nonce 10 and 1 USDC allowance left on the SwapRouter. Execute returned it
 * unchanged and cleanup refused `uniswap_cleanup_phase`. The journal below is the one the normal execute and status return.
 */
const LIVE = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0554.json", "utf8")) as { abandoned: { operation: UniswapTokenOperation } };
const identity = (op: UniswapTokenOperation) => ({ account: op.account, chain: "eip155:1", asset: { kind: "token" as const, identifier: op.route.inputToken } });
const usageKey = (op: UniswapTokenOperation) => `apn.uniswap-token-usage:${op.operationId}`;
const command = (action: string, op: UniswapTokenOperation) => ["swap", "ethereum", "uniswap-token", action, "--operation", op.operationId];

async function abandoned(root: string, swapNonce: "reserved" | "committed") {
  const op = validateUniswapTokenOperation(LIVE.abandoned.operation), now = new Date(Date.parse(op.updatedAt) + 3_600_000);
  assert.deepEqual([op.phase, op.usageState, op.swapAttempt?.nonce, op.swapAttempt?.transactionHash, op.cleanupReason],
    ["abandoned_unknown", "reserved", "10", null, "owner_abandoned_unknown"]);
  const state = new StateStore(root); await state.initialize(); await new UniswapTokenJournal(root).save(op);
  const usage = seal({ schemaVersion: "apn.asset-usage-reservation.v1", ...identity(op), reservationId: op.usageReservationId!,
    idempotencyHash: idempotency(usageKey(op)), policyDigest: op.policyDigest, registryVersion: "qa.054.central.captured", rail: "swap",
    amountAtomic: op.route.amountIn, reservedAt: op.approvalAttempt!.markedAt, updatedAt: op.approvalAttempt!.markedAt, state: "reserved", effectAt: null, outcomeDigest: null });
  assert.equal(assetUsageReservationId(identity(op), usageKey(op)), op.usageReservationId);
  await new CapturedState(root).put(usageBucket(op.account, op.route.inputToken), `${usage.reservationId}.json`, usage);
  const nonces = new UniswapTokenNonceStore(root), effects = new UniswapTokenEffectJournal(root), approval = op.approvalAttempt!;
  await nonces.allocate(op, "approval", 9n); await nonces.commit(op, "approval", "9"); assert.equal(await nonces.allocate(op, "swap", 10n), "10");
  if (swapNonce === "committed") await nonces.commit(op, "swap", "10");
  await effects.seal(op, "approval", approval.transactionHash as Hex, envelopeOf(op, "approval", approval.nonce), new Date(approval.markedAt));
  await effects.markStarted(op, "approval", new Date(approval.markedAt)); await effects.markOutcome(op, "approval", "send_accepted", new Date(approval.markedAt));
  // The before-read: nonce 10 at latest, pending and finalized; 1 USDC allowance standing on the SwapRouter.
  const chain = movingNode({ account: op.account, allowance: op.route.amountIn, pending: 10n }); chain.node.finalizedNonce = 10n;
  const ledger = new AssetUsageLedger(root), clock = { now: () => now };
  const runtime = (cap: number) => createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock, call: tokenSession(state, chain, cap), foreground: "refuse",
    verifyPins: pinsLikeProduction });
  const cli = async (action: string, cap: number) => await createApnCore(bindArgv(command(action, op)), { stateRoot: root, wrappingSecret: WRAPPING, clock,
    uniswapTokenRuntime: runtime(cap) }).execute(bindArgv(command(action, op)).request);
  const mcp = async (action: string, cap: number) => {
    const server = createMcpServer({ stateRoot: root, clock, uniswapTokenRuntime: runtime(cap) }), pair = InMemoryTransport.createLinkedPair();
    await server.connect(pair[1]); const client = new Client({ name: "qa0554", version: "1" }); await client.connect(pair[0]);
    try { const content = (await client.callTool({ name: `apn_swap_ethereum_uniswap_token_${action}`, arguments: { operation: op.operationId } })).content[0];
      return JSON.parse(content?.type === "text" ? content.text : "{}") as OutputEnvelope; }
    finally { await client.close(); await server.close(); }
  };
  const nonceRows = () => { const raw = JSON.parse(readFileSync(`${root}/uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", op.account)}.json`, "utf8"));
    return Object.values(raw.reservations as Record<string, { kind: string; nonce: string; state: string }>).map((row) => `${row.kind}:${row.nonce}:${row.state}`).sort(); };
  const hold = async () => [(await ledger.load(identity(op), usage.reservationId))!.state, (await ledger.usage(identity(op), new Date(op.updatedAt))).amountAtomic];
  return { op, now, chain, cli, mcp, nonceRows, hold };
}
const revoke = (op: UniswapTokenOperation) => `apn wallet allowance revoke --profile ${op.profile} --chain eip155:1 --asset ${op.route.inputToken} --spender ` +
  `${op.route.router} --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`;
const residual = (op: UniswapTokenOperation) => ({ residualAllowance: { chain: "eip155:1", token: op.route.inputToken, owner: op.account,
  spender: op.route.router, allowanceAtomic: "1000000", readAt: "latest" } });
const same = (a: OutputEnvelope, b: OutputEnvelope) => assert.deepEqual({ ...a, request_id: null }, { ...b, request_id: null });

test("QA 0.5.54 867244e9…: execute proves the abandoned swap never signed, releases the principal hold, keeps gas, and names the generic revoke", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { op, now, chain, cli, mcp, nonceRows, hold } = await abandoned(temporary.root, "reserved");
  const execute = `apn swap ethereum uniswap-token execute --operation ${op.operationId}`;
  const status = await cli("status", 11);
  same(status, await mcp("status", 11));
  assert.deepEqual([status.ok, status.proof_class, (status.operation as UniswapTokenOperation).integrityHash, status.data, status.next_actions],
    [true, "abandoned_unknown", op.integrityHash, residual(op), [execute, revoke(op)]], "status opens no custody; it names execute and the revoke");

  const released = await cli("execute", 15), record = released.operation as UniswapTokenOperation;
  assert.equal(released.ok, true, JSON.stringify(released.error));
  assert.deepEqual([record.phase, record.cleanupReason, record.usageState, record.principalRelease], ["abandoned_unknown", "owner_abandoned_unknown",
    "failed_before_effect", { schemaVersion: "apn.uniswap-token-principal-release.v1", kind: "swap_never_signed", swapNonce: "10",
      swapMarkerHash: op.swapAttempt!.markerHash, observedAt: now.toISOString() }]);
  assert.deepEqual([record.swapAttempt, record.approvalAttempt, record.cleanupAttempt, record.accumulatedNativeDebitWei, record.usageReservationId],
    [op.swapAttempt, op.approvalAttempt, null, op.accumulatedNativeDebitWei, op.usageReservationId], "gas, attempts and the marker stay");
  assert.deepEqual([released.data, released.next_actions], [residual(op), [revoke(op)]]);
  assert.deepEqual(await hold(), ["failed_before_effect", "0"]); assert.deepEqual(nonceRows(), ["approval:9:committed"], "nonce 10 is free again");
  assert.deepEqual(chain.node.sends, [], "nothing is signed or sent");

  // The same exit again and a later status (CLI and MCP): one release, no second change, the residual still named.
  same(await cli("execute", 15), released);
  const after = await cli("status", 11);
  same(after, await mcp("status", 11));
  assert.deepEqual([(after.operation as UniswapTokenOperation).integrityHash, after.data, after.next_actions], [record.integrityHash, residual(op), [revoke(op)]]);
  const cleanup = await cli("cleanup", 14);
  assert.deepEqual([cleanup.ok, cleanup.error?.details?.reason], [false, "uniswap_cleanup_phase"], "the terminal record's own cleanup stays closed");
  assert.equal((await new UniswapTokenJournal(temporary.root).load(op.operationId))?.integrityHash, record.integrityHash);
});

test("867244e9… with its swap nonce committed to signed bytes: execute changes nothing and does not name itself again", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { op, chain, cli, nonceRows, hold } = await abandoned(temporary.root, "committed");
  const executed = await cli("execute", 15);
  assert.deepEqual([executed.ok, (executed.operation as UniswapTokenOperation).integrityHash, executed.data, executed.next_actions],
    [true, op.integrityHash, residual(op), [revoke(op)]], JSON.stringify(executed.error));
  assert.deepEqual([await hold(), nonceRows(), chain.node.sends], [["reserved", op.route.amountIn], ["approval:9:committed", "swap:10:committed"], []]);
});

test("a released abandon whose ledger step was interrupted completes at the next status, without custody", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { op, now, cli, hold } = await abandoned(temporary.root, "reserved");
  const journal = new UniswapTokenJournal(temporary.root), { transitionUniswapToken } = await import("../../src/swap/uniswap-v3/token-operation.js");
  const proved = await journal.save(transitionUniswapToken(op, "abandoned_unknown", { principalRelease: { schemaVersion: "apn.uniswap-token-principal-release.v1",
    kind: "swap_never_signed", swapNonce: "10", swapMarkerHash: op.swapAttempt!.markerHash, observedAt: now.toISOString() } }, now));
  const status = await cli("status", 11);
  assert.deepEqual([(status.operation as UniswapTokenOperation).usageState, status.next_actions, await hold()],
    ["failed_before_effect", [revoke(op)], ["failed_before_effect", "0"]]);
  assert.notEqual((status.operation as UniswapTokenOperation).integrityHash, proved.integrityHash);
  // The release must name the very marker custody proved unsigned.
  assert.throws(() => transitionUniswapToken(op, "abandoned_unknown", { principalRelease: { ...proved.principalRelease!, swapNonce: "11" } }, now),
    { code: "APN_STATE_CORRUPT" });
});
