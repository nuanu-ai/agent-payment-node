import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fixtureBlockHash, makeSignedEffect } from "./signed-effect.mjs";

const MIMIR = "https://agentic-mimir-service.api.cx.metamask.io";
const PROXY = "https://agentic-proxy.workers.cx.metamask.io";
const chainIds = [1, 10, 137, 143, 1329, 8453, 42161, 59144];
const slugs = { 1: "ethereum", 10: "optimism", 137: "polygon", 143: "monad", 1329: "sei", 8453: "base", 42161: "arbitrum", 59144: "linea" };
const quantity = value => `0x${BigInt(value).toString(16)}`;
const word = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const sha = value => createHash("sha256").update(value).digest("hex");
const read = path => JSON.parse(readFileSync(path, "utf8"));
export function readFixture(path) { return read(path); }
export function writeFixture(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, path);
}
export function trace(path, entry) {
  const fixture = read(path);
  appendFileSync(fixture.tracePath, JSON.stringify({ process: process.pid, ...entry }) + "\n", { mode: 0o600 });
}

export async function respond(path, url, method, headers, body) {
  const f = read(path), { row } = f;
  const request = body === null ? null : JSON.parse(body);
  const header = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const isRpc = url === f.rpcUrl;
  const isInventory = url === `${MIMIR}/v1/supportedNetworks` || url === `${PROXY}/proxy/prd/accounts/v2/supportedNetworks`;
  assert.ok(Object.keys(header).every(key => ["accept", "content-type", "authorization", "accept-encoding", "content-length"].includes(key)));
  if (isRpc || isInventory) assert.equal(header.authorization, undefined);
  else assert.equal(header.authorization, `Bearer ${f.token}`);
  trace(path, { kind: "https", origin: new URL(url).origin, pathHash: sha(new URL(url).pathname), method,
    rpcMethod: request?.method ?? null, bodyHash: body === null ? null : sha(body), bearer: Boolean(header.authorization),
    requestIdHash: request?.requestId ? sha(request.requestId) : null });
  if (f.transportFault === "redirect") return { status: 302, body: "{}", headers: { location: "https://unexpected.example" } };
  if (f.transportFault === "invalid-utf8") return { status: 200, bytes: Buffer.from([0xc3, 0x28]) };
  if (f.transportFault === "oversized-header") return { status: 200, body: "{}", headers: { "content-length": "4194305" } };
  if (isRpc) {
    assert.equal(method, "POST"); assert.equal(request.jsonrpc, "2.0");
    const result = rpcResult(f, request.method, request.params);
    return json({ jsonrpc: "2.0", id: request.id, result });
  }
  if (url === `${MIMIR}/v1/supportedNetworks`) {
    assert.equal(method, "GET"); assert.equal(body, null);
    if (f.inventoryFailure) return { status: 503, body: "{}" };
    return json({ networks: chainIds.map(chainId => ({ chainId, name: `chain-${chainId}`, networkType: "mainnet", shieldSupported: true })) });
  }
  if (url === `${PROXY}/proxy/prd/accounts/v2/supportedNetworks`) {
    assert.equal(method, "GET"); assert.equal(body, null);
    return json({ fullSupport: chainIds.map(id => `eip155:${id}`), partialSupport: [] });
  }
  if (url === `${PROXY}/proxy/prd/tx-sentinel-ethereum-mainnet/networks`) {
    assert.equal(method, "GET"); assert.equal(body, null);
    return json(Object.fromEntries(chainIds.map(id => [id, { relayTransactions: true }])));
  }
  if (url === `${PROXY}/proxy/prd/tx-sentinel-${slugs[row.chainId]}-mainnet`) {
    assert.equal(method, "POST"); assert.equal(request.method, "infura_simulateTransactions");
    assert.deepEqual(Object.keys(request).sort(), ["id", "jsonrpc", "method", "params"]);
    assert.equal(request.params.length, 1);
    const params = request.params[0];
    assert.deepEqual(Object.keys(params).sort(), ["suggestFees", "transactions"]);
    assert.deepEqual(params.suggestFees, { withTransfer: true, withFeeTransfer: true, with7702: true });
    assert.equal(params.transactions.length, 1);
    const tx = params.transactions[0];
    assert.deepEqual(Object.keys(tx).sort(), ["authorizationList", "data", "from", "to", "value"]);
    assert.equal(tx.from.toLowerCase(), f.owner); assert.equal(tx.to.toLowerCase(), row.token); assert.equal(tx.value, "0x0");
    assert.equal(tx.data.slice(0, 10), "0xa9059cbb");
    assert.equal(tx.data.slice(10, 74), f.recipient.slice(2).padStart(64, "0"));
    assert.ok(BigInt(`0x${tx.data.slice(74)}`) > 0n);
    assert.deepEqual(tx.authorizationList.map(auth => ({ address: auth.address.toLowerCase(), from: auth.from.toLowerCase() })),
      [{ address: row.protocol.delegate.address, from: f.owner }]);
    const rawFee = f.rawFeeAtomic ?? "1000";
    return json({ jsonrpc: "2.0", id: request.id, result: { transactions: [{ fees: [{ tokenFees: [{
      token: { address: row.token, symbol: "USDC", decimals: 6 }, balanceNeededToken: rawFee, feeRecipient: f.feeRecipient,
    }] }] }] } });
  }
  const collection = `${MIMIR}/v1/projects/${f.project}/transaction-requests`;
  if (url === collection && method === "POST") {
    assert.equal(f.postCount, 0, "a second provider POST is never allowed");
    // Verify the authoritative record already contains the irreversible marker.
    const operation = read(f.operationPath);
    assert.equal(operation.submissionAttempts, 1); assert.equal(operation.state, "dispatch_pending");
    assert.equal(operation.intent.requestId, request.requestId);
    const effect = await makeSignedEffect(f.packageRoot, f, request, { type: f.initialDesignation === "empty" ? 4 : 2 });
    const dispatched = operation.dispatch ?? operation.intent;
    assert.equal(effect.delegationHash, dispatched.delegationHash);
    assert.equal(effect.signingDigest, dispatched.signingDigest);
    assert.equal(effect.deliveredAtomic, (operation.dispatch?.quote ?? operation.intent.quote).netAtomic);
    assert.equal(effect.feeAtomic, (operation.dispatch?.quote ?? operation.intent.quote).feeAtomic);
    writeFixture(path, { ...f, postCount: 1, effect, phase: f.afterPostPhase ?? "success" });
    trace(path, { kind: "provider-post", requestIdHash: sha(request.requestId), marker: operation.state,
      delegationHash: effect.delegationHash });
    if (f.submitResponseLost) throw new Error("synthetic lost response");
    return json({ requestId: request.requestId, status: f.providerStatus ?? "BROADCASTED", tx: request.tx, txHash: effect.transaction.hash });
  }
  const savedRequestId = f.operationPath === null ? null : read(f.operationPath).intent.requestId;
  if (savedRequestId && url === `${collection}/${savedRequestId}` && method === "GET") {
    assert.equal(body, null);
    trace(path, { kind: "provider-get", requestIdHash: sha(savedRequestId) });
    if (!f.effect) return { status: 404, body: "{}" };
    if (f.observeUnauthorized) return { status: 401, body: "{}" };
    return json({ requestId: f.effect.requestId, status: f.providerStatus ?? "CONFIRMED", tx: f.effect.posted.tx,
      txHash: f.effect.transaction.hash });
  }
  throw new Error(`unexpected offline request ${method} ${new URL(url).origin}`);
}

