import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, keccak256, pad, type Hex } from "viem";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { UsdtJsonRpc, usdtChainPort, usdtRecoveryPort, usdtSafeSnapshot, usdtSponsorPort } from "../../src/gasless-usdt/rpc.js";

const OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RPC_URL = "https://ethereum.example-rpc.test/";
type Reply = unknown | { readonly error: { readonly code: number; readonly message: string } };

/** Scripted JSON-RPC peer: records every exchange and answers by method, echoing the request id unless told otherwise. */
function transport(replies: Readonly<Record<string, Reply | ((params: readonly unknown[]) => Reply)>>, seen: string[], idOffset = 0): GaslessTransport {
  return { async request(endpoint, method, body) {
    assert.equal(method, "POST");
    const request = JSON.parse(body!) as { id: string; method: string; params: unknown[] };
    seen.push(`${endpoint} ${request.method}`);
    const scripted = replies[request.method];
    const reply = typeof scripted === "function" ? (scripted as (params: readonly unknown[]) => Reply)(request.params) : scripted;
    const id = (Number(request.id) + idOffset).toString();
    const envelope = reply !== null && typeof reply === "object" && "error" in reply ? { jsonrpc: "2.0", id, error: reply.error }
      : { jsonrpc: "2.0", id, result: reply };
    return { status: 200, body: JSON.stringify(envelope) };
  } };
}

test("the sponsor is the fixed keyless Pimlico endpoint and its refusals are classified, never retried", async () => {
  const seen: string[] = [];
  const sponsor = usdtSponsorPort(transport({ pimlico_getTokenQuotes: (params: readonly unknown[]) => {
    assert.deepEqual(params, [{ tokens: [USDT_GASLESS.token] }, USDT_GASLESS.entryPoint, "0x1"]); return { quotes: [] };
  }, pm_getPaymasterData: { error: { code: -32500, message: "AA50 PostOp Reverted: UserOperation reverted during simulation with reason: 0x5a154675" } },
  }, seen));
  assert.deepEqual(await sponsor.tokenQuote(), { quotes: [] });
  await assert.rejects(sponsor.paymasterData({} as never), (error: { code: string; details: { reason: string } }) =>
    error.code === "APN_PROVIDER_EFFECT_UNAVAILABLE" && error.details.reason === "gasless_usdt_sponsor_simulation_refused");
  assert.deepEqual(seen, [`${USDT_GASLESS.bundlerUrl} pimlico_getTokenQuotes`, `${USDT_GASLESS.bundlerUrl} pm_getPaymasterData`]);
  const skewed = usdtSponsorPort(transport({ pimlico_getUserOperationGasPrice: {} }, [], 1));
  await assert.rejects(skewed.gasPrice(), /gasless_usdt_rpc_envelope/u);
});

const word = (value: bigint | string) => pad(typeof value === "string" ? value as Hex : `0x${value.toString(16)}`, { size: 32 });
const CODE: Readonly<Record<string, string>> = { [USDT_GASLESS.token]: "0x01", [USDT_GASLESS.entryPoint]: "0x02",
  [USDT_GASLESS.delegate]: "0x03", [USDT_GASLESS.paymaster]: "0x04" };

test("pins are code hashes read from the owner's RPC; drift, a wrong chain or a foreign delegation refuses", async () => {
  const replies = (overrides: Readonly<Record<string, unknown>> = {}) => ({
    eth_chainId: "0x1",
    eth_getCode: (params: readonly unknown[]) => overrides[`code:${String(params[0])}`] ?? CODE[String(params[0])] ?? "0x",
    eth_call: (params: readonly unknown[]) => {
      const call = params[0] as { to: string; data: string };
      if (call.to === USDT_GASLESS.paymaster) return word(USDT_GASLESS.entryPoint);
      if (call.data.startsWith("0x70a08231")) return word(2_000_000n);
      if (call.data.startsWith("0x35567e1a")) return word(7n);
      return overrides[`call:${call.data.slice(0, 10)}`] ?? word(0n);
    },
    eth_getTransactionCount: "0x1f",
  });
  // The shipped pins are the mainnet hashes (the live rehearsal matches them); scripted bytecode must drift.
  assert.notEqual(keccak256("0x01"), USDT_GASLESS.tokenCodeHash);
  await assert.rejects(usdtChainPort(transport(replies(), []), RPC_URL).verifyPins(), /gasless_usdt_code_drift/u);
  await assert.rejects(usdtChainPort(transport({ ...replies(), eth_chainId: "0x89" }, []), RPC_URL).verifyPins(), /gasless_usdt_chain/u);
  const account = await usdtChainPort(transport(replies(), []), RPC_URL).account(OWNER);
  assert.deepEqual(account, { usdtBalanceAtomic: 2_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation: "empty" });
  const delegated = await usdtChainPort(transport(replies({ [`code:${OWNER}`]: `0xef0100${USDT_GASLESS.delegate.slice(2).toLowerCase()}` }), []), RPC_URL)
    .account(OWNER);
  assert.equal(delegated.delegation, "expected");
  await assert.rejects(usdtChainPort(transport(replies({ [`code:${OWNER}`]: `0xef0100${"12".repeat(20)}` }), []), RPC_URL).account(OWNER),
    /gasless_usdt_foreign_delegation/u);
});

