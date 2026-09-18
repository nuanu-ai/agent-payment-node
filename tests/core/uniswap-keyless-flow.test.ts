import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseTransaction } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import type { SwapOperationRecord } from "../../src/swap/model.js";
import { createUniswapKeylessRuntime } from "../../src/swap/uniswap-v3/runtime-factory.js";
import { temporaryState } from "./helpers.js";
import { ACCOUNT, AMOUNT_IN, KeylessRpc, MemoryWrapping, PROFILE, keylessPolicy, keylessWallet, quantity } from "./uniswap-keyless-helpers.js";

const noPins = async () => [];

async function flow(root: string, options: { readonly typingMs?: number; readonly typed?: (code: string) => string; readonly admitted?: boolean } = {}) {
  let clockMs = Date.now(); const clock = { now: () => new Date(clockMs) }, start = clock.now();
  const deadline = Math.floor(start.getTime() / 1000) + 900, wrapping = new MemoryWrapping();
  const state = await keylessWallet(root, wrapping, new Date(start.getTime() - 3_600_000));
  const policy = await keylessPolicy(start, new Date(deadline * 1000)), rpc = new KeylessRpc();
  let printed = "";
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { clockMs += options.typingMs ?? 0; const code = /Type ([0-9a-f]{6}) and press Enter/u.exec(printed)?.[1] ?? "";
      yield Buffer.from(`${(options.typed ?? ((value: string) => value))(code)}\n`); }, close: async () => undefined });
  const runtime = createUniswapKeylessRuntime({ state, wrapping, call: rpc.call, verifyPins: noPins, clock,
    policy: async (profile) => options.admitted === false || profile !== PROFILE ? null : policy, foreground: "tty",
    tty: { isTerminal: () => true, openTerminal: terminal } });
  const quoted: any = await runtime.quote({ profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT, amountAtomic: AMOUNT_IN, slippageBps: 50,
    ownerSlippageCapBps: 100, deadline, maxGasLimit: "300000", maxFeePerGas: "30000000000", maxPriorityFeePerGas: "1000000000" }, clock.now());
  return { runtime, rpc, state, clock, advance: (ms: number) => { clockMs += ms; }, quoted, printed: () => printed,
    usage: () => new AssetUsageLedger(root).usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null } }, clock.now()) };
}

test("one foreground command shows the exact screen, takes the typed code after 45 seconds, and sends exactly once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root, { typingMs: 45_000 });
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "keyless-flow-0001" }, f.clock.now());
  assert.equal(prepared.state, "awaiting_approval"); assert.equal(prepared.approvalCapAtomic, "0");
  f.rpc.head = 101n;
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  assert.equal(sent.state, "submitted"); assert.equal(f.rpc.sends.length, 1);
  for (const line of ["You send: 0.001 ETH (1000000000000000 wei)", "Expected in: 2.469083 USDC", "Minimum in: 2.456738 USDC", "Slippage cap: 50 basis points",
    "Price impact vs pool spot after the 0.05% LP fee: 0 basis points", "Gas limit: 203084; max fee per gas: 30000000000 wei",
    "Maximum network fee: 0.00609252 ETH", "Token approval cap: 0", "Deadline: ", "sends exactly once"]) assert.ok(f.printed().includes(line), line);
  const tx = parseTransaction(f.rpc.sends[0]!);
  assert.equal(tx.to, "0x0542093271A31f6FC1DADB232bd59eeb27de780F".toLowerCase()); assert.equal(tx.value, BigInt(AMOUNT_IN)); assert.equal(tx.nonce, 7);
  assert.equal(tx.gas, 203_084n); assert.equal(tx.maxFeePerGas, 30_000_000_000n);
  const binding = JSON.parse(await readFile(join(f.state.root, "uniswap-execution-bindings", sent.ownerProfileHash, `${sent.operationId}.json`), "utf8"));
  assert.equal(binding.submissionMarkerHash, sent.submissionMarker?.markerHash); assert.equal(JSON.stringify(binding).includes(f.rpc.sends[0]!), false);
  const again = await f.runtime.execute(sent.operationId, f.clock.now());
  assert.equal(again.state, "submitted"); assert.equal(f.rpc.sends.length, 1, "status/execute after the marker only observe");
  const status = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(status.integrityHash, again.integrityHash); assert.equal(f.rpc.sends.length, 1);
  assert.equal((await f.usage()).amountAtomic, AMOUNT_IN);
});

