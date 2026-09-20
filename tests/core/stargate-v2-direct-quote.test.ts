import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, type Abi } from "viem";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT } from "../../src/stargate-v2/abi.js";
import { STARGATE_QUOTE_ABI } from "../../src/stargate-v2/abi.js";
import { STARGATE_V2_DEPLOYMENTS, stargateV2Route } from "../../src/stargate-v2/registry.js";
import { quoteStargateV2Direct, type StargateV2QuoteRequest } from "../../src/stargate-v2/quote.js";

type Fixture = {
  block: { number: string; hash: `0x${string}` }; recipient: `0x${string}`; amountAtomic: string;
  quoteOft: { limit: { minAmountLD: string; maxAmountLD: string }; feeDetails: { feeAmountLD: string; description: string }[];
    receipt: { amountSentLD: string; amountReceivedLD: string } };
  quoteSend: { nativeFee: string; lzTokenFee: string };
};
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(resolve("tests/core/stargate-v2-fixtures/ethereum-base-usdc.json"), "utf8")) as Fixture;
}
async function rpc(overrides: { chainId?: string; oft?: `0x${string}`; fee?: `0x${string}`; code?: `0x${string}` } = {}) {
  const f = await fixture(), methods: string[] = [], calls: Array<{ to: string; data: string }> = [];
  const oft = overrides.oft ?? encodeAbiParameters(STARGATE_QUOTE_OFT_OUTPUT, [
    { minAmountLD: BigInt(f.quoteOft.limit.minAmountLD), maxAmountLD: BigInt(f.quoteOft.limit.maxAmountLD) },
    f.quoteOft.feeDetails.map((x) => ({ feeAmountLD: BigInt(x.feeAmountLD), description: x.description })),
    { amountSentLD: BigInt(f.quoteOft.receipt.amountSentLD), amountReceivedLD: BigInt(f.quoteOft.receipt.amountReceivedLD) },
  ]);
  const fee = overrides.fee ?? encodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, [
    { nativeFee: BigInt(f.quoteSend.nativeFee), lzTokenFee: BigInt(f.quoteSend.lzTokenFee) },
  ]);
  let quote = 0;
  const call: EvmRpcCall = async (method, params) => {
    methods.push(method);
    if (method === "eth_chainId") return overrides.chainId ?? "0x1";
    if (method === "eth_getBlockByNumber") return { number: f.block.number, hash: f.block.hash };
    if (method === "eth_getCode") return overrides.code ?? "0x6000";
    if (method === "eth_call") {
      calls.push(params[0] as { to: string; data: string }); return quote++ === 0 ? oft : fee;
    }
    throw new Error(`unexpected ${method}`);
  };
  return { f, call, calls, methods };
}

test("official ABI fixture records only view quotes and finite source versions", async () => {
  const recorded = JSON.parse(await readFile(resolve("data/stargate/2026-09-20/official-registry-and-abi.json"), "utf8")) as {
    abi: Abi; sources: { commit?: string }[]; blockers: { chainId: number; asset: string }[];
    deployments: { chainId: number; eid: number; asset: string; token: string; pool: string; kind: string }[] };
  assert.deepEqual(recorded.abi.map((x) => x.type === "function" ? x.name : "").sort(), ["quoteOFT", "quoteSend"]);
  assert.ok(recorded.abi.every((x) => x.type === "function" && x.stateMutability === "view"));
  assert.deepEqual(recorded.sources.flatMap((x) => x.commit ?? []), [
    "ce598b8d16472cd76ee47d30b8a40bc5c1b667bb", "7c800d680072ae6cc50edf95711fa601974a4a70",
    "ce598b8d16472cd76ee47d30b8a40bc5c1b667bb",
  ]);
  assert.deepEqual(recorded.blockers.map((x) => [x.chainId, x.asset]), [
    [137, "POL"], [56, "BNB"], [43114, "AVAX"], [130, "USDC"], [59144, "ETH"], [59144, "USDC"],
    [143, "MON"], [143, "USDC"], [1329, "SEI"], [1329, "USDC"],
  ]);
  assert.equal(STARGATE_V2_DEPLOYMENTS.length, 13);
  assert.deepEqual(recorded.deployments.map((x) => ({ ...x, token: x.token.toLowerCase(), pool: x.pool.toLowerCase() })),
    STARGATE_V2_DEPLOYMENTS.map((x) => ({ ...x, token: x.token.toLowerCase(), pool: x.pool.toLowerCase() })));
});