test("safe snapshot anchors contract reads to the canonical safe block hash", async () => {
  const blockHash = `0x${"ab".repeat(32)}`;
  const batches: { id: string; method: string; params: unknown[] }[][] = [];
  const peer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    const requests = JSON.parse(body!) as { id: string; method: string; params: unknown[] }[];
    assert.ok(Array.isArray(requests)); batches.push(requests);
    return { status: 200, body: JSON.stringify(requests.map(request => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x1" : request.method === "eth_getBlockByNumber"
        ? { number: "0x100", hash: blockHash } : "0x01" })).reverse()) };
  } };
  await assert.rejects(usdtSafeSnapshot(peer, RPC_URL, OWNER), /gasless_usdt_code_drift/u);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0]!.map(request => request.method), ["eth_chainId", "eth_getBlockByNumber"]);
  assert.deepEqual(batches[0]![1]!.params, ["safe", false]);
  assert.equal(batches[1]!.length, 12);
  assert.deepEqual(batches[1]!.map(request => request.method), ["eth_getCode", "eth_getCode", "eth_getCode",
    "eth_getCode", "eth_call", "eth_call", "eth_call", "eth_call", "eth_getCode", "eth_call", "eth_call",
    "eth_getTransactionCount"]);
  for (const request of batches[1]!) assert.deepEqual(request.params[1], { blockHash, requireCanonical: true });
  assert.deepEqual(batches[1]![0]!.params[0], USDT_GASLESS.token);
  assert.deepEqual(batches[1]![8]!.params[0], OWNER);
});

test("safe snapshot rejects incomplete, duplicate and mismatched JSON-RPC batches without single-read fallback", async () => {
  for (const fault of ["missing", "duplicate", "foreign", "single"] as const) {
    let physical = 0;
    const peer: GaslessTransport = { request: async (_endpoint, _method, body) => {
      physical += 1;
      const requests = JSON.parse(body!) as { id: string; method: string }[];
      const replies = requests.map(request => ({ jsonrpc: "2.0", id: request.id,
        result: request.method === "eth_chainId" ? "0x1" : { number: "0x100", hash: `0x${"ab".repeat(32)}` } }));
      if (fault === "missing") replies.pop();
      if (fault === "duplicate") replies[1] = { ...replies[1]!, id: replies[0]!.id };
      if (fault === "foreign") replies[1] = { ...replies[1]!, id: "999" };
      return { status: 200, body: JSON.stringify(fault === "single" ? replies[0] : replies) };
    } };
    await assert.rejects(usdtSafeSnapshot(peer, RPC_URL, OWNER), /gasless_usdt_rpc_batch_envelope/u);
    assert.equal(physical, 1);
  }
  let physical = 0;
  const secondPhasePeer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    physical += 1;
    const requests = JSON.parse(body!) as { id: string; method: string }[];
    const replies = requests.map(request => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x1" : request.method === "eth_getBlockByNumber"
        ? { number: "0x100", hash: `0x${"ab".repeat(32)}` } : "0x01" }));
    if (physical === 2) replies.pop();
    return { status: 200, body: JSON.stringify(replies) };
  } };
  await assert.rejects(usdtSafeSnapshot(secondPhasePeer, RPC_URL, OWNER), /gasless_usdt_rpc_batch_envelope/u);
  assert.equal(physical, 2);
});

test("JSON-RPC batch maps out-of-order replies and refuses a method error", async () => {
  const calls = [{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["safe", false] }];
  const seen: string[] = [];
  const peer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    seen.push(body!);
    const requests = JSON.parse(body!) as { id: string }[];
    return { status: 200, body: JSON.stringify([
      { jsonrpc: "2.0", id: requests[1]!.id, result: { hash: "0xabc" } },
      { jsonrpc: "2.0", id: requests[0]!.id, result: "0x1" },
    ]) };
  } };
  const rpc = new UsdtJsonRpc(peer, RPC_URL, new Set(calls.map(call => call.method)));
  assert.deepEqual(await rpc.batch(calls), ["0x1", { hash: "0xabc" }]);
  assert.equal(seen.length, 1);
  const errorPeer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    const requests = JSON.parse(body!) as { id: string }[];
    return { status: 200, body: JSON.stringify([
      { jsonrpc: "2.0", id: requests[0]!.id, result: "0x1" },
      { jsonrpc: "2.0", id: requests[1]!.id, error: { code: -32000, message: "historical block unavailable" } },
    ]) };
  } };
  await assert.rejects(new UsdtJsonRpc(errorPeer, RPC_URL, new Set(calls.map(call => call.method))).batch(calls),
    (error: { code: string; details: { reason: string; method: string } }) =>
      error.code === "APN_PROVIDER_PROTOCOL" && error.details.reason === "gasless_usdt_sponsor_refused" &&
      error.details.method === "eth_getBlockByNumber");
});

