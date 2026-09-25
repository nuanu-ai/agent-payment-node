import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { createRelayEthereumSourceRuntime, RelayEthereumSourceRuntime, type RelayExecutionSummary } from "../../src/relay/source-runtime.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { StateStore } from "../../src/state.js";
import { TtyRelayExecuteConfirmation } from "../../src/tty-approval.js";
import { temporaryState } from "./helpers.js";

const key = `0x${"1".repeat(64)}` as Hex;
const owner = privateKeyToAccount(key).address;
const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const requestId = `0x${"b".repeat(64)}`;
const blockHash = `0x${"a".repeat(64)}`;
const now = new Date("2026-09-30T00:00:00.000Z");
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const depositAbi = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);

async function setup(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root);
  await state.initialize();
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const wallets = new EncryptedWalletStore(state, wrapping);
  await wallets.importNew("default", key, owner);
  const inventory = loadAllowlistInventory();
  const policy = new AllowlistPolicyStore(temp.root);
  const staged = await policy.prepare({ profile: "default", account: owner, overlayVersion: "relay.1",
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256,
    inventorySha256: inventory.inventorySha256, effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt: "2026-10-02T00:00:00.000Z", admissions: [{ chain: "eip155:1", kind: "token",
      identifier: ETHEREUM_USDC, rail: "bridge", maximumPerTransferAtomic: "3000000",
      dailyLimitAtomic: "3000000", mechanism: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } }], now });
  await policy.appendDecision("default", null, { status: "active", revision: staged.revision,
    stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest,
    registry: staged.registry, approvalFingerprint: "a".repeat(64), decidedAt: now.toISOString() });
  const fixture = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quoted = await validateRelayQuote(fixture, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  const { quoteDigest: _, ...body } = quoted;
  const locator = relayStatusLocator(requestId);
  const data = encodeFunctionData({ abi: depositAbi, functionName: "depositErc20",
    args: [owner as Hex, ETHEREUM_USDC as Hex, 2500000n, quoted.orderId as Hex] });
  const modified = { ...body, statusLocator: locator, payer: owner.toLowerCase(), sourceRefundRecipient: owner.toLowerCase(),
    approval: { ...quoted.approval, from: owner.toLowerCase() }, deposit: { ...quoted.deposit, from: owner.toLowerCase(), data } };
  const quote = { ...modified, quoteDigest: hashObject(modified) };
  const op = freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: state.profileHash("default"), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1, destinationChainId: 56,
    sourceAccount: owner.toLowerCase(), recipient: recipient.toLowerCase(), quoteDigest: quote.quoteDigest, quote, statusLocator: locator,
    policyDigest: staged.registry.policyDigest, policyRevision: staged.revision,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: now.toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() });
  const operations = new RelayUnsignedOperationRepository(temp.root); await operations.initialize(); await operations.persistLocked(op);
  let batches = 0, sends = 0, confirms = 0, approvalVisible = false, depositVisible = false, reorgOnRecheck = false;
  let summary: RelayExecutionSummary | null = null;
  const submitted: Hex[] = [];
  const approvalTopic = keccak256(toBytes("Approval(address,address,uint256)"));
  const rpc = {
    batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]): Promise<readonly unknown[]> => {
      batches++;
      if (calls[0]?.method === "eth_getTransactionByHash") {
        assert.deepEqual(calls.map(item => item.method), ["eth_getTransactionByHash", "eth_getTransactionReceipt"]);
        const index = submitted.findIndex(raw => keccak256(raw) === calls[0]?.params[0]);
        if (index < 0 || (index === 0 && !approvalVisible) || (index === 1 && !depositVisible))
          return [null, null];
        const hash = calls[0].params[0];
        return [{ hash, chainId: "0x1", type: "0x2", blockNumber: "0x10", blockHash,
          from: owner, to: index === 0 ? ETHEREUM_USDC : ETHEREUM_DEPOSITORY,
          input: index === 0 ? quote.approval.data : quote.deposit.data, value: "0x0" },
        { transactionHash: hash, blockNumber: "0x10", blockHash, status: "0x1",
          logs: index === 0 ? [{ address: ETHEREUM_USDC, transactionHash: hash, blockNumber: "0x10", blockHash,
            removed: false, topics: [approvalTopic, word(BigInt(owner)), word(BigInt(ETHEREUM_DEPOSITORY))],
            data: word(2500000n) }] : [] }];
      }
      if (calls[0]?.method === "eth_getBlockByNumber" && calls[0].params[0] === "0x10" && calls.length === 2)
        return [{ number: "0x10", hash: blockHash }, { number: "0x10", hash: blockHash }];
      if (calls.length === 3 && calls[2]?.method === "eth_chainId")
        return [{ number: "0x10", hash: reorgOnRecheck ? `0x${"c".repeat(64)}` : blockHash },
          { number: "0x10", hash: blockHash }, "0x1"];
      if (calls.length === 2) return ["0x1", { number: "0x10", hash: blockHash, baseFeePerGas: "0x1" }];
      if (calls.length === 7) {
        for (const item of calls.slice(1, 4)) assert.deepEqual(item.params.at(-1), { blockHash, requireCanonical: true });
        return [{ number: "0x10", hash: blockHash }, "0xde0b6b3a7640000", word(2500000n),
          word(approvalVisible ? 2500000n : 0n), approvalVisible ? "0x8" : "0x7", "0x1", "0x1"];
      }
      throw new Error("Unexpected RPC batch");
    },
    submitRawTransaction: async (raw: Hex) => { sends++; submitted.push(raw); return keccak256(raw); },
  };
  const authorization = { confirm: async (value: RelayExecutionSummary) => { confirms++; summary = value; return true; } };
  const runtime = new RelayEthereumSourceRuntime(state, wrapping, rpc, authorization, { now: () => now });
  return { state, wrapping, runtime, op, rpc, registry: staged.registry,
    showApproval: () => { approvalVisible = true; },
    showDeposit: () => { depositVisible = true; },
    reorgOnRecheck: () => { reorgOnRecheck = true; },
    get evidence() { return { batches, sends, confirms, summary }; } };
}

