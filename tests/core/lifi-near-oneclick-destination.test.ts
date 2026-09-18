import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { TRON_TRANSFER_TOPIC, TRON_USDT_HEX, tronHex } from "../../src/tron/codec.js";
import type { TronRpcPort } from "../../src/tron/rpc.js";
import { oneClickDestinationHashes, proveOneClickDestination, type OneClickDestinationInput } from "../../src/lifi/near-oneclick-destination.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
import { blockTime, FakeTron, HOT, quoteTime, SIGNATURE, SOL_RECIPIENT, solanaWorld, SOLVER, transfer, TRON_RECIPIENT, tronWorld } from "./lifi-near-oneclick-fixtures.js";

const input = (lane: string, recipient: string, hashes: readonly string[], rpc: { tron?: TronRpcPort; solana?: SolanaRpcPort }, minimum: string): OneClickDestinationInput => ({
  lane: oneClickLane(lane), recipient, minimumOutputAtomic: minimum, notBeforeMs: quoteTime, hashes,
  tron: () => rpc.tron ?? assert.fail("tron RPC not expected"), solana: () => rpc.solana ?? assert.fail("solana RPC not expected") });

test("provider destination hashes are parsed exactly and stay separate from chain proof", () => {
  const trx = oneClickLane("ethereum-eth-to-tron-trx"), sol = oneClickLane("ethereum-eth-to-solana-sol"), id = "AB".repeat(32);
  assert.deepEqual(oneClickDestinationHashes(trx, { status: "SUCCESS" }), []);
  assert.deepEqual(oneClickDestinationHashes(trx, { swapDetails: { destinationChainTxHashes: [] } }), []);
  assert.deepEqual(oneClickDestinationHashes(trx, { swapDetails: { destinationChainTxHashes: [{ hash: `0x${id}`, explorerUrl: "x" }] } }), ["ab".repeat(32)]);
  assert.throws(() => oneClickDestinationHashes(trx, { swapDetails: { destinationChainTxHashes: [{ hash: "ab" }] } }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => oneClickDestinationHashes(trx, { swapDetails: { destinationChainTxHashes: [{ hash: id }, { hash: id.toLowerCase() }] } }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => oneClickDestinationHashes(sol, { swapDetails: { destinationChainTxHashes: [{ hash: id }] } }), { code: "APN_PROVIDER_PROTOCOL" });
});

test("TRX proof reads one solidified TransferContract with block membership and the exact recipient", async () => {
  const tx = transfer("13300000");
  const proof = await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID], { tron: tronWorld(tx) }, "13202370"));
  assert.equal(proof.status, "finalized"); assert.equal(proof.proofClass, "tron_solidified_trx_transfer");
  assert.equal(proof.creditedAtomic, "13300000"); assert.equal(proof.transactions[0]?.block, "86344166");
  assert.equal(proof.sourceCorrelation, "provider_named_destination_hash");
  // A first transfer may create the recipient account; the creation fee is charged to the sender and does not change the credit.
  const created = await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID],
    { tron: tronWorld(tx, { fee: 1100000, receipt: { net_fee: 100000 } }) }, "13202370"));
  assert.equal(created.status, "finalized"); assert.equal(created.creditedAtomic, "13300000");
  const below = await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID], { tron: tronWorld(tx) }, "13300001"));
  assert.equal(below.status, "unproven"); assert.equal(below.reason, "credited_below_minimum_output");
  const pendingWorld = tronWorld(tx); pendingWorld.responses.set(`walletsolidity/gettransactionbyid:${tx.txID}`, {});
  assert.equal((await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID], { tron: pendingWorld }, "1"))).status, "pending");
});