test("direct quote calls quoteOFT then quoteSend(false) at one block and returns canonical evidence", async () => {
  const s = await rpc(), request: StargateV2QuoteRequest = { sourceChainId: 1, destinationChainId: 8453,
    sourceToken: USDC_ETH, destinationToken: USDC_BASE, recipient: s.f.recipient, amountAtomic: s.f.amountAtomic };
  const result = await quoteStargateV2Direct(request, s.call);
  assert.equal(result.executionAdmitted, false); assert.equal(result.route.sourceEid, 30101); assert.equal(result.route.destinationEid, 30184);
  assert.equal(result.quote.amountSentAtomic, "1000000"); assert.equal(result.quote.minimumOutputAtomic, "997500");
  assert.equal(result.quote.nativeMessageFeeAtomic, "203111847073271"); assert.equal(result.quote.lzTokenFeeAtomic, "0");
  assert.equal(result.block.hash, s.f.block.hash.toLowerCase()); assert.match(result.quoteHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(s.methods, ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_call", "eth_getBlockByNumber", "eth_chainId"]);
  assert.equal(s.calls.length, 2); assert.notEqual(s.calls[0]!.data.slice(0, 10), s.calls[1]!.data.slice(0, 10));
  assert.equal(s.calls[0]!.to, result.route.sourcePool); assert.equal(s.calls[1]!.to, result.route.sourcePool);
  const first = decodeFunctionData({ abi: STARGATE_QUOTE_ABI, data: s.calls[0]!.data as `0x${string}` });
  const second = decodeFunctionData({ abi: STARGATE_QUOTE_ABI, data: s.calls[1]!.data as `0x${string}` });
  assert.equal(first.functionName, "quoteOFT"); assert.equal(second.functionName, "quoteSend");
  assert.deepEqual(second.args[0], first.args[0]); assert.equal(second.args[1], false);
});

test("finite registry rejects unknown, cross-asset, unsupported and same-chain routes before RPC", async () => {
  assert.throws(() => stargateV2Route({ chainId: 56, token: "native" }, { chainId: 1, token: "native" }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => stargateV2Route({ chainId: 1, token: USDC_ETH }, { chainId: 8453, token: "native" }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => stargateV2Route({ chainId: 1, token: USDC_ETH }, { chainId: 1, token: USDC_ETH }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  const s = await rpc(); let count = 0; const call: EvmRpcCall = async (...args) => { count++; return s.call(...args); };
  await assert.rejects(quoteStargateV2Direct({ sourceChainId: 59144, destinationChainId: 8453, sourceToken: USDC_ETH,
    destinationToken: USDC_BASE, recipient: s.f.recipient, amountAtomic: "1" }, call), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.equal(count, 0);
});

test("chain mismatch, missing code, malformed returndata and inconsistent quote fail closed", async () => {
  const request = async (s: Awaited<ReturnType<typeof rpc>>) => ({ sourceChainId: 1, destinationChainId: 8453,
    sourceToken: USDC_ETH, destinationToken: USDC_BASE, recipient: s.f.recipient, amountAtomic: s.f.amountAtomic } as const);
  let s = await rpc({ chainId: "0x2105" }); await assert.rejects(quoteStargateV2Direct(await request(s), s.call), { code: "APN_CHAIN_MISMATCH" });
  s = await rpc({ code: "0x" }); await assert.rejects(quoteStargateV2Direct(await request(s), s.call), { code: "APN_RPC_PROTOCOL" });
  s = await rpc({ oft: "0x01" }); await assert.rejects(quoteStargateV2Direct(await request(s), s.call), { code: "APN_RPC_PROTOCOL" });
  const f = await fixture(), inconsistent = encodeAbiParameters(STARGATE_QUOTE_OFT_OUTPUT, [
    { minAmountLD: 1n, maxAmountLD: 5_000_000n }, [], { amountSentLD: 1_000_001n, amountReceivedLD: 997_500n },
  ]);
  s = await rpc({ oft: inconsistent }); await assert.rejects(quoteStargateV2Direct(await request(s), s.call), { code: "APN_RPC_PROTOCOL" });
  assert.equal(f.amountAtomic, "1000000");
});

test("request mutation during asynchronous quote reads fails closed", async () => {
  const s = await rpc(), request: StargateV2QuoteRequest = { sourceChainId: 1, destinationChainId: 8453,
    sourceToken: USDC_ETH, destinationToken: USDC_BASE, recipient: s.f.recipient, amountAtomic: s.f.amountAtomic };
  let calls = 0; const call: EvmRpcCall = async (method, params) => {
    const result = await s.call(method, params); if (method === "eth_call" && calls++ === 0) (request as { amountAtomic: string }).amountAtomic = "2"; return result;
  };
  await assert.rejects(quoteStargateV2Direct(request, call), { code: "APN_RPC_PROTOCOL" });
});
