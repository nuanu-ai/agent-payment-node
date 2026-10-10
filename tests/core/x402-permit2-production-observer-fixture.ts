import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import { StateStore } from "../../src/state.js";
import { keccak256, type Hex } from "viem";
import { encodePermit2ProductionProxyCall } from "../../src/x402-permit2/production-proxy-call.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS,
  ERC20_TRANSFER_TOPIC, PROXY_SETTLED_TOPIC, PROXY_SETTLED_WITH_PERMIT_TOPIC } from "../../src/x402-permit2/registry.js";
import { protocolFixture, protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { temporaryState } from "./helpers.js";

export const factHash = (digit: string): Hex => `0x${digit.repeat(64)}`;
export const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
export async function observerFixture(t: TestContext, sponsor = false, maxTimeoutSeconds = 60) {
  const f = await protocolFixture(sponsor, maxTimeoutSeconds), temp = await temporaryState(); t.after(temp.cleanup);
  await new StateStore(temp.root).initialize();
  const proxyCode = readFileSync("tests/fixtures/x402-permit2/original-proxy-runtime.hex", "utf8").trim() as Hex;
  const permit2Code = readFileSync("tests/fixtures/x402-permit2/avalanche-permit2-runtime.hex", "utf8").trim() as Hex;
  assert.equal(keccak256(proxyCode), X402_PERMIT2_ASSETS[0]!.proxyCodeHash);
  assert.equal(keccak256(permit2Code), PERMIT2_CODE_HASH);
  const block = { number: "0x2a", hash: factHash("b"), timestamp: `0x${protocolSecond.toString(16)}` };
  const finalized = { number: "0x2b", hash: factHash("c"), timestamp: `0x${(protocolSecond + 61).toString(16)}` };
  const tx = { chainId: "0xa86a", to: X402_EXACT_PERMIT2_PROXY, from: "0x3333333333333333333333333333333333333333",
    value: "0x0", input: await encodePermit2ProductionProxyCall(f.record, f.signed), hash: factHash("a"),
    blockHash: block.hash, blockNumber: block.number, transactionIndex: "0x1" };
  const identity = { transactionHash: tx.hash, blockHash: tx.blockHash, blockNumber: tx.blockNumber,
    transactionIndex: tx.transactionIndex, removed: false };
  const receipt = { from: tx.from, to: tx.to, transactionHash: tx.hash, blockHash: tx.blockHash, blockNumber: tx.blockNumber,
    transactionIndex: tx.transactionIndex, status: "0x1", logs: [
    { ...identity, address: f.prepared.token, logIndex: "0x2", topics: [ERC20_TRANSFER_TOPIC, topic(f.prepared.payer), topic(f.prepared.payTo)], data: word(BigInt(f.prepared.amountAtomic)) },
    { ...identity, address: X402_EXACT_PERMIT2_PROXY, logIndex: "0x3", topics: [sponsor ? PROXY_SETTLED_WITH_PERMIT_TOPIC : PROXY_SETTLED_TOPIC], data: "0x" },
  ] };
  const input = { profile: "owner", stateRoot: temp.root, rpcUrl: "https://8.8.8.8/private-rpc?key=private-key",
    record: f.record, signed: f.signed, mode: "settlement" as const, locator: tx.hash };
  let blockReads = 0;
  const batches: any[][] = [], endpoints: string[] = [];
  const wire = { chain: "0xa86a", bitmap: word(0n), tokenNonce: word(9n), proxyCode, permit2Code,
    payerCode: "0x" as Hex, balance: word(20000n), allowance: word(10000n), beforeBatch: undefined as undefined | ((calls: any[]) => Promise<void>),
    domain: X402_PERMIT2_ASSETS[0]!.tokenDomainSeparator, reorg: false, unsupportedCanonical: false, httpStatus: 200,
    missing: false, headReorg: false, tx, receipt, block, finalized };
  t.mock.method(https, "request", (endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    endpoints.push(endpoint.toString());
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const calls = JSON.parse(body); assert.ok(Array.isArray(calls)); assert.ok(calls.length <= 5); batches.push(calls);
      queueMicrotask(async () => {
        if (wire.beforeBatch !== undefined) await wire.beforeBatch(calls);
        const responses = calls.map((call: any) => {
          let result: unknown;
          if (call.method === "eth_chainId") result = wire.chain;
          else if (call.method === "eth_getBlockByNumber") {
            if (call.params[0] === "finalized") result = wire.finalized;
            else if (call.params[0] === wire.finalized.number) result = wire.headReorg ? { ...wire.finalized, hash: factHash("f") } : wire.finalized;
            else { blockReads++; result = wire.reorg && blockReads > 1 ? { ...wire.block, hash: factHash("f") } : wire.block; }
          } else if (call.method === "eth_getTransactionByHash") result = wire.missing ? null : wire.tx;
          else if (call.method === "eth_getTransactionReceipt") result = wire.missing ? null : wire.receipt;
          else {
            assert.deepEqual(call.params[1], { blockHash: input.mode === "settlement" ? wire.block.hash : wire.finalized.hash, requireCanonical: true });
            if (wire.unsupportedCanonical) return { jsonrpc: "2.0", id: call.id, error: { code: -32602, message: "private-provider-error" } };
            if (call.method === "eth_getCode") result = call.params[0] === X402_EXACT_PERMIT2_PROXY ? wire.proxyCode : call.params[0] === f.prepared.payer ? wire.payerCode : wire.permit2Code;
            else {
              assert.equal(call.method, "eth_call"); const data = call.params[0].data as string;
              result = call.params[0].to === PERMIT2_ADDRESS ? wire.bitmap : data.startsWith("0x7ecebe00") ? wire.tokenNonce : data.startsWith("0x70a08231") ? wire.balance : data.startsWith("0xdd62ed3e") ? wire.allowance : wire.domain;
            }
          }
          return { jsonrpc: "2.0", id: call.id, result };
        });
        const raw = JSON.stringify(responses.reverse()), response = new EventEmitter() as any;
        response.statusCode = wire.httpStatus; response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => response.emit("end"); receive(response);
        if (wire.httpStatus === 200) { response.emit("data", Buffer.from(raw)); response.emit("end"); }
      }); return request;
    }; return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { ...f, input, wire, batches, endpoints };
}