function usageFor(f: Awaited<ReturnType<typeof setup>>, operationId = f.op.operationId) {
  const ledger = new AssetUsageLedger(f.state.root);
  const identity = { account: owner, chain: "eip155:1", asset: { kind: "token" as const, identifier: ETHEREUM_USDC } };
  return { ledger, identity, reservationId: assetUsageReservationId(identity, `relay-execute:${operationId}`) };
}

function wrongChainRpc(f: Awaited<ReturnType<typeof setup>>) {
  return { ...f.rpc, batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]) =>
    calls.length === 2 ? ["0x38", { number: "0x10", hash: blockHash, baseFeePerGas: "0x1" }] : f.rpc.batchCall(calls) };
}

test("explicit authorization seals exact admission and sends the signed approval once", async t => {
  const f = await setup(t);
  let journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(f.evidence.sends, 1);
  assert.equal(f.evidence.summary?.requestId, requestId);
  assert.equal(f.evidence.summary?.recipient, recipient.toLowerCase());
  journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(f.evidence.sends, 1);
  assert.equal(f.evidence.confirms, 2);
});

test("declined foreground authorization makes no source RPC request or effect", async t => {
  const f = await setup(t);
  const denied = new RelayEthereumSourceRuntime(f.state, f.wrapping,
    f.rpc, { confirm: async () => false }, { now: () => now });
  await assert.rejects(denied.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.evidence.sends, 0);
  assert.equal(f.evidence.batches, 0);
});