test("a finalized status-0 receipt becomes failed_confirmed_revert and releases the reservation without resending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root);
  const prepared = await f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "keyless-flow-0002" }, f.clock.now());
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  const tx = parseTransaction(f.rpc.sends[0]!);
  f.rpc.gas = quantity(tx.gas!); f.rpc.maxFee = quantity(tx.maxFeePerGas!); f.rpc.priority = quantity(tx.maxPriorityFeePerGas!);
  f.rpc.receipt = "revert"; f.rpc.minedAt = 102n; f.rpc.head = 101n; f.advance(12_000);
  const pending = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(pending.state, "submitted", "not final until the mined block is finalized");
  f.rpc.head = 200n; f.advance(12_000);
  const reverted: SwapOperationRecord = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(reverted.state, "failed_confirmed_revert"); assert.equal(reverted.usageLease?.state, "failed_confirmed_revert");
  assert.equal(reverted.failureProofHash, reverted.receiptProof?.receiptHash); assert.equal(f.rpc.sends.length, 1);
  assert.equal((await f.usage()).amountAtomic, "0");
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).integrityHash, reverted.integrityHash);
});

test("a wrong code refuses before any reservation, and a pre-send guard refusal releases the reservation unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const refused = await flow(temporary.root, { typed: (code) => `${code.slice(0, 5)}0` === code ? `${code.slice(0, 5)}1` : `${code.slice(0, 5)}0` });
  const prepared = await refused.runtime.prepare({ profile: PROFILE, quoteHash: refused.quoted.quoteHash, idempotencyKey: "keyless-flow-0003" }, refused.clock.now());
  await assert.rejects(refused.runtime.approveAndExecute(prepared.operationId, refused.clock.now()));
  const after = await new SwapOperationRepository(temporary.root).loadAny(prepared.operationId);
  assert.equal(after?.state, "awaiting_approval"); assert.equal(refused.rpc.sends.length, 0); assert.equal((await refused.usage()).amountAtomic, "0");

  const other = await temporaryState(); t.after(other.cleanup);
  const pending = await flow(other.root); pending.rpc.pendingNonce = 8n;
  const op = await pending.runtime.prepare({ profile: PROFILE, quoteHash: pending.quoted.quoteHash, idempotencyKey: "keyless-flow-0004" }, pending.clock.now());
  await assert.rejects(pending.runtime.approveAndExecute(op.operationId, pending.clock.now()),
    (error: any) => error.details?.reason === "uniswap_pending_nonce");
  const released = await new SwapOperationRepository(other.root).loadAny(op.operationId);
  assert.equal(released?.state, "failed_before_effect"); assert.equal(released?.usageLease?.state, "failed_before_effect");
  assert.equal(pending.rpc.sends.length, 0); assert.equal((await pending.usage()).amountAtomic, "0");
});

test("preparation refuses without an active owner admission and MCP-style consent is impossible", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await flow(temporary.root, { admitted: false });
  await assert.rejects(f.runtime.prepare({ profile: PROFILE, quoteHash: f.quoted.quoteHash, idempotencyKey: "keyless-flow-0005" }, f.clock.now()),
    (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "swap_owner_admission_required");
  const { REFUSING_SWAP_APPROVAL } = await import("../../src/swap/uniswap-v3/runtime-factory.js");
  await assert.rejects(REFUSING_SWAP_APPROVAL.approve({} as never), { code: "APN_FOREGROUND_APPROVAL_REQUIRED" });
});
