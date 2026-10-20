import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { STATE_VERSION } from "../../src/constants.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { encodePaymentRequiredHeader, type X402PaymentRequired } from "../../src/x402-codec.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_MECHANISM, permit2DomainSeparator } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { protocolSecond, testPayer } from "./x402-permit2-production-protocol-fixture.js";

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const SELLER_URL = "https://seller.example/base-permit2-resource";
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const proxyCode = readFileSync("tests/fixtures/x402-permit2/original-proxy-runtime.hex", "utf8").trim();
const avalanchePermit2 = readFileSync("tests/fixtures/x402-permit2/avalanche-permit2-runtime.hex", "utf8").trim();

/** Canonical Permit2 runtime for `chainId`: the Avalanche runtime with its two immutables rewritten (cached chain id, domain separator). */
export function permit2RuntimeFor(chainId: number): string {
  const bytes = Buffer.from(avalanchePermit2.slice(2), "hex");
  Buffer.from(word(BigInt(chainId)).slice(2), "hex").copy(bytes, 6945);
  Buffer.from(permit2DomainSeparator(chainId).slice(2), "hex").copy(bytes, 6983);
  return `0x${bytes.toString("hex")}`;
}

/** A seller offering Base USDC first by EIP-3009 and second only through Permit2 (the catalog's common Base shape). */
export function baseChallenge(): X402PaymentRequired {
  return { x402Version: 2, resource: { url: SELLER_URL, description: "Synthetic Base resource", mimeType: "application/json" },
    accepts: [
      { scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: "10000", payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" } },
      { scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: "10000", payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 120, extra: { assetTransferMethod: "permit2", name: "USD Coin", version: "2" } },
    ] };
}

export async function baseFixture(t: TestContext, admit: "permit2" | "none" = "permit2") {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const account = testPayer.address, createdAt = new Date(protocolSecond * 1000).toISOString();
  const bindingHash = hashObject({ profile: "owner", address: account, createdAt });
  await state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile: "owner", profileHash: state.profileHash("owner"), address: account, createdAt, bindingHash }));
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => { throw new Error("No key creation"); } };
  await new EncryptedWalletStore(state, wrapping).save({ profile: "owner", address: account, chainId: 8453, createdAt, bindingHash },
    { version: "apn.wallet-secret.v1", privateKey: `0x${"1".repeat(64)}`, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 7));
  await activateDirectPolicy(temp.root, "owner", { accounts: { evm: account }, now: new Date(protocolSecond * 1000),
    // "none": the owner admits Base USDC, but only for direct transfers, never for x402 Permit2.
    admissions: [{ chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: admit === "permit2" ? "x402" : "direct", maximumPerTransferAtomic: "20000",
      dailyLimitAtomic: "30000", ...(admit === "permit2" ? { mechanism: X402_PERMIT2_MECHANISM } : {}) } as never] });
  let clock = new Date((protocolSecond + 1) * 1000);
  const wire = { chain: "0x2105", permit2Code: permit2RuntimeFor(8453), bitmap: word(0n), consumed: false, balance: word(20000n), allowance: word(10000n),
    latest: { number: "0x2b", hash: `0x${"c".repeat(64)}`, timestamp: `0x${protocolSecond.toString(16)}` } };
  const calls: { method: string; params: readonly unknown[] }[] = [], paid: { signature: string }[] = [];
  const locator = `0x${"a".repeat(64)}`;
  const rpc = (c: { method: string; params: any[] }): unknown => {
    calls.push(c);
    if (c.method === "eth_chainId") return wire.chain;
    if (c.method === "eth_getBlockByNumber") return wire.latest;
    if (c.method === "eth_getTransactionByHash" || c.method === "eth_getTransactionReceipt") return null;
    if (c.method === "eth_getCode") return c.params[0] === account ? "0x" : String(c.params[0]).toLowerCase() === PERMIT2_ADDRESS.toLowerCase() ? wire.permit2Code
      : String(c.params[0]).toLowerCase() === X402_EXACT_PERMIT2_PROXY.toLowerCase() ? proxyCode : "0x";
    assert.equal(c.method, "eth_call"); assert.deepEqual(c.params[1], { blockHash: wire.latest.hash, requireCanonical: true });
    const { to, data } = c.params[0];
    // After the paid request the facilitator settled: every bit of the word reads consumed, so the frozen nonce does too.
    if (String(to).toLowerCase() === PERMIT2_ADDRESS.toLowerCase()) return wire.consumed ? word((1n << 256n) - 1n) : wire.bitmap;
    assert.equal(String(to).toLowerCase(), BASE_USDC.toLowerCase());
    return String(data).startsWith("0x70a08231") ? wire.balance : String(data).startsWith("0xdd62ed3e") ? wire.allowance : assert.fail(`unexpected token read ${data}`);
  };
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  t.mock.method(https, "request", (endpoint: URL, options: any, receive: (r: any) => void) => {
    const req = new EventEmitter() as any, socket = new EventEmitter() as any;
    socket.authorized = true; socket.remoteAddress = "8.8.8.8"; req.setTimeout = () => req; req.destroy = () => {}; req.write = () => true;
    const respond = (status: number, rawHeaders: string[], bytes: Buffer) => {
      const response = new EventEmitter() as any;
      Object.assign(response, { statusCode: status, rawHeaders, rawTrailers: [], headers: { "content-length": String(bytes.length) }, socket,
        destroy() {}, resume() { response.emit("end"); } });
      receive(response); response.emit("data", bytes); response.emit("end");
    };
    req.end = (body: unknown) => {
      queueMicrotask(() => {
        if (endpoint.hostname === "seller.example") {
          const signature = options.headers?.["PAYMENT-SIGNATURE"];
          if (signature === undefined) return respond(402, ["payment-required", encodePaymentRequiredHeader(baseChallenge())], Buffer.from("{}"));
          paid.push({ signature }); wire.consumed = true;
          const header = Buffer.from(canonicalJson({ success: true, transaction: locator, network: "eip155:8453", payer: account.toLowerCase(), amount: "10000" })).toString("base64");
          return respond(200, ["payment-response", header], Buffer.from("paid-body"));
        }
        const request = JSON.parse(String(body)), rows = (Array.isArray(request) ? request : [request]).map((c: any) => ({ jsonrpc: "2.0", id: c.id, result: rpc(c) }));
        respond(200, [], Buffer.from(JSON.stringify(Array.isArray(request) ? rows : rows[0])));
      }); return req;
    };
    queueMicrotask(() => { req.emit("socket", socket); socket.emit("secureConnect"); }); return req;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { root: temp.root, state, account, wrapping, wire, calls, paid,
    native: new LocalWalletNative(state, wrapping), now: () => new Date(clock), advance: (seconds: number) => { clock = new Date((protocolSecond + seconds) * 1000); } };
}