test("TRX proof rejects wrong recipients, tampered JSON, missing membership, failed results and stale credits", async () => {
  const tx = transfer("13300000");
  const other = transfer("13300000", HOT);
  const tampered = { ...tx, raw_data: { ...tx.raw_data, contract: [{ ...tx.raw_data.contract[0]!, parameter: { ...tx.raw_data.contract[0]!.parameter,
    value: { ...tx.raw_data.contract[0]!.parameter.value, amount: 99_000_000 } } }] } };
  const cases: [string, FakeTron, string][] = [
    ["recipient", tronWorld(other), other.txID], ["tampered", tronWorld(tampered as typeof tx), tx.txID],
    ["membership", tronWorld(tx, {}, [other]), tx.txID], ["failed", tronWorld({ ...tx, ret: [{ contractRet: "REVERT" }] }), tx.txID],
    ["internal", tronWorld(tx, { internal_transactions: [{ hash: "00" }] }), tx.txID],
  ];
  for (const [name, world, id] of cases) {
    const proof = await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [id], { tron: world }, "1"));
    assert.equal(proof.status, "unproven", name); assert.equal(proof.creditedAtomic, "0", name);
  }
  const stale = await proveOneClickDestination({ ...input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID], { tron: tronWorld(tx) }, "1"), notBeforeMs: blockTime + 1 });
  assert.equal(stale.status, "unproven");
  const none = await proveOneClickDestination(input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [], {}, "1"));
  assert.equal(none.status, "awaiting_provider_destination_hash");
  await assert.rejects(proveOneClickDestination({ ...input("ethereum-eth-to-tron-trx", TRON_RECIPIENT, [tx.txID], {}, "1"),
    tron: () => { throw new ApnError("APN_RPC_CONFIG", "missing"); } }), { code: "APN_RPC_CONFIG" });
});

test("ETH to TRON USDT reuses the solidified TRC20 log parser with block membership", async () => {
  const tx = transfer("3170000", TRON_RECIPIENT, true);
  const log = { address: TRON_USDT_HEX.slice(2), topics: [TRON_TRANSFER_TOPIC, `${"0".repeat(24)}${tronHex(HOT).slice(2)}`,
    `${"0".repeat(24)}${tronHex(TRON_RECIPIENT).slice(2)}`], data: (3170000).toString(16).padStart(64, "0") };
  const world = tronWorld(tx, { contract_address: TRON_USDT_HEX, receipt: { energy_usage_total: 130285, net_usage: 345, result: "SUCCESS" }, log: [log] });
  const proof = await proveOneClickDestination(input("ethereum-eth-to-tron-usdt", TRON_RECIPIENT, [tx.txID], { tron: world }, "3166766"));
  assert.equal(proof.status, "finalized"); assert.equal(proof.proofClass, "tron_solidified_usdt_transfer"); assert.equal(proof.creditedAtomic, "3170000");
});

test("SOL proof is the finalized balance delta of the recipient inside the named transaction", async () => {
  const lane = "ethereum-eth-to-solana-sol";
  const proof = await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000) }, "46367046"));
  assert.equal(proof.status, "finalized"); assert.equal(proof.proofClass, "solana_finalized_sol_balance_delta");
  assert.equal(proof.creditedAtomic, "46500000"); assert.equal(proof.transactions[0]?.block, "390");
  // Version 0 messages arrive as lossless bigint fields from the live reader.
  assert.equal((await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000, { v0: true }) }, "46367046"))).status, "finalized");
  assert.equal((await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_000_000) }, "46367046"))).reason, "credited_below_minimum_output");
  assert.equal((await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000, { status: null }) }, "1"))).status, "pending");
  assert.equal((await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000, { status: { confirmationStatus: "confirmed" } }) }, "1"))).status, "pending");
  for (const changes of [{ meta: { err: { InstructionError: [0, "Custom"] } } }, { keys: [SOLVER, "Vote111111111111111111111111111111111111111", "11111111111111111111111111111111"] },
    { status: { err: { InstructionError: [0, "Custom"] } } }]) {
    const rejected = await proveOneClickDestination(input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000, changes) }, "1"));
    assert.equal(rejected.status, "unproven"); assert.equal(rejected.creditedAtomic, "0");
  }
  const stale = await proveOneClickDestination({ ...input(lane, SOL_RECIPIENT, [SIGNATURE], { solana: solanaWorld(46_500_000) }, "1"), notBeforeMs: blockTime + 1000 });
  assert.equal(stale.status, "unproven");
});
