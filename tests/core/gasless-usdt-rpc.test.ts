import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, keccak256, pad, type Hex } from "viem";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { usdtChainPort, usdtSafeSnapshot, usdtSponsorPort } from "../../src/gasless-usdt/rpc.js";

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
  const params: unknown[][] = [];
  const peer: GaslessTransport = { request: async (_endpoint, _method, body) => {
    const request = JSON.parse(body!) as { id: string; method: string; params: unknown[] };
    params.push(request.params);
    const result = request.method === "eth_chainId" ? "0x1" : request.method === "eth_getBlockByNumber"
      ? { number: "0x100", hash: blockHash } : "0x01";
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  await assert.rejects(usdtSafeSnapshot(peer, RPC_URL, OWNER), /gasless_usdt_code_drift/u);
  assert.deepEqual(params[1], ["safe", false]);
  assert.deepEqual(params[2], [USDT_GASLESS.token, { blockHash, requireCanonical: true }]);
  assert.equal(params.length, 3);
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
