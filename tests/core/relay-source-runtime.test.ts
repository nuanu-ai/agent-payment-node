import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { createRelayEthereumSourceRuntime, RelayEthereumSourceRuntime, type RelayExecutionSummary } from "../../src/relay/source-runtime.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, relayStatusLocator, validateRelayQuote } from "../../src/relay/quote.js";
import { RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { StateStore } from "../../src/state.js";
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
      dailyLimitAtomic: "5000000", mechanism: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } }], now });
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
  let batches = 0, sends = 0, confirms = 0, approvalVisible = false;
  let summary: RelayExecutionSummary | null = null;
  const submitted: Hex[] = [];
  const approvalTopic = keccak256(toBytes("Approval(address,address,uint256)"));
  const rpc = {
    batchCall: async (calls: readonly { method: string; params: readonly unknown[] }[]): Promise<readonly unknown[]> => {
      batches++;
      if (calls.length === 2) return ["0x1", { number: "0x10", hash: blockHash, baseFeePerGas: "0x1" }];
      if (calls.length === 7) {
        for (const item of calls.slice(1, 4)) assert.deepEqual(item.params.at(-1), { blockHash, requireCanonical: true });
        return [{ number: "0x10", hash: blockHash }, "0xde0b6b3a7640000", word(2500000n),
          word(approvalVisible ? 2500000n : 0n), approvalVisible ? "0x8" : "0x7", "0x1", "0x1"];
      }
      if (calls.length === 1) return ["0x1"];
      throw new Error("Unexpected RPC batch");
    },
    coinbaseGaslessCall: async (method: string, params: readonly unknown[]) => {
      if (!approvalVisible || submitted.length === 0) return null;
      if (method === "eth_getBlockByNumber") return { number: "0x10", hash: blockHash };
      if (params[0] !== keccak256(submitted[0]!)) return null;
      if (method === "eth_getTransactionByHash") return { hash: params[0], chainId: "0x1", type: "0x2",
        blockNumber: "0x10", blockHash, from: owner, to: ETHEREUM_USDC, input: quote.approval.data, value: "0x0" };
      if (method === "eth_getTransactionReceipt") return { transactionHash: params[0], blockNumber: "0x10", blockHash,
        status: "0x1", logs: [{ address: ETHEREUM_USDC, transactionHash: params[0], blockNumber: "0x10", blockHash,
          removed: false, topics: [approvalTopic, word(BigInt(owner)), word(BigInt(ETHEREUM_DEPOSITORY))],
          data: word(2500000n) }] };
      throw new Error("Unexpected RPC method");
    },
    submitRawTransaction: async (raw: Hex) => { sends++; submitted.push(raw); return keccak256(raw); },
  };
  const authorization = { confirm: async (value: RelayExecutionSummary) => { confirms++; summary = value; return true; } };
  const runtime = new RelayEthereumSourceRuntime(state, wrapping, rpc, authorization, { now: () => now });
  return { state, wrapping, runtime, op, rpc,
    showApproval: () => { approvalVisible = true; },
    get evidence() { return { batches, sends, confirms, summary }; } };
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
