/**
 * QA 0.5.52 DIRECT-BASE-RECEIPT-FEE-052-001: the completed Base USDC transfer ebe647… (tx 0x3f6e7f33…, block 52809368)
 * showed `actual_network_fee.status=incomplete`, reason `receipt_blob_fee_unmodeled`, because its OP-stack (Jovian) receipt
 * carries the DA footprint as `blobGasUsed` (14800) with no `blobGasPrice`. That is block-limit metadata, not a charge: the
 * fee is execution 270354000000 + L1 442851329 + operator 0 = 270796851329 wei. The receipt and the fee 0.5.52 stored from
 * it are the QA captures; only the identity fields our harness signed (hash, block) are rebound to them.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { DirectReceiptFactsStore, directFeeFromReceipt } from "../../src/direct-receipt-facts.js";
import { deriveEvmActualFee, publicEvmActualFee, readEvmReceiptFeeFields, validateEvmActualFee, type EvmActualFee } from "../../src/evm-direct-actual-fee.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { testRuntime } from "./installed-runtime.js";

const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const captured = JSON.parse(await readFile("tests/fixtures/qa0552/direct-base-usdc-ebe647.json", "utf8")) as {
  receipt: Record<string, unknown> & { transactionHash: string; blockNumber: string; blockHash: string };
  transaction: { gas: string; maxFeePerGas: string }; stored052Fee: EvmActualFee;
  expected: { executionFeeWei: string; l1DataFeeWei: string; operatorFeeWei: string; totalFeeWei: string };
};
const GAS_LIMIT = BigInt(captured.transaction.gas).toString(), MAX_FEE = BigInt(captured.transaction.maxFeePerGas).toString();

test("the captured Base receipt gives execution + L1 + operator with or without its DA field, and 0.5.52's stored reading shows it", () => {
  const operation = { state: "completed", chainId: 8453, transactionHash: captured.receipt.transactionHash,
    economics: { gasLimitAtomic: GAS_LIMIT, maxFeePerGasAtomic: MAX_FEE } } as never;
  const receipt = { blockNumberAtomic: BigInt(captured.receipt.blockNumber).toString(), evmEvidence: { blockHash: captured.receipt.blockHash } } as never;
  const { blobGasUsed: _da, daFootprintGasScalar: _scalar, ...withoutDa } = captured.receipt;
  for (const raw of [captured.receipt, withoutDa]) {
    const fee = directFeeFromReceipt(operation, receipt, raw);
    assert.equal(fee.complete, true); assert.equal(fee.feeModel, "op-stack"); assert.equal(fee.incompleteReason, null);
    assert.equal(fee.executionFeeAtomic, captured.expected.executionFeeWei); assert.equal(fee.l1DataFeeAtomic, captured.expected.l1DataFeeWei);
    assert.equal(fee.operatorFeeAtomic, captured.expected.operatorFeeWei); assert.equal(fee.totalFeeAtomic, captured.expected.totalFeeWei);
    assert.equal(fee.gasBilledAtomic, "45059"); assert.deepEqual(validateEvmActualFee(fee), fee);
  }
  // The exact fee 0.5.52 stored loads (it is that rule's reading of these fields) and reads by the corrected rule.
  const stored = captured.stored052Fee;
  assert.equal(stored.incompleteReason, "receipt_blob_fee_unmodeled");
  const current = validateEvmActualFee(stored);
  assert.equal(current.complete, true); assert.equal(current.totalFeeAtomic, captured.expected.totalFeeWei);
  assert.deepEqual(current.receiptFields, stored.receiptFields, "the same receipt fields, nothing added");
  const shown = publicEvmActualFee(stored, { kind: "erc20" }, "10000000", "completed"), paid = shown.actual_network_fee!;
  assert.equal(paid.status, "complete"); assert.equal(paid.total_atomic, captured.expected.totalFeeWei);
  assert.equal(paid.l1_data_atomic, captured.expected.l1DataFeeWei); assert.equal(paid.operator_atomic, "0");
  assert.equal(paid.effective_gas_price_atomic, "6000000");
  assert.equal(shown.actual_sender_native_debit_atomic, captured.expected.totalFeeWei, "a token transfer debits the fee alone");
});

test("a real blob charge, or a blob field where no DA footprint exists, stays incomplete; forgeries stay corrupt", () => {
  const input = (chainId: number, raw: Record<string, unknown>) => ({ chainId, transactionHash: `0x${"ab".repeat(32)}` as const, blockNumberAtomic: "100",
    gasLimitAtomic: "65000", maxFeePerGasAtomic: "2000000000", receiptFields: readEvmReceiptFeeFields(raw) });
  const execution = { gasUsed: "0x5208", effectiveGasPrice: "0x1" };
  const cases: readonly [number, "eip1559" | "op-stack" | "arbitrum-inclusive" | "monad-gas-limit", Record<string, unknown>][] = [
    [8453, "op-stack", { ...execution, l1Fee: "0x10", blobGasUsed: "0x20000", blobGasPrice: "0x3" }],
    [10, "op-stack", { ...execution, l1Fee: "0x10", blobGasUsed: "0x20000", blobGasPrice: "0x1" }],
    [1, "eip1559", { ...execution, blobGasUsed: "0x20000" }],
    [1, "eip1559", { ...execution, blobGasUsed: "0x20000", blobGasPrice: "0x1" }],
    [42161, "arbitrum-inclusive", { ...execution, blobGasUsed: "0x20000" }],
    [143, "monad-gas-limit", { ...execution, blobGasUsed: "0x20000" }],
  ];
  for (const [chainId, model, raw] of cases) {
    const fee = deriveEvmActualFee(input(chainId, raw), model);
    assert.equal(fee.complete, false, `${chainId}`); assert.equal(fee.incompleteReason, "receipt_blob_fee_unmodeled"); assert.equal(fee.totalFeeAtomic, null);
    assert.deepEqual(validateEvmActualFee(fee), fee);
  }
  // The DA footprint never hides a missing L1 fee or an inconsistent operator fee.
  assert.equal(deriveEvmActualFee(input(8453, { ...execution, blobGasUsed: "0x39d0" }), "op-stack").incompleteReason, "op_l1_fee_unavailable");
  assert.equal(deriveEvmActualFee(input(8453, { ...execution, l1Fee: "0x1", blobGasUsed: "0x39d0", operatorFeeScalar: "0x1" }), "op-stack").incompleteReason,
    "op_operator_fee_fields_inconsistent");
  const daOnly = deriveEvmActualFee(input(130, { ...execution, l1Fee: "0x10", blobGasUsed: "0x39d0", blobGasPrice: "0x0" }), "op-stack");
  assert.equal(daOnly.totalFeeAtomic, (21000n + 16n).toString(), "a zero blob price charges nothing beside the DA footprint");
  // Only 0.5.52's own reading of these same fields is accepted besides the current one; anything else is corrupt.
  const stored = captured.stored052Fee;
  const { blobGasUsed: _da, ...fieldsWithoutDa } = stored.receiptFields;
  for (const forged of [{ ...stored, totalFeeAtomic: "1" }, { ...stored, receiptFields: fieldsWithoutDa },
    { ...stored, incompleteReason: "op_l1_fee_unavailable" }, { ...stored, receiptFields: { ...stored.receiptFields, l1Fee: "0x1" }, complete: true }]) {
    assert.throws(() => validateEvmActualFee(forged), { code: "APN_STATE_CORRUPT" });
  }
});

test("ebe647 shape: a 0.5.51 Base USDC record with the 0.5.52 sidecar answers status and receipt with its fee, CLI and MCP alike, no RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 8453; setup.rpc.receiptFeeFields = null;
  setup.rpc.fees = { gasLimitAtomic: GAS_LIMIT, maxFeePerGasAtomic: MAX_FEE, maxPriorityFeePerGasAtomic: "1000000" };
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] }, amount: "10",
    idempotencyKey: "qa0552-base-usdc" }) as { operation_id: string };
  // The harness receipt carries no fee fields: this completes the transfer exactly as 0.5.51 recorded it.
  const completed = await setup.core.transfer.approve(prepared.operation_id) as Record<string, unknown>;
  assert.equal(completed.state, "completed"); assert.equal(completed.actual_network_fee, null);
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const receiptRecord = (await setup.state.loadReceipt(operation.profileHash, operation.operationId))!;
  // 0.5.52's status read this receipt once and kept its reading in the sidecar: the captured fee, bound to this record.
  const sidecar052 = { ...captured.stored052Fee, transactionHash: operation.transactionHash!.toLowerCase() as `0x${string}`,
    blockNumberAtomic: receiptRecord.blockNumberAtomic! };
  await new DirectReceiptFactsStore(temporary.root).create(operation, sidecar052, new Date().toISOString());
  const sidecarPath = join(temporary.root, "receipt-facts", `${operation.operationId}.direct.json`), sidecarBytes = await readFile(sidecarPath);
  const reads: string[] = [];
  const core = new ApnCore({ state: setup.state, rpc: setup.rpc, native: setup.local, clock: setup.clock,
    finalizedRead: () => ({ async call(method) { reads.push(method); throw new Error(`no RPC expected: ${method}`); } }) });
  const server = createMcpServer({ stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); const client = new Client({ name: "qa0552-base-fee", version: "1" }); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const mcp = async (name: string) => (await client.callTool({ name, arguments: { operation: prepared.operation_id } })).structuredContent as unknown as OutputEnvelope;
  const [cliStatus, cliReceipt, mcpStatus, mcpReceipt] = [await core.execute({ command: "operation.status", operationId: prepared.operation_id }),
    await core.execute({ command: "receipt.get", operationId: prepared.operation_id }), await mcp("apn_operation_status"), await mcp("apn_receipt_get")];
  for (const envelope of [cliStatus, cliReceipt, mcpStatus, mcpReceipt]) assert.equal(envelope.ok, true, JSON.stringify(envelope));
  assert.deepEqual(mcpStatus.operation, cliStatus.operation); assert.deepEqual(mcpReceipt.receipt, cliReceipt.receipt);
  const status = cliStatus.operation as Record<string, unknown>, fee = status.actual_network_fee as Record<string, unknown>;
  assert.deepEqual(fee, { status: "complete", chain: "eip155:8453", unit: "ETH", decimals: 18, fee_model: "op-stack",
    total_atomic: captured.expected.totalFeeWei, execution_atomic: captured.expected.executionFeeWei, l1_data_atomic: captured.expected.l1DataFeeWei,
    operator_atomic: "0", gas_billed_atomic: "45059", effective_gas_price_atomic: "6000000", incomplete_reason: null,
    transaction_hash: operation.transactionHash!.toLowerCase(), block_number_atomic: receiptRecord.blockNumberAtomic });
  assert.equal(status.actual_sender_native_debit_atomic, captured.expected.totalFeeWei); assert.equal(status.actual_facts_refusal, undefined);
  assert.deepEqual((cliReceipt.receipt as Record<string, unknown>).actual_network_fee, fee);
  assert.deepEqual(reads, [], "the sidecar's own receipt fields answer; nothing is read again");
  // Nothing was rewritten: the sealed record and the create-only sidecar keep their bytes.
  assert.deepEqual(await setup.state.findOperation(prepared.operation_id), operation);
  assert.deepEqual(await readFile(sidecarPath), sidecarBytes);
});

test("a Base transfer with no sidecar yet reads its receipt once and keeps the complete fee", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 8453; setup.rpc.receiptFeeFields = null;
  setup.rpc.fees = { gasLimitAtomic: GAS_LIMIT, maxFeePerGasAtomic: MAX_FEE, maxPriorityFeePerGasAtomic: "1000000" };
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] }, amount: "10",
    idempotencyKey: "qa0552-base-usdc-fresh" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
  const operation = (await setup.state.findOperation(prepared.operation_id))!, reads: string[] = [];
  const rebound = { ...captured.receipt, transactionHash: operation.transactionHash, blockHash: `0x${"b".repeat(64)}`, blockNumber: "0x303a" };
  const core = new ApnCore({ state: setup.state, rpc: setup.rpc, native: setup.local, clock: setup.clock, finalizedRead: () => ({ async call(method, params) {
    reads.push(method);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getTransactionReceipt" && params[0] === operation.transactionHash) return rebound;
    throw new Error(`unexpected ${method}`);
  } }) });
  for (let i = 0; i < 2; i++) {
    const status = await core.execute({ command: "operation.status", operationId: prepared.operation_id });
    const fee = (status.operation as { actual_network_fee: { status: string; total_atomic: string } }).actual_network_fee;
    assert.equal(fee.status, "complete"); assert.equal(fee.total_atomic, captured.expected.totalFeeWei);
  }
  assert.deepEqual(reads, ["eth_chainId", "eth_getTransactionReceipt"]);
});
