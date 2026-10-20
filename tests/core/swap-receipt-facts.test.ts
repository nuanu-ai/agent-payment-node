/**
 * QA 0.5.51 follow-up: swaps finalized by 0.5.51 have no economics in their sealed records. Status reads the swap's own
 * finalized transaction once (bound to the record's proven hash), keeps the facts in a sidecar bound to the record's
 * integrity hash, and reads no RPC afterwards. The records and transactions are the QA captures of Uniswap 30448bcb…,
 * SunSwap 1693a1ba… and Orca 5e805839…; nothing is paid again.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { validateSwapOperation, type SwapOperationRecord, type SwapReceiptEconomics } from "../../src/swap/model.js";
import { swapActualEconomics } from "../../src/swap/receipt-facts.js";
import { uniswapEconomicsFromReceipt } from "../../src/swap/uniswap-receipt-facts.js";
import { UniswapEthereumReceiptObserver } from "../../src/swap/uniswap-ethereum/execution/observer.js";
import { sunSwapEconomicsFromSolidified } from "../../src/swap/sunswap-tron/outcome.js";
import { orcaEconomicsFromTransaction } from "../../src/swap/orca-solana/receipt-facts.js";
import { associatedTokenAddress } from "../../src/swap/orca-solana/accounts.js";
import { ORCA_SOL_VAULT, TOKEN_PROGRAM, USDC_MINT, WSOL_MINT } from "../../src/swap/orca-solana/pins.js";
import { temporaryState } from "./helpers.js";

const fixture = async (name: string) => JSON.parse(await readFile(`tests/fixtures/qa0551/${name}`, "utf8")) as Record<string, any>;
const now = new Date("2026-10-20T12:00:00.000Z");

test("Uniswap 30448bcb: the captured receipt proves input 10000000000000 wei, output 24364 USDC atoms and fee 5442759839880 wei", async () => {
  const f = await fixture("uniswap-eth-usdc-30448bcb.json"), record = validateSwapOperation(f.record);
  assert.equal(record.receiptProof?.economics, undefined, "0.5.51 sealed it without economics");
  const expected: SwapReceiptEconomics = { inputAtomic: "10000000000000", outputAtomic: "24364", networkFeeAtomic: "5442759839880",
    nativeDebitAtomic: (10_000_000_000_000n + 5_442_759_839_880n).toString() };
  assert.deepEqual(uniswapEconomicsFromReceipt(record, f.receipt, f.finalizedHead), expected);
  // The observer's one read: the chain id, then the receipt and the finalized head, nothing at an old block.
  const calls: string[] = [];
  const observer = new UniswapEthereumReceiptObserver(async (method, params) => {
    calls.push(`${method}:${JSON.stringify(params[0] ?? null)}`);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionReceipt") return f.receipt;
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") return { ...f.finalizedHead };
    throw new Error(`unexpected ${method}`);
  });
  assert.deepEqual(await observer.receiptEconomics(record), expected);
  assert.deepEqual(calls.sort(), ["eth_chainId:null", `eth_getBlockByNumber:"finalized"`, `eth_getTransactionReceipt:"${record.receiptProof!.transactionHash}"`]);
  // Bound to what the record proved: another account, an unfinalized block or another outcome is refused.
  for (const receipt of [{ ...f.receipt, from: "0x0000000000000000000000000000000000000001" }, { ...f.receipt, status: "0x0" }]) {
    assert.throws(() => uniswapEconomicsFromReceipt(record, receipt, f.finalizedHead), { code: "APN_RPC_PROTOCOL" });
  }
  assert.throws(() => uniswapEconomicsFromReceipt(record, f.receipt, { number: "0x1" }), { code: "APN_RPC_PROTOCOL" });
});

test("SunSwap 1693a1ba: the solidified record proves input 100000 SUN, output 33194 USDT atoms, fee 16246400 SUN", async () => {
  const f = await fixture("sunswap-trx-usdt-1693a1ba.json"), record = validateSwapOperation(f.record);
  // The frozen bandwidth budget lives in the prepared material, which the packet does not carry; it bounds 511000 SUN burned.
  const expected = { transactionHash: f.transaction.txID, recipient: record.quote.recipient, inputAmountAtomic: record.quote.inputAmountAtomic,
    minimumOutputAtomic: record.quote.minimumOutputAtomic, unsignedRawDataHex: f.transaction.raw_data_hex,
    maximumFeeSun: String(f.transaction.raw_data.fee_limit), maximumBandwidthFeeSun: "600000" };
  assert.deepEqual(sunSwapEconomicsFromSolidified(record.state, f.transaction, f.info, String(f.solidifiedHead), expected),
    { inputAtomic: "100000", outputAtomic: "33194", networkFeeAtomic: "16246400", nativeDebitAtomic: "16346400" });
  assert.throws(() => sunSwapEconomicsFromSolidified("failed_confirmed_revert", f.transaction, f.info, String(f.solidifiedHead), expected), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => sunSwapEconomicsFromSolidified(record.state, f.transaction, f.info, String(f.info.blockNumber - 1), expected));
});

test("Orca 5e805839: the finalized transaction proves input 20000 lamports, output 2095 USDC atoms, fee 5300, rent 1488440", async () => {
  const f = await fixture("orca-sol-usdc-5e805839.json"), record = validateSwapOperation(f.record);
  const accounts = { owner: record.quote.account, native: true, input: ORCA_SOL_VAULT, mintA: WSOL_MINT, decimalsA: 9, mintB: USDC_MINT, decimalsB: 6,
    destination: await associatedTokenAddress(record.quote.account, USDC_MINT, TOKEN_PROGRAM) };
  assert.deepEqual(orcaEconomicsFromTransaction(record, accounts, f.transaction),
    { inputAtomic: "20000", outputAtomic: "2095", networkFeeAtomic: "5300", nativeDebitAtomic: "1513740", accountRentAtomic: "1488440" });
  const other = structuredClone(f.transaction); other.transaction.signatures = ["1".repeat(88)];
  assert.throws(() => orcaEconomicsFromTransaction(record, accounts, other), { code: "APN_RPC_PROTOCOL" });
});

test("status keeps the facts in a sidecar bound to the record: one read, then none; a missing RPC setting is a named refusal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await fixture("uniswap-eth-usdc-30448bcb.json"), record: SwapOperationRecord = validateSwapOperation(f.record);
  const refused = await swapActualEconomics(temporary.root, record, async () => { throw new ApnError("APN_RPC_CONFIG", "Set APN_ETHEREUM_RPC_URL."); }, now);
  assert.deepEqual(refused, { actualEconomics: null, actualFactsRefusal: { code: "APN_RPC_CONFIG", reason: "receipt_facts_rpc_required", message: "Set APN_ETHEREUM_RPC_URL." } });
  let reads = 0;
  const read = async () => { reads += 1; return uniswapEconomicsFromReceipt(record, f.receipt, f.finalizedHead); };
  const first = await swapActualEconomics(temporary.root, record, read, now), second = await swapActualEconomics(temporary.root, record, read, now);
  assert.equal(reads, 1, "later status reads the sidecar, not the chain");
  assert.deepEqual(first, second); assert.equal(first.actualEconomicsSource, "receipt_facts"); assert.equal(first.actualEconomics?.outputAtomic, "24364");
  // The sidecar is bound to this exact record: another integrity hash, or a changed fact, is refused, never shown.
  const other = { ...record, integrityHash: "f".repeat(64) };
  assert.equal((await swapActualEconomics(temporary.root, other, read, now)).actualFactsRefusal?.reason, "receipt_facts_state_invalid");
  const path = join(temporary.root, "receipt-facts", `${record.operationId}.swap.json`), stored = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...stored, economics: { ...stored.economics, outputAtomic: "99999" } }));
  const tampered = await swapActualEconomics(temporary.root, record, read, now);
  assert.equal(tampered.actualEconomics, null); assert.equal(tampered.actualFactsRefusal?.reason, "receipt_facts_state_invalid"); assert.equal(reads, 1);
  // A record that carries its economics answers from its own proof.
  const recorded = { ...record, receiptProof: { ...record.receiptProof!, economics: first.actualEconomics! } };
  assert.deepEqual(await swapActualEconomics(temporary.root, recorded, read, now), { actualEconomics: first.actualEconomics, actualEconomicsSource: "receipt_proof" });
});
