import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiParameters, type Hex } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { StargateJsonRpc, StargateNativeService, confirmedStargateSourceReceipt,
  observeStargateDestination } from "../../src/stargate-v2/native-runtime.js";
import { temporaryState } from "./helpers.js";

const SOURCE = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const DESTINATION = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const TX = `0x${"12".repeat(32)}` as Hex, GUID = `0x${"34".repeat(32)}` as Hex;
const BLOCK = `0x${"56".repeat(32)}` as Hex, DEST_TX = `0x${"78".repeat(32)}` as Hex;

test("StargateJsonRpc sends bounded JSON-RPC and refuses methods outside the execution surface", async () => {
  let request: any;
  const rpc = new StargateJsonRpc("https://rpc.example", { request: async (...args: any[]) => {
    request = JSON.parse(args[2]); return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1" }) };
  } } as any);
  assert.equal(await rpc.call("eth_chainId", []), "0x1");
  assert.deepEqual({ method: request.method, params: request.params }, { method: "eth_chainId", params: [] });
  await assert.rejects(rpc.call("eth_sign", []), (error: any) => error.code === "APN_RPC_CONFIG" && error.details.reason === "rpc_method");
});

test("safe source receipt parser preserves exact pinned emitter event evidence", async () => {
  const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", args: { guid: GUID, fromAddress: OWNER } });
  const data = encodeAbiParameters(parseAbiParameters("uint32 dstEid,uint256 amountSentLD,uint256 amountReceivedLD"), [30320, 10n, 9n]);
  const rpc = { call: async (method: string) => method === "eth_getTransactionReceipt" ? { transactionHash: TX, status: "0x1",
    blockNumber: "0xa", blockHash: BLOCK, logs: [{ address: SOURCE, topics, data }] } :
    { number: "0xa", hash: BLOCK } };
  const receipt = await confirmedStargateSourceReceipt(rpc as any, TX, "safe");
  assert.equal(receipt?.status, "success"); assert.equal(receipt?.logs[0]?.address, SOURCE);
  assert.equal(receipt?.logs[0]?.topics[1], GUID);
});

test("safe source receipt parser rejects a receipt orphaned by canonical block hash", async () => {
  let blocks = 0; const rpc = { call: async (method: string) => method === "eth_getTransactionReceipt"
    ? { transactionHash: TX, status: "0x1", blockNumber: "0xa", blockHash: BLOCK, logs: [] }
    : (++blocks === 1 ? { number: "0xa", hash: BLOCK } : { number: "0xa", hash: DEST_TX }) };
  await assert.rejects(confirmedStargateSourceReceipt(rpc as any, TX, "safe"), (error: any) => error.code === "APN_RPC_PROTOCOL");
});

test("destination observer parses only the pinned safe OFTReceived log over the bounded block range", async () => {
  const topics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", args: { guid: GUID, toAddress: OWNER } });
  const data = encodeAbiParameters(parseAbiParameters("uint32 srcEid,uint256 amountReceivedLD"), [30101, 9n]);
  let filter: any;
  const rpc = { call: async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getBlockByNumber") return { number: "0x20", hash: BLOCK };
    if (method === "eth_getLogs") { filter = params[0]; return [{ address: DESTINATION, topics, data, transactionHash: DEST_TX,
      logIndex: "0x2", blockNumber: "0x1f", blockHash: BLOCK }]; }
    throw new Error(`unexpected ${method}`);
  } };
  const evidence = await observeStargateDestination(rpc as any, { sourceTransactionHash: TX, guid: GUID, recipient: OWNER,
    sourceEid: 30101, destinationPool: DESTINATION, minimumAmountAtomic: "9", balanceBeforeAtomic: "1", fromBlockNumberAtomic: "16", fromBlockHash: BLOCK,
    finalityTag: "safe" });
  assert.equal(evidence?.mode, "oft_received"); assert.equal(evidence?.destinationTransactionHash, DEST_TX);
  assert.equal(filter.address, DESTINATION); assert.equal(filter.fromBlock, "0x10"); assert.equal(filter.toBlock, "0x20");
});

