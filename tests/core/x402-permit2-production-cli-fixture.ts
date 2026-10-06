import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { encodePaymentRequiredHeader } from "../../src/x402-codec.js";
import { canonicalJson } from "../../src/canonical.js";
import { Permit2ProductionRepository, permit2ProductionId } from "../../src/x402-permit2/production-repository.js";
import { encodePermit2ProductionProxyCall } from "../../src/x402-permit2/production-proxy-call.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_PERMIT2_ASSETS } from "../../src/x402-permit2/registry.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";

export async function permit2CliFixture(t: TestContext, sponsor = true, fresh = true) {
  const f = await journalFixture(t, sponsor, 120), id = permit2ProductionId("owner", "cli-production-key-001");
  if (fresh) {
    // Existing journal fixture owns a different reserved operation. Close it through genuine unsigned expiry.
    f.advance(121); await f.preparation.releaseExpired(f.record.operationId); f.advance(1);
  }
  let keys = 0, signatures = 0;
  const wrapping = { load: async () => { keys++; return Buffer.alloc(32, 7); }, create: async () => { throw new Error("No key creation"); } };
  await new EncryptedWalletStore(f.state, wrapping).save({ profile: "owner", address: f.record.material.wallet.account,
    chainId: 8453, createdAt: f.record.createdAt, bindingHash: f.record.material.wallet.bindingHash },
  { version: "apn.wallet-secret.v1", privateKey: `0x${"1".repeat(64)}`, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 7));
  const original = secp256k1.sign;
  t.mock.method(secp256k1, "sign", (...args: Parameters<typeof original>) => { signatures++; return original(...args); });
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`; f.wire.allowance = sponsor ? `0x${"0".repeat(64)}` : f.wire.allowance;
  const native = new LocalWalletNative(f.state, wrapping), records = new Permit2ProductionRepository(f.root);
  return { ...f, id, wrapping, native, records, keys: () => keys, signatures: () => signatures,
    url: f.record.material.checked.request.url, key: "cli-production-key-001" };
}
export function cliWire(t: TestContext, f: Awaited<ReturnType<typeof permit2CliFixture>>, options: { hint?: boolean; settle?: boolean; network?: `${string}:${string}`; asset?: string } = {}) {
  const calls: string[] = [], paid: Array<{ endpoint: URL; options: any; body: unknown }> = [];
  let challenge = structuredClone(f.record.material.checked.challenge);
  if (options.network !== undefined) challenge = { ...challenge, accepts: challenge.accepts.map(r => ({ ...r, network: options.network! })) };
  if (options.asset !== undefined) challenge = { ...challenge, accepts: challenge.accepts.map(r => ({ ...r, asset: options.asset! })) };
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const asset = X402_PERMIT2_ASSETS[0]!;
  const result = (c: any): unknown => {
    calls.push(c.method);
    const w = f.wire;
    if (c.method === "eth_chainId") return w.chain;
    if (c.method === "eth_getBlockByNumber") return c.params[0] === "finalized" || c.params[0] === w.finalized.number ? w.finalized : w.block;
    if (c.method === "eth_getTransactionByHash") return options.settle ? w.tx : null;
    if (c.method === "eth_getTransactionReceipt") return options.settle ? w.receipt : null;
    if (c.method === "eth_getProof") return { address: c.params[0], codeHash: c.params[0] === PERMIT2_ADDRESS ? PERMIT2_CODE_HASH : asset.proxyCodeHash };
    if (c.method === "eth_getCode") return c.params[0] === f.record.material.wallet.account ? w.payerCode : c.params[0].toLowerCase() === PERMIT2_ADDRESS.toLowerCase() ? w.permit2Code : w.proxyCode;
    assert.equal(c.method, "eth_call"); const data = c.params[0].data;
    return c.params[0].to.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() ? w.bitmap : data.startsWith("0x7ecebe00") ? w.tokenNonce : data.startsWith("0x70a08231") ? w.balance : data.startsWith("0xdd62ed3e") ? w.allowance : w.domain;
  };
  t.mock.method(https, "request", (endpoint: URL, requestOptions: any, receive: (r: any) => void) => {
    const req = new EventEmitter() as any, socket = new EventEmitter() as any;
    socket.authorized = true; socket.remoteAddress = "8.8.8.8"; req.setTimeout = () => req;
    req.destroy = () => {}; req.write = () => true;
    const respond = (status: number, rawHeaders: string[], bytes: Buffer) => {
      const response = new EventEmitter() as any;
      Object.assign(response, { statusCode: status, rawHeaders, rawTrailers: [], headers: { "content-length": String(bytes.length) }, socket,
        destroy() {}, resume() { response.emit("end"); } });
      receive(response); response.emit("data", bytes); response.emit("end");
    };
    req.end = (body: unknown) => {
      queueMicrotask(async () => {
        if (endpoint.hostname === "seller.example") {
          assert.equal(requestOptions.method, "GET"); assert.equal(body, undefined);
          if (requestOptions.headers?.["PAYMENT-SIGNATURE"] !== undefined) {
            paid.push({ endpoint, options: requestOptions, body });
            const record = (await f.records.findOperation(f.id))!; assert.ok(record.exposureJournal?.signed);
            assert.ok(requestOptions.headers["PAYMENT-SIGNATURE"] === record.exposureJournal.signed.paymentSignatureHeader, "exact owned payment header");
            assert.equal(record.exposureJournal.request!.attempt, 1);
            if (options.settle) f.wire.tx.input = await encodePermit2ProductionProxyCall(record, record.exposureJournal.signed);
            const header = Buffer.from(canonicalJson({ success: true, transaction: f.input.locator, network: asset.chain,
              payer: record.material.wallet.account.toLowerCase(), amount: "10000" })).toString("base64");
            respond(200, options.hint ? ["payment-response", header] : [], Buffer.from("private-paid-body"));
          } else { calls.push("unsigned_GET"); respond(402, ["payment-required", encodePaymentRequiredHeader(challenge)], Buffer.from("{}")); }
        } else if (endpoint.hostname === "facilitator.payai.network") {
          calls.push("supported_GET"); assert.equal(requestOptions.method, "GET");
          respond(200, [], Buffer.from(JSON.stringify({ kinds: [{ x402Version: 2, network: asset.chain, scheme: "exact" }], extensions: ["eip2612GasSponsoring"] })));
        } else {
          const rpc = JSON.parse(String(body)), rows = (Array.isArray(rpc) ? rpc : [rpc]).map(c => ({ jsonrpc: "2.0", id: c.id, result: result(c) }));
          respond(200, [], Buffer.from(JSON.stringify(Array.isArray(rpc) ? rows : rows[0])));
        }
      }); return req;
    };
    queueMicrotask(() => { req.emit("socket", socket); socket.emit("secureConnect"); }); return req;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { calls, paid };
}