test("TTY Relay authorization declines before source RPC, signing, or journal effects", async t => {
  const f = await setup(t);
  let screen = "";
  const terminal = { fd: 0, write: async (value: string) => { screen += value; },
    read: async function* () { yield Buffer.from("decline\n"); }, close: async () => {} };
  const authorization = new TtyRelayExecuteConfirmation({ openTerminal: async () => terminal,
    isTerminal: () => true });
  const runtime = new RelayEthereumSourceRuntime(f.state, f.wrapping, f.rpc, authorization, { now: () => now });
  await assert.rejects(runtime.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.ok(screen.includes(f.op.amountAtomic));
  assert.ok(screen.includes(f.op.recipient));
  assert.ok(!screen.includes(requestId));
  assert.equal(f.evidence.batches, 0);
  assert.equal(f.evidence.sends, 0);
  assert.equal(await new RelayEffectJournalRepository(f.state.root).load(f.op.profileHash, f.op.operationId), null);

  const noTerminal = new TtyRelayExecuteConfirmation({ openTerminal: async () => terminal,
    isTerminal: () => false });
  const noninteractive = new RelayEthereumSourceRuntime(f.state, f.wrapping, f.rpc, noTerminal, { now: () => now });
  await assert.rejects(noninteractive.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.evidence.batches, 0);
  assert.equal(f.evidence.sends, 0);
  assert.equal(await new RelayEffectJournalRepository(f.state.root).load(f.op.profileHash, f.op.operationId), null);
});

test("finalized canonical approval advances to one deposit send", async t => {
  const f = await setup(t);
  await f.runtime.execute(f.op.operationId);
  f.showApproval();
  const journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "confirmed");
  assert.equal(journal.effects[1].phase, "submitting");
  assert.equal(f.evidence.sends, 2);
  await f.runtime.execute(f.op.operationId);
  assert.equal(f.evidence.sends, 2);
});

test("approval and deposit finality use bounded physical POSTs and preserve journal phases", async t => {
  const f = await setup(t);
  let journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(journal.effects[1].phase, "pending");
  const pendingApprovalPosts = f.evidence.batches;
  f.showApproval();
  journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "confirmed");
  assert.equal(journal.effects[1].phase, "submitting");
  const pendingDepositPosts = f.evidence.batches;
  f.showDeposit();
  journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "confirmed");
  assert.equal(journal.effects[1].phase, "confirmed");
  assert.equal(f.evidence.sends, 2);
  assert.deepEqual({ pendingApprovalPosts, pendingDepositPosts, finalizedPosts: f.evidence.batches },
    { pendingApprovalPosts: 5, pendingDepositPosts: 19, finalizedPosts: 22 });
  assert.equal(f.evidence.batches + f.evidence.sends, 24);
});

test("recheck reorg preserves the submitting approval and never resends", async t => {
  const f = await setup(t);
  await f.runtime.execute(f.op.operationId);
  f.showApproval(); f.reorgOnRecheck();
  const journal = await f.runtime.execute(f.op.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(journal.effects[1].phase, "pending");
  assert.equal(f.evidence.sends, 1);
  assert.equal(f.evidence.batches, 8);
});

test("production Relay RPC factory rejects signed paths and query credentials", async t => {
  const f = await setup(t);
  for (const url of ["https://rpc.example/key", "https://rpc.example/?apiKey=secret"])
    assert.throws(() => createRelayEthereumSourceRuntime(f.state, f.wrapping, url,
      { confirm: async () => true }), { code: "APN_RPC_CONFIG" });
});

test("changed durable requestId admission blocks observation replay", async t => {
  const f = await setup(t);
  await f.runtime.execute(f.op.operationId);
  const path = join(f.state.root, "relay-execution-admissions", f.op.profileHash, `${f.op.operationId}.json`);
  const saved = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...saved, requestId: `0x${"c".repeat(64)}` }));
  await assert.rejects(f.runtime.execute(f.op.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(f.evidence.sends, 1);
});

test("pre-effect refusal releases exact reservation and replay reopens it under current cap", async t => {
  const f = await setup(t);
  const bad = new RelayEthereumSourceRuntime(f.state, f.wrapping, wrongChainRpc(f),
    { confirm: async () => true }, { now: () => now });
  await assert.rejects(bad.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  const { ledger, identity, reservationId } = usageFor(f);
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "0");
  assert.equal(await new RelayEffectJournalRepository(f.state.root).load(f.op.profileHash, f.op.operationId), null);
  const result = await f.runtime.execute(f.op.operationId);
  assert.equal(result.effects[0].phase, "submitting");
  assert.equal((await ledger.load(identity, reservationId))?.state, "submitted");
  assert.equal(f.evidence.sends, 1);
});