function json(value) { return { status: 200, body: JSON.stringify(value) }; }
function rpcResult(f, method, params) {
  const { row, effect } = f, chain = row.chainId;
  const proved = effect && ["success", "reverted"].includes(f.phase);
  const transactionNumber = proved ? Number(BigInt(effect.transaction.blockNumber)) : 102;
  const safe = proved ? transactionNumber + 1 : 100, latest = proved ? safe : 101;
  const blockNumber = ref => {
    if (ref === "latest" || ref === "pending") return latest;
    if (ref === "safe" || ref === "finalized") return safe;
    if (typeof ref === "string") return Number(BigInt(ref));
    assert.equal(ref.requireCanonical, true);
    for (const number of [100, 101, 102, 103, 104, 105]) if (fixtureBlockHash(chain, number) === ref.blockHash) return number;
    throw new Error("unexpected state block");
  };
  if (method === "eth_chainId") { assert.deepEqual(params, []); return quantity(chain); }
  if (method === "eth_getBlockByNumber") {
    const number = blockNumber(params[0]);
    const transactions = proved && number === transactionNumber ?
      [params[1] ? effect.transaction : effect.transaction.hash] : [];
    return { number: quantity(number), hash: fixtureBlockHash(chain, number),
      timestamp: quantity(f.epochSeconds + number), transactions };
  }
  if (method === "eth_getCode") {
    const [target, ref] = params, address = target.toLowerCase(), number = blockNumber(ref);
    for (const [name, pin] of Object.entries(row.protocol)) if (address === pin.address) {
      return f.corruptProtocol && name === "manager" ? "0x6000" : f.codes.protocol[name];
    }
    if (address === row.token) return f.codes.tokenProxy;
    if (address === row.tokenImplementationAddress) return f.codes.tokenImplementation;
    if (address === f.owner) return f.initialDesignation === "pinned" || (proved && number >= transactionNumber) ?
      `0xef0100${row.protocol.delegate.address.slice(2)}` : "0x";
    throw new Error("unexpected code target");
  }
  if (method === "eth_getStorageAt") {
    assert.equal(params[0].toLowerCase(), row.token); assert.equal(params[1], row.tokenImplementationSlot);
    blockNumber(params[2]); return `0x${row.tokenImplementationAddress.slice(2).padStart(64, "0")}`;
  }
  if (method === "eth_call") {
    const [call, ref] = params, number = blockNumber(ref), data = call.data.toLowerCase();
    if (call.to.toLowerCase() === row.token && data === "0x313ce567") return word(6n);
    if (call.to.toLowerCase() === row.token && data === `0x70a08231${f.owner.slice(2).padStart(64, "0")}`) return word(1000000000n);
    if (call.to.toLowerCase() === row.protocol.limitedCalls.address) {
      assert.match(data, /^0x[0-9a-f]{136}$/u);
      assert.equal(data.slice(10, 74), row.protocol.manager.address.slice(2).padStart(64, "0"));
      if (effect) assert.equal(`0x${data.slice(74)}`, effect.delegationHash);
      return word(proved && f.phase === "success" && number >= transactionNumber ? 1n : 0n);
    }
    throw new Error("unexpected call target or payload");
  }
  if (method === "eth_getTransactionByHash") return proved && params[0] === effect.transaction.hash ? effect.transaction : null;
  if (method === "eth_getTransactionReceipt") {
    if (!proved || params[0] !== effect.transaction.hash) return null;
    if (f.phase === "reverted") return { ...effect.receipt, status: "0x0", logs: [] };
    const logs = [...effect.receipt.logs];
    for (let index = logs.length; index < (f.receiptLogCount ?? logs.length); index += 1) {
      logs.push({ ...logs[0], logIndex: quantity(index), address: "0x4444444444444444444444444444444444444444",
        topics: [`0x${sha("UnrelatedEvent()")}`], data: "0x" });
    }
    return { ...effect.receipt, logs };
  }
  if (method === "eth_getLogs") {
    const filter = params[0]; assert.equal(filter.address.toLowerCase(), row.protocol.limitedCalls.address);
    assert.ok(BigInt(filter.toBlock) - BigInt(filter.fromBlock) <= 1999n);
    if (!proved || f.phase !== "success" || f.emptyScanPage) return [];
    if (transactionNumber < Number(BigInt(filter.fromBlock)) || transactionNumber > Number(BigInt(filter.toBlock))) return [];
    assert.equal(filter.topics[3], effect.delegationHash); return [effect.receipt.logs[0]];
  }
  if (method === "eth_getBalance") { assert.equal(params[0].toLowerCase(), f.owner); return "0x0"; }
  throw new Error("unexpected write or RPC method: " + method);
}
