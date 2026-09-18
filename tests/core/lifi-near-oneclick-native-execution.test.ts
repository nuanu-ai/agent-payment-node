import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { SolanaRpc } from "../../src/solana/rpc.js";
import { TronRpc } from "../../src/tron/rpc.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { OneClickSourceJournal } from "../../src/lifi/near-oneclick-source-journal.js";
import { OneClickSourceService, TtyOneClickSourceApproval } from "../../src/lifi/near-oneclick-source-service.js";
import { temporaryState } from "./helpers.js";
import { SIGNATURE, SOL_RECIPIENT, solanaWorld, transfer, TRON_RECIPIENT, tronWorld } from "./lifi-near-oneclick-fixtures.js";

const key = `0x${"1".repeat(64)}` as const, payer = privateKeyToAccount(key).address;
const deposit = "0x76b4c56085ED136a8744D52bE956396624a730E8";
const SAFE = `0x${"a".repeat(64)}`, LATEST = `0x${"b".repeat(64)}`, MINED = `0x${"c".repeat(64)}`;
const hex = (n: bigint) => `0x${n.toString(16)}`;
const trxRequest = { lane: "ethereum-eth-to-tron-trx", profile: "imported", expectedPayer: payer, recipient: TRON_RECIPIENT,
  amountAtomic: "2000000000000000", minOutputAtomic: "13000000", maxQuotedLossAtomic: "200000", maxGasLimitAtomic: "60000",
  maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "2000000000", maxNativeDebitWei: "2600000000000000", idempotencyKey: "trx-fund-test-1" };
const solRequest = { ...trxRequest, lane: "ethereum-eth-to-solana-sol", recipient: SOL_RECIPIENT, minOutputAtomic: "46000000",
  maxQuotedLossAtomic: "500000", idempotencyKey: "sol-fund-test-1" };
interface World { code: string; estimate: bigint; balance: bigint; sendAmbiguous: boolean; destinationHashes: string[]; providerStatus: string }

async function harness(t: import("node:test").TestContext, changes: Partial<World> = {}) {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const state = new StateStore(tmp.root), wrapping = { async load() { return Buffer.alloc(32, 7); }, async create() { return Buffer.alloc(32, 7); } };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew("imported", key, payer);
  const world: World = { code: "0x", estimate: 30_000n, balance: 21_200_000_000_000_000n, sendAmbiguous: false, destinationHashes: [],
    providerStatus: "SUCCESS", ...changes };
  const methods: string[] = [], sent: `0x${string}`[] = [];
  let approvals = 0, actualQuote: unknown, transactionHash: string | null = null;
  t.mock.method(TtyOneClickSourceApproval.prototype, "approve", async () => { approvals++; });
  t.mock.method(BridgeHttps.prototype, "request", async (endpoint: string, verb: string, body: string | null) => {
    if (endpoint === "https://1click.chaindefuser.com/v0/quote") {
      const quoteRequest = JSON.parse(body!), sol = quoteRequest.destinationAsset === "nep141:sol.omft.near";
      const quote = { amountIn: quoteRequest.amount, minAmountIn: quoteRequest.amount, amountOut: sol ? "46835401" : "13335728",
        minAmountOut: sol ? "46367046" : "13202370", deadline: new Date(Date.now() + 86_400_000).toISOString(),
        ...(quoteRequest.dry ? {} : { depositAddress: deposit, depositMemo: null }) };
      const response = { timestamp: new Date().toISOString(), signature: `ed25519:${"a".repeat(80)}`, quoteRequest, quote };
      if (!quoteRequest.dry) actualQuote = response;
      return { status: 201, body: JSON.stringify(response) };
    }
    if (endpoint.startsWith("https://1click.chaindefuser.com/v0/status")) return { status: 200, body: JSON.stringify({ quoteResponse: actualQuote,
      status: world.providerStatus, swapDetails: { destinationChainTxHashes: world.destinationHashes.map(hash => ({ hash, explorerUrl: "https://explorer.example" })) } }) };
    assert.equal(endpoint, "https://ethereum.example.org/"); assert.equal(verb, "POST");
    const { method, params, id } = JSON.parse(body!); methods.push(method);
    const reply = (result: unknown) => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result }) });
    if (method === "eth_sendRawTransaction") {
      sent.push(params[0]); transactionHash = keccak256(params[0]);
      if (world.sendAmbiguous) throw Error("ambiguous send");
      return reply(transactionHash);
    }
    if (method === "eth_getTransactionReceipt") return reply({ transactionHash, to: deposit, from: payer, blockNumber: "0xfff", blockHash: MINED,
      transactionIndex: "0x0", status: "0x1", logs: [] });
    if (method === "eth_getBlockByNumber") {
      const tag = params[0];
      return reply(tag === "safe" ? { number: "0x1000", hash: SAFE, baseFeePerGas: "0x3b9aca00" } : tag === "latest"
        ? { number: "0x1010", hash: LATEST, baseFeePerGas: "0x3b9aca00" } : tag === "0x1000" ? { number: "0x1000", hash: SAFE, transactions: [] }
        : { number: "0xfff", hash: MINED, transactions: [transactionHash] });
    }
    return reply(method === "eth_chainId" ? "0x1" : method === "eth_getCode" ? world.code : method === "eth_getBalance" ? hex(world.balance)
      : method === "eth_getTransactionCount" ? "0x4" : method === "eth_maxPriorityFeePerGas" ? "0x5f5e100"
        : method === "eth_estimateGas" ? hex(world.estimate) : assert.fail(`unexpected ${method}`));
  });
  const environment = { APN_ETHEREUM_RPC_URL: "https://ethereum.example.org/", APN_TRON_RPC_URL: "https://tron.example.org",
    APN_SOLANA_RPC_URL: "https://solana.example.org" };
  return { world, state, methods, sent, approvals: () => approvals, journal: new OneClickSourceJournal(state.root),
    service: new OneClickSourceService(state, wrapping, environment) };
}