test("StargateNativeService status is a true local read with no RPC call or journal transition", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const service = new StargateNativeService(state, { load: async () => Buffer.alloc(32) } as any,
    { APN_ETHEREUM_RPC_URL: "https://ethereum.example", APN_UNICHAIN_RPC_URL: "https://unichain.example" });
  const operation = { schemaVersion: "apn.stargate-v2-native-operation.v1", operationId: "a".repeat(64), phase: "prepared",
    transitions: [{ phase: "prepared", at: "2026-01-01T00:00:00.000Z", reason: "fixture" }] } as any;
  // Use a test-local journal seam because this assertion targets service routing, not record validation.
  (service as any).journal = { load: async () => operation };
  assert.equal((await service.status(operation.operationId)).phase, "prepared");
});

test("StargateNativeService requires RPC capability lazily only for remote commands", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root);
  const service = new StargateNativeService(state, { load: async () => Buffer.alloc(32) } as any, {});
  await assert.rejects(service.prepare({ profile: "owner", amountAtomic: "1", maxNativeDebitAtomic: "2", idempotencyKey: "missing-rpc" }),
    (error: any) => error.code === "APN_RPC_CONFIG" && error.details.reason === "APN_ETHEREUM_RPC_URL_and_APN_UNICHAIN_RPC_URL_required");
  (service as any).required = async () => ({ phase: "submitted", profile: "owner", owner: OWNER });
  await assert.rejects(service.observe("a".repeat(64)), (error: any) => error.code === "APN_RPC_CONFIG");
});

test("production factory fails remote prepare on missing RPC capability before state creation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const missingRoot = `${temporary.root}-missing`;
  const ethereum = process.env.APN_ETHEREUM_RPC_URL, unichain = process.env.APN_UNICHAIN_RPC_URL;
  delete process.env.APN_ETHEREUM_RPC_URL; delete process.env.APN_UNICHAIN_RPC_URL;
  t.after(() => { if (ethereum === undefined) delete process.env.APN_ETHEREUM_RPC_URL; else process.env.APN_ETHEREUM_RPC_URL = ethereum;
    if (unichain === undefined) delete process.env.APN_UNICHAIN_RPC_URL; else process.env.APN_UNICHAIN_RPC_URL = unichain; });
  const bound = bindArgv(["stargate", "native", "prepare", "--profile", "owner", "--amount-atomic", "1",
    "--max-native-debit-atomic", "2", "--idempotency-key", "missing-rpc"]);
  const result = await createApnCore(bound, { stateRoot: missingRoot }).execute(bound.request);
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_RPC_CONFIG");
  await assert.rejects(import("node:fs/promises").then(fs => fs.stat(missingRoot)), (error: any) => error.code === "ENOENT");
});

test("CLI binding dispatches status locally and observe explicitly through the Stargate service", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const calls: string[] = [];
  const service = { status: async (id: string) => { calls.push(`status:${id}`); return { phase: "submitted" }; },
    observe: async (id: string) => { calls.push(`observe:${id}`); return { phase: "observed" }; } } as any;
  const id = "b".repeat(64);
  const status = await createApnCore(bindArgv(["stargate", "native", "status", "--operation", id]),
    { stateRoot: temporary.root, stargateNative: service }).execute({ command: "stargate.native.status", operationId: id });
  const observe = await createApnCore(bindArgv(["stargate", "native", "observe", "--operation", id]),
    { stateRoot: temporary.root, stargateNative: service }).execute({ command: "stargate.native.observe", operationId: id });
  assert.deepEqual(calls, [`status:${id}`, `observe:${id}`]); assert.equal(status.proof_class, "durable_public_state");
  assert.equal(observe.operation && (observe.operation as any).phase, "observed");
});