test("signer failure after durable marker holds cap and replay never signs or sends", async t => {
  const f = await setup(t);
  Object.defineProperty(f.runtime, "sign", { value: async () => { throw new Error("synthetic signer failure"); } });
  await assert.rejects(f.runtime.execute(f.op.operationId), /synthetic signer failure/u);
  const { ledger, identity, reservationId } = usageFor(f);
  assert.equal((await ledger.load(identity, reservationId))?.state, "reserved");
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "2500000");
  assert.equal((await new RelayEffectJournalRepository(f.state.root).load(f.op.profileHash, f.op.operationId))?.effects[0].phase,
    "signing_started");
  const replay = await f.runtime.execute(f.op.operationId);
  assert.equal(replay.effects[0].phase, "signing_started");
  assert.equal(f.evidence.sends, 0);
});

test("orphan reservation is reconciled before expired quote rejection after restart", async t => {
  const f = await setup(t);
  const { ledger, identity, reservationId } = usageFor(f);
  await ledger.reserve({ ...identity, registry: f.registry, rail: "bridge", amountAtomic: f.op.amountAtomic,
    idempotencyKey: `relay-execute:${f.op.operationId}`, now });
  const expired = new RelayEthereumSourceRuntime(f.state, f.wrapping, f.rpc,
    { confirm: async () => true }, { now: () => new Date(f.op.deadline) });
  await assert.rejects(expired.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal((await ledger.usage(identity, new Date(f.op.deadline))).amountAtomic, "0");
  assert.equal(f.evidence.batches, 0);
  assert.equal(f.evidence.sends, 0);
});

test("unmarked pending journal also permits exact pre-effect recovery", async t => {
  const f = await setup(t);
  const { ledger, identity, reservationId } = usageFor(f);
  await ledger.reserve({ ...identity, registry: f.registry, rail: "bridge", amountAtomic: f.op.amountAtomic,
    idempotencyKey: `relay-execute:${f.op.operationId}`, now });
  const effects = new RelayEffectJournalRepository(f.state.root);
  await effects.create(f.op.profileHash, f.op.operationId, now.toISOString());
  const expired = new RelayEthereumSourceRuntime(f.state, f.wrapping, f.rpc,
    { confirm: async () => true }, { now: () => new Date(f.op.deadline) });
  await assert.rejects(expired.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal((await ledger.usage(identity, new Date(f.op.deadline))).amountAtomic, "0");
  assert.equal(f.evidence.sends, 0);
});

test("concurrent same-op calls send once", async t => {
  const f = await setup(t);
  const [a, b] = await Promise.all([f.runtime.execute(f.op.operationId), f.runtime.execute(f.op.operationId)]);
  assert.equal(a.effects[0].phase, "submitting");
  assert.equal(b.effects[0].phase, "submitting");
  assert.equal(f.evidence.sends, 1);
});

test("released cap admits an unrelated op, then full cap recheck denies reopening the first", async t => {
  const f = await setup(t);
  const bad = new RelayEthereumSourceRuntime(f.state, f.wrapping, wrongChainRpc(f),
    { confirm: async () => true }, { now: () => now });
  await assert.rejects(bad.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  const { integrityHash: _integrityHash, ...original } = f.op;
  const other = freezeRelayUnsignedOperation({ ...original, operationId: "5".repeat(64),
    idempotencyHash: "6".repeat(64), requestHash: "7".repeat(64) });
  const operations = new RelayUnsignedOperationRepository(f.state.root);
  await operations.persistLocked(other);
  const journal = await f.runtime.execute(other.operationId);
  assert.equal(journal.effects[0].phase, "submitting");
  assert.equal(f.evidence.sends, 1);
  await assert.rejects(f.runtime.execute(f.op.operationId), { code: "APN_OPERATION_BLOCKED" });
  const { ledger, identity, reservationId } = usageFor(f);
  assert.equal((await ledger.load(identity, reservationId))?.state, "failed_before_effect");
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "2500000");
  assert.equal(f.evidence.sends, 1);
});