test("ETH to TRX signs one plain value transfer of exactly amountIn to an EOA deposit with 21000 gas", async t => {
  const h = await harness(t);
  const result = await h.service.submit(trxRequest) as Record<string, unknown>;
  assert.equal(result.sourceState, "submitted_pending"); assert.equal(result.lane, "ethereum-eth-to-tron-trx");
  assert.equal(result.destinationDelivered, false); assert.equal(h.sent.length, 1); assert.equal(h.approvals(), 1);
  const tx = parseTransaction(h.sent[0]!);
  assert.equal(tx.chainId, 1); assert.equal(tx.to?.toLowerCase(), deposit.toLowerCase()); assert.equal(tx.value, 2_000_000_000_000_000n);
  assert.equal(tx.data, undefined); assert.equal(tx.gas, 21_000n); assert.equal(tx.nonce, 4);
  assert.equal(tx.maxFeePerGas, 2_100_000_000n); assert.equal(tx.maxPriorityFeePerGas, 100_000_000n);
  assert.equal(h.methods.includes("eth_estimateGas"), false);
  const record = await h.journal.load(result.operationId as string);
  assert.equal(record?.schemaVersion, "apn.oneclick-source.v3"); assert.equal(record?.depositCode, "eoa");
  assert.deepEqual([record?.sourceCall.to, record?.sourceCall.data, record?.sourceCall.value], [deposit, "0x", "2000000000000000"]);
  assert.equal(record?.rawTransaction, h.sent[0]);
  await assert.rejects(h.service.submit(trxRequest), /existing_operation_use_status/u); assert.equal(h.sent.length, 1);
});

test("a contract deposit address is gas-estimated within the owner cap instead of assuming 21000", async t => {
  const h = await harness(t, { code: "0x6080604052" });
  const result = await h.service.submit(trxRequest) as Record<string, unknown>;
  assert.equal(parseTransaction(h.sent[0]!).gas, 36_001n);
  assert.equal((await h.journal.load(result.operationId as string))?.depositCode, "contract");
  const over = await harness(t, { code: "0x6080604052", estimate: 50_001n });
  await assert.rejects(over.service.submit(trxRequest), /gas_fee/u);
  assert.equal(over.sent.length, 0); assert.equal(over.approvals(), 0);
});

