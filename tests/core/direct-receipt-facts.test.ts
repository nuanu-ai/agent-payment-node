/**
 * QA 0.5.51 follow-up: direct transfers completed by 0.5.51 (Sei USDC ca0c90b1…, Monad native 61fb4793…) have no fee in
 * their sealed records. Status and receipt read the transfer's own receipt once through the chain's configured RPC, bound
 * to the stored hash and the block the record proved, keep the fee in a sidecar bound to the record, and read nothing more.
 * The receipts are the QA captures; only the identity fields our harness signed (hash, block) are rebound to them.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { directFeeFromReceipt } from "../../src/direct-receipt-facts.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { ApnError } from "../../src/errors.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, evmCore } from "./evm-helpers.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const fixture = async (name: string) => JSON.parse(await readFile(`tests/fixtures/qa0551/${name}`, "utf8")) as Record<string, any>;
const cases = [
  { name: "Sei USDC ca0c90b1", file: "direct-sei-usdc-ca0c90b1.json", chainId: 1329 as const, token: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392" as const,
    amount: "0.01", fee: "5821497000000000", maxFeeWei: "20000000000000000" },
  { name: "Monad native 61fb4793", file: "direct-monad-native-61fb4793.json", chainId: 143 as const, token: "native" as const,
    amount: "0.1", fee: "2142000000000000", maxFeeWei: "5000000000000000" },
] as const;

test("the captured receipts give the exact fee by each network's rule, bound to what the record proved", async () => {
  const sei = await fixture("direct-sei-usdc-ca0c90b1.json");
  const operation = { state: "completed", chainId: 1329, transactionHash: sei.receipt.transactionHash, economics: { gasLimitAtomic: BigInt(sei.transaction.gas).toString(),
    maxFeePerGasAtomic: BigInt(sei.transaction.maxFeePerGas).toString() } } as never;
  const receipt = { blockNumberAtomic: BigInt(sei.receipt.blockNumber).toString(), evmEvidence: { blockHash: sei.receipt.blockHash } } as never;
  const fee = directFeeFromReceipt(operation, receipt, sei.receipt);
  assert.equal(fee.totalFeeAtomic, "5821497000000000"); assert.equal(fee.feeModel, "eip1559"); assert.equal(fee.gasBilledAtomic, "114147");
  for (const changed of [{ blockHash: `0x${"1".repeat(64)}` }, { blockNumber: "0x1" }, { status: "0x0" }, { transactionHash: `0x${"2".repeat(64)}` }]) {
    assert.throws(() => directFeeFromReceipt(operation, receipt, { ...sei.receipt, ...changed }), { code: "APN_RPC_PROTOCOL" });
  }
});

for (const c of cases) test(`${c.name}: a 0.5.51 record answers status and receipt with its actual fee after one receipt read, then none`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const captured = await fixture(c.file), setup = evmCore(temporary.root);
  setup.rpc.chainId = c.chainId; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; setup.rpc.receiptFeeFields = null;
  setup.rpc.fees = { gasLimitAtomic: BigInt(captured.transaction.gas).toString(), maxFeePerGasAtomic: BigInt(captured.transaction.maxFeePerGas).toString(),
    maxPriorityFeePerGasAtomic: BigInt(captured.transaction.maxPriorityFeePerGas).toString() };
  const wallet = await setup.core.wallet.ensure("default") as { address: `0x${string}` }; setup.rpc.sender = wallet.address;
  await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address }, now: setup.clock.now(),
    admissions: [directAdmission(`eip155:${c.chainId}`, c.token === "native" ? null : c.token)] });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: c.chainId, token: c.token }, amount: c.amount,
    maxFeeWei: c.maxFeeWei, idempotencyKey: `qa0551-${c.chainId}` }) as { operation_id: string };
  // The harness receipt carries no fee fields: this completes the transfer exactly as 0.5.51 recorded it.
  const completed = await setup.core.transfer.approve(prepared.operation_id) as Record<string, unknown>;
  assert.equal(completed.state, "completed"); assert.equal(completed.actual_network_fee, null);
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const reads: string[] = []; let configured = false;
  const chain: FinalizedChainRead = { async call(method, params) {
    reads.push(method);
    if (method === "eth_chainId") return `0x${c.chainId.toString(16)}`;
    if (method === "eth_getTransactionReceipt" && params[0] === operation.transactionHash) {
      return { ...captured.receipt, transactionHash: operation.transactionHash, blockHash: EVM_BLOCK_HASH, blockNumber: "0x303a",
        logs: (captured.receipt.logs as Record<string, unknown>[]).map(log => ({ ...log, transactionHash: operation.transactionHash, blockHash: EVM_BLOCK_HASH, blockNumber: "0x303a" })) };
    }
    throw new Error(`unexpected ${method}`);
  } };
  const core = new ApnCore({ state: setup.state, rpc: setup.rpc, native: setup.local, clock: setup.clock, finalizedRead: chainId => {
    assert.equal(chainId, c.chainId);
    if (!configured) throw new ApnError("APN_RPC_CONFIG", "Set the chain's RPC.", { reason: "finalized_read_rpc_required" });
    return chain;
  } });
  // No setting: the status still answers, the fee stays null and the refusal names the read.
  const refused = await core.execute({ command: "operation.status", operationId: prepared.operation_id });
  assert.equal(refused.ok, true, JSON.stringify(refused));
  assert.equal((refused.operation as Record<string, unknown>).actual_network_fee, null);
  assert.deepEqual((refused.operation as { actual_facts_refusal: { reason: string } }).actual_facts_refusal.reason, "receipt_facts_rpc_required");
  configured = true;
  const status = await core.execute({ command: "operation.status", operationId: prepared.operation_id });
  const fee = (status.operation as { actual_network_fee: { status: string; total_atomic: string } }).actual_network_fee;
  assert.equal(fee.status, "complete"); assert.equal(fee.total_atomic, c.fee);
  assert.deepEqual(reads, ["eth_chainId", "eth_getTransactionReceipt"]);
  const receipt = await core.execute({ command: "receipt.get", operationId: prepared.operation_id });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.deepEqual((receipt.receipt as Record<string, unknown>).actual_network_fee, (status.operation as Record<string, unknown>).actual_network_fee);
  assert.equal(reads.length, 2, "the sidecar answers every later status and receipt");
  // The sealed record is untouched.
  assert.deepEqual(await setup.state.findOperation(prepared.operation_id), operation);
});
