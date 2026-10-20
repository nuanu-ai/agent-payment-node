/**
 * QA 0.5.51 DIRECT-RECEIPT-FEE-001: a completed or reverted direct EVM transfer records what it actually paid, from its
 * own canonical receipt and by its network's charge rule, and shows it in status and receipt (CLI and MCP alike). The
 * per-chain amounts below are the QA witnesses: Sei USDC ca0c90b1… (gasUsed x price), Monad 61fb4793… and e7616864…
 * (full gas limit billed), Polygon 3319e697…. A component the receipt does not carry leaves the fee incomplete.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { toHex } from "viem";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { deriveEvmActualFee, readEvmReceiptFeeFields, validateEvmActualFee, type EvmActualFeeInput } from "../../src/evm-direct-actual-fee.js";
import { sealOperation, validateOperation } from "../../src/state-integrity.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { testRuntime } from "./installed-runtime.js";

const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const HASH = `0x${"ab".repeat(32)}` as const;
const input = (chainId: number, gasLimit: bigint, maxFee: bigint, raw: Record<string, unknown>): EvmActualFeeInput => ({ chainId, transactionHash: HASH,
  blockNumberAtomic: "100", gasLimitAtomic: gasLimit.toString(), maxFeePerGasAtomic: maxFee.toString(), receiptFields: readEvmReceiptFeeFields(raw) });

test("each network's charge rule gives the QA witnesses' exact fee", () => {
  const sei = deriveEvmActualFee(input(1329, 130000n, 102000000000n, { gasUsed: toHex(114147n), effectiveGasPrice: toHex(51000000000n) }));
  assert.equal(sei.totalFeeAtomic, "5821497000000000"); assert.equal(sei.feeModel, "eip1559"); assert.equal(sei.gasBilledAtomic, "114147");
  const monad = deriveEvmActualFee(input(143, 21000n, 204000000000n, { gasUsed: toHex(21000n), effectiveGasPrice: toHex(102000000000n) }));
  assert.equal(monad.totalFeeAtomic, "2142000000000000");
  const monadToken = deriveEvmActualFee(input(143, 100504n, 204000000000n, { gasUsed: toHex(51000n), effectiveGasPrice: toHex(102000000000n) }));
  assert.equal(monadToken.totalFeeAtomic, "10251408000000000", "Monad bills the gas limit, not the gas used"); assert.equal(monadToken.gasBilledAtomic, "100504");
  const polygon = deriveEvmActualFee(input(137, 21000n, 600000000000n, { gasUsed: toHex(21000n), effectiveGasPrice: toHex(269857871318n) }));
  assert.equal(polygon.totalFeeAtomic, "5667015297678000");
  // Arbitrum folds L1 posting into gasUsed; its informational fields are not another charge.
  const arbitrum = deriveEvmActualFee(input(42161, 900000n, 20000000n, { gasUsed: toHex(612345n), effectiveGasPrice: toHex(10000000n), gasUsedForL1: toHex(500000n), l1BlockNumber: "0x1" }));
  assert.equal(arbitrum.totalFeeAtomic, "6123450000000"); assert.equal(arbitrum.feeModel, "arbitrum-inclusive");
  // OP stack: execution plus the receipt's L1 data fee plus the Jovian operator fee.
  const base = deriveEvmActualFee(input(8453, 65000n, 2000000000n, { gasUsed: toHex(21000n), effectiveGasPrice: toHex(1000000n), l1Fee: toHex(123456n),
    operatorFeeScalar: toHex(2n), operatorFeeConstant: toHex(7n) }));
  assert.equal(base.executionFeeAtomic, "21000000000"); assert.equal(base.l1DataFeeAtomic, "123456"); assert.equal(base.operatorFeeAtomic, (21000n * 2n * 100n + 7n).toString());
  assert.equal(base.totalFeeAtomic, (21000000000n + 123456n + 4200007n).toString()); assert.equal(base.complete, true);
  for (const fee of [sei, monad, monadToken, polygon, arbitrum, base]) assert.deepEqual(validateEvmActualFee(fee), fee);
});

test("a component the receipt does not prove leaves the fee incomplete, never estimated", () => {
  const cases: readonly [number, Record<string, unknown>, string][] = [
    [8453, { gasUsed: "0x5208", effectiveGasPrice: "0x1" }, "op_l1_fee_unavailable"],
    [8453, { gasUsed: "0x5208", effectiveGasPrice: "0x1", l1Fee: "0x1", operatorFeeScalar: "0x1" }, "op_operator_fee_fields_inconsistent"],
    [8453, { gasUsed: "0x5208", effectiveGasPrice: "0x1", l1Fee: "0x1", operatorFeeScalar: "0x1", operatorFeeConstant: "0x0", operatorFee: "0x9" }, "op_operator_fee_fields_inconsistent"],
    [1, { gasUsed: "0x5208", effectiveGasPrice: "0x1", l1Fee: "0x10" }, "receipt_fee_component_unmodeled"],
    [1, { gasUsed: "0x5208", effectiveGasPrice: "0x1", blobGasUsed: "0x20000" }, "receipt_blob_fee_unmodeled"],
    [1, { effectiveGasPrice: "0x1" }, "receipt_execution_fee_fields_unavailable"],
    [1, { gasUsed: 21000, effectiveGasPrice: "0x1" }, "receipt_fee_field_malformed"],
    [1, { gasUsed: "0x10000000", effectiveGasPrice: "0x1" }, "receipt_fee_fields_contradict_signed_transaction"],
  ];
  for (const [chainId, raw, reason] of cases) {
    const fee = deriveEvmActualFee(input(chainId, 65000n, 2000000000n, raw));
    assert.equal(fee.complete, false, reason); assert.equal(fee.incompleteReason, reason); assert.equal(fee.totalFeeAtomic, null);
    assert.deepEqual(validateEvmActualFee(fee), fee);
  }
  const fee = deriveEvmActualFee(input(1, 65000n, 2000000000n, { gasUsed: "0x5208", effectiveGasPrice: "0x1" }));
  assert.throws(() => validateEvmActualFee({ ...fee, totalFeeAtomic: "1" }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateEvmActualFee({ ...fee, receiptFields: { ...fee.receiptFields, extra: "0x1" } }), { code: "APN_STATE_CORRUPT" });
});

const scenarios = [
  { chainId: 8453, asset: "native", status: "success", raw: { gasUsed: toHex(21000n), effectiveGasPrice: toHex(1000000n), l1Fee: toHex(1000n), operatorFee: "0x0" }, fee: "21000001000" },
  { chainId: 42161, asset: "usdc", status: "success", raw: { gasUsed: toHex(64000n), effectiveGasPrice: toHex(10000000n), gasUsedForL1: toHex(9000n) }, fee: "640000000000" },
  { chainId: 1, asset: "native", status: "reverted", raw: { gasUsed: toHex(30000n), effectiveGasPrice: toHex(1500000000n) }, fee: "45000000000000" },
] as const;
for (const s of scenarios) test(`chain ${s.chainId} ${s.asset} ${s.status}: the actual fee is recorded with the outcome and CLI and MCP status and receipt agree`, async context => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = s.chainId; setup.rpc.receiptStatus = s.status;
  if (s.chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const reader = setup.rpc.evm.receipt;
  setup.rpc.evm.receipt = async (chain, hash) => { const receipt = await reader(chain, hash); return receipt === null ? null : { ...receipt, evmFeeFields: readEvmReceiptFeeFields(s.raw) }; };
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: s.chainId, token: s.asset === "native" ? "native" : EVM_USDC[s.chainId] } }) as { operation_id: string; actual_network_fee: unknown };
  assert.equal(prepared.actual_network_fee, null, "nothing is paid before an outcome is proven");
  const approved = await setup.core.transfer.approve(prepared.operation_id) as Record<string, unknown>;
  assert.equal(approved.state, s.status === "success" ? "completed" : "failed_confirmed_revert");
  const paid = approved.actual_network_fee as Record<string, unknown>;
  assert.equal(paid.status, "complete"); assert.equal(paid.total_atomic, s.fee); assert.equal(paid.chain, `eip155:${s.chainId}`);
  // A completed native transfer debited its value too; a token transfer or a revert debited the fee alone.
  const value = s.asset === "native" && s.status === "success" ? BigInt((approved.amount as { atomic: string }).atomic) : 0n;
  assert.equal(approved.actual_sender_native_debit_atomic, (BigInt(s.fee) + value).toString());
  assert.equal((approved.fee_budget as { max_fee_wei: string }).max_fee_wei, EVM_REQUEST.maxFeeWei, "the cap keeps its own name");
  const server = createMcpServer({ stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); const client = new Client({ name: "qa0551-direct-fee", version: "1" }); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const mcp = async (name: string) => (await client.callTool({ name, arguments: { operation: prepared.operation_id } })).structuredContent as unknown as OutputEnvelope;
  const [cliReceipt, cliStatus, mcpReceipt, mcpStatus] = [await setup.core.execute({ command: "receipt.get", operationId: prepared.operation_id }),
    await setup.core.execute({ command: "operation.status", operationId: prepared.operation_id }), await mcp("apn_receipt_get"), await mcp("apn_operation_status")];
  for (const envelope of [cliReceipt, cliStatus, mcpReceipt, mcpStatus]) assert.equal(envelope.ok, true, JSON.stringify(envelope));
  assert.deepEqual(mcpReceipt.receipt, cliReceipt.receipt); assert.deepEqual(mcpStatus.operation, cliStatus.operation);
  const receipt = cliReceipt.receipt as Record<string, unknown>, status = cliStatus.operation as Record<string, unknown>;
  assert.deepEqual(receipt.actual_network_fee, paid); assert.deepEqual(status.actual_network_fee, paid);
  assert.equal(receipt.actual_sender_native_debit_atomic, approved.actual_sender_native_debit_atomic);
  // Reopen: the stored observation is validated against its own receipt fields and bound to this operation's transaction.
  const stored = (await setup.state.findOperation(prepared.operation_id))!;
  assert.deepEqual(validateOperation(stored), stored);
  const forged = sealOperation((({ integrityHash: _hash, ...body }) => ({ ...body, evmActualFee: { ...stored.evmActualFee!, transactionHash: HASH } }))(stored));
  assert.throws(() => validateOperation(forged), { code: "APN_STATE_CORRUPT" });
});

test("a transfer completed before fee evidence, or by a reader without it, still loads and shows no fee fact", async context => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const approved = await setup.core.transfer.approve(prepared.operation_id) as Record<string, unknown>;
  assert.equal(approved.state, "completed"); assert.equal(approved.actual_network_fee, null); assert.equal(approved.actual_sender_native_debit_atomic, null);
  const receipt = await setup.core.execute({ command: "receipt.get", operationId: prepared.operation_id });
  assert.equal(receipt.ok, true, JSON.stringify(receipt)); assert.equal((receipt.receipt as Record<string, unknown>).actual_network_fee, null);
});