test("safe snapshot refuses a wrong chain after one batch and never reads account state", async () => {
  let physical = 0;
  const peer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    physical += 1;
    const requests = JSON.parse(body!) as { id: string; method: string }[];
    return { status: 200, body: JSON.stringify(requests.map(request => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x89" : { number: "0x100", hash: `0x${"ab".repeat(32)}` } }))) };
  } };
  await assert.rejects(usdtSafeSnapshot(peer, RPC_URL, OWNER), /gasless_usdt_chain/u);
  assert.equal(physical, 1);
});

test("a receipt counts only at or below the safe head and on the canonical block", async () => {
  const tx = `0x${"cd".repeat(32)}` as Hex, blockHash = `0x${"ee".repeat(32)}`;
  const receipt = { transactionHash: tx, blockNumber: "0x64", blockHash, status: "0x1", logs: [] };
  const chain = (safe: string, canonical: string) => usdtChainPort(transport({ eth_getTransactionReceipt: receipt,
    eth_getBlockByNumber: (params: readonly unknown[]) => params[0] === "safe" ? { number: safe } : { hash: canonical } }, []), RPC_URL);
  assert.equal(await chain("0x63", blockHash).receiptAt(tx), null);
  await assert.rejects(chain("0x64", `0x${"ff".repeat(32)}`).receiptAt(tx), /receipt_not_canonical/u);
  const proven = await chain("0x64", blockHash).receiptAt(tx);
  assert.deepEqual(proven, { transactionHash: tx, blockNumber: 100n, status: "success", logs: [] });
  assert.equal(await usdtChainPort(transport({ eth_getTransactionReceipt: null }, []), RPC_URL).receiptAt(tx), null);
});

test("recovery adapter requires the finalized head and rejects malformed or noncanonical chain evidence", async () => {
  const hash = `0x${"ab".repeat(32)}` as Hex, tx = `0x${"cd".repeat(32)}` as Hex;
  const blockHash = `0x${"ee".repeat(32)}` as Hex, seen: string[] = [];
  const locator = { userOpHash: hash, sender: OWNER, entryPoint: USDT_GASLESS.entryPoint,
    paymaster: USDT_GASLESS.paymaster, success: true, receipt: { transactionHash: tx } };
  const receipt = { transactionHash: tx, blockNumber: "0x64", blockHash, status: "0x1", logs: [] };
  const peer = transport({ eth_getUserOperationReceipt: locator, eth_chainId: "0x1", eth_getTransactionReceipt: receipt,
    eth_getBlockByNumber: (params: readonly unknown[]) => params[0] === "finalized" ? { number: "0x64" } : { hash: blockHash } }, seen);
  const port = usdtRecoveryPort(peer, RPC_URL);
  assert.deepEqual(await port.userOperationReceipt(hash), { userOpHash: hash, sender: OWNER,
    entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster, success: true, transactionHash: tx });
  assert.equal((await port.canonicalFinalizedReceipt(tx))?.transactionHash, tx);
  assert.deepEqual(seen, [`${USDT_GASLESS.bundlerUrl} eth_getUserOperationReceipt`, `${RPC_URL} eth_chainId`,
    `${RPC_URL} eth_getTransactionReceipt`, `${RPC_URL} eth_getBlockByNumber`, `${RPC_URL} eth_getBlockByNumber`]);
  const headTags: unknown[] = [];
  const notFinal = usdtRecoveryPort(transport({ eth_chainId: "0x1", eth_getTransactionReceipt: receipt,
    eth_getBlockByNumber: (params: readonly unknown[]) => { headTags.push(params[0]); return params[0] === "finalized"
      ? { number: "0x63" } : { number: "0x65", hash: blockHash }; } }, []), RPC_URL);
  assert.equal(await notFinal.canonicalFinalizedReceipt(tx), null);
  assert.deepEqual(headTags, ["finalized"]);
  await assert.rejects(usdtRecoveryPort(transport({ eth_getUserOperationReceipt: { ...locator, success: "yes" } }, []), RPC_URL)
    .userOperationReceipt(hash), /gasless_usdt_userop_receipt_success/u);
  await assert.rejects(usdtRecoveryPort(transport({ eth_chainId: "0x89" }, []), RPC_URL).canonicalFinalizedReceipt(tx),
    /gasless_usdt_chain/u);
  await assert.rejects(usdtRecoveryPort(transport({ eth_chainId: "0x1", eth_getTransactionReceipt: { ...receipt,
    status: "0x2" }, eth_getBlockByNumber: (params: readonly unknown[]) => params[0] === "finalized" ? { number: "0x64" } : { hash: blockHash } }, []),
  RPC_URL).canonicalFinalizedReceipt(tx), /gasless_usdt_receipt_status/u);
});