test("value plus fee must fit the owner's native debit cap and the pinned balance before consent", async t => {
  const capped = await harness(t);
  await assert.rejects(capped.service.submit({ ...trxRequest, maxNativeDebitWei: "2044099999999999" }), /native_balance_or_cap/u);
  const poor = await harness(t, { balance: 2_044_099_999_999_999n });
  await assert.rejects(poor.service.submit(trxRequest), /native_balance_or_cap/u);
  const loss = await harness(t);
  await assert.rejects(loss.service.submit({ ...trxRequest, maxQuotedLossAtomic: "133357" }), /quote_amount_or_deadline/u);
  const unlisted = await harness(t);
  await assert.rejects(unlisted.service.submit({ ...trxRequest, lane: "ethereum-eth-to-base-usdc" }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(unlisted.service.submit({ ...trxRequest, recipient: SOL_RECIPIENT }), { code: "APN_INVALID_INPUT" });
  for (const h of [capped, poor, loss, unlisted]) { assert.equal(h.sent.length, 0); assert.equal(h.approvals(), 0); }
  const missing = new OneClickSourceService(capped.state, { async load() { return Buffer.alloc(32, 7); }, async create() { return Buffer.alloc(32, 7); } }, {});
  await assert.rejects(missing.submit(trxRequest), /ethereum_rpc_missing/u);
});

test("an ambiguous Ethereum send is recorded once and never resent", async t => {
  const h = await harness(t, { sendAmbiguous: true });
  const result = await h.service.submit(trxRequest) as Record<string, unknown>;
  assert.equal(result.sourceState, "unknown_finality"); assert.equal(result.submissionAttempts, 1);
  await assert.rejects(h.service.submit(trxRequest)); assert.equal(h.sent.length, 1);
});

test("TRX status keeps the 1Click claim separate from the solidified TRON proof", async t => {
  const later = Date.now() + 60_000, delivery = transfer("13300000", TRON_RECIPIENT, false, later);
  const h = await harness(t, { providerStatus: "PROCESSING" });
  const submitted = await h.service.submit(trxRequest) as Record<string, unknown>;
  let status = await h.service.status(submitted.operationId as string) as Record<string, any>;
  assert.equal(status.sourceReceipt.safe, true); assert.equal(status.sourceReceipt.status, "success");
  assert.equal(status.destinationClaimed, false); assert.equal(status.destinationProof.status, "awaiting_provider_destination_hash");
  assert.equal(status.destinationFinalized, false);
  h.world.providerStatus = "SUCCESS"; h.world.destinationHashes = [delivery.txID];
  const tron = tronWorld(delivery, {}, undefined, later);
  t.mock.method(TronRpc.prototype, "call", async (method: never, body: never) => await tron.call(method, body));
  status = await h.service.status(submitted.operationId as string) as Record<string, any>;
  assert.equal(status.oneClickProviderStatus, "SUCCESS"); assert.equal(status.providerStatusProvenance, "oneclick_https_untrusted");
  assert.deepEqual(status.providerDestinationTransactions, [delivery.txID]);
  assert.equal(status.destinationProof.status, "finalized"); assert.equal(status.destinationProof.creditedAtomic, "13300000");
  assert.equal(status.destinationFinalized, true);
  // A provider SUCCESS naming an under-delivering transfer stays a claim, not finality.
  const short = transfer("13000000", TRON_RECIPIENT, false, later); h.world.destinationHashes = [short.txID];
  const shortWorld = tronWorld(short, {}, undefined, later);
  t.mock.method(TronRpc.prototype, "call", async (method: never, body: never) => await shortWorld.call(method, body));
  status = await h.service.status(submitted.operationId as string) as Record<string, any>;
  assert.equal(status.destinationClaimed, true); assert.equal(status.destinationFinalized, false);
  assert.equal(status.destinationProof.reason, "credited_below_minimum_output");
});

test("SOL status proves the recipient's finalized balance delta from the provider-named signature", async t => {
  const h = await harness(t, { destinationHashes: [SIGNATURE] });
  const submitted = await h.service.submit(solRequest) as Record<string, unknown>;
  assert.equal(parseTransaction(h.sent[0]!).value, 2_000_000_000_000_000n);
  const solana = solanaWorld(46_400_000, {}, Date.now() + 60_000);
  t.mock.method(SolanaRpc.prototype, "call", async (method: never) => await solana.call(method));
  const status = await h.service.status(submitted.operationId as string) as Record<string, any>;
  assert.equal(status.lane, "ethereum-eth-to-solana-sol"); assert.equal(status.destinationProof.proofClass, "solana_finalized_sol_balance_delta");
  assert.equal(status.destinationProof.creditedAtomic, "46400000"); assert.equal(status.destinationFinalized, true);
});
