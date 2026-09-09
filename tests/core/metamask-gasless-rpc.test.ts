import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keccak256 } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { Address, Hex } from "../../src/model.js";
import { addressWord, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC } from
  "../../src/metamask-gasless/chain/abi.js";
import { MetaMaskGaslessRpc, metaMaskGaslessRpcFactory } from "../../src/metamask-gasless/chain/rpc.js";
import { validateMetaMaskGaslessSnapshot } from "../../src/metamask-gasless/chain/snapshot.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import { MM_CHAINS, type MetaMaskGaslessChainId, type MetaMaskGaslessChainState,
  type MetaMaskGaslessIntent } from "../../src/metamask-gasless/model.js";
import { MM_RPC_ENV, mmRegistry } from "../../src/metamask-gasless/registry.js";

type Json = Record<string, any>;
const RUNTIME_PATH = "tests/core/metamask-gasless-chain-fixtures/runtime-code.json";
const VECTOR_PATH = "tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json";
const runtimeText = readFileSync(RUNTIME_PATH, "utf8"), runtime = JSON.parse(runtimeText) as Json;
const vector = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Json;
const RPC_URL = "https://rpc.example/private-path";
const now = { now: () => new Date("2026-09-09T00:01:00.000Z") };
const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
const blockHash = (chainId: number, number: bigint): Hex => `0x${sha256(`mm-rpc-${chainId}-${number}`)}`;

interface FakeOptions {
  readonly finality?: bigint;
  readonly head?: bigint;
  readonly counter?: (blockNumber: bigint) => bigint;
  readonly corruptProtocol?: boolean;
  readonly transaction?: Json;
  readonly receipt?: Json;
  readonly reorgBlock?: bigint;
}

class FakeRpcTransport implements GaslessTransport {
  readonly calls: Array<{ readonly method: string; readonly params: readonly unknown[] }> = [];
  readonly chainId: MetaMaskGaslessChainId;
  private readonly deployment;
  private readonly codes: Json;
  constructor(chainId: MetaMaskGaslessChainId, private readonly options: FakeOptions = {}) {
    this.chainId = chainId; this.deployment = mmRegistry(chainId).row;
    const refs = runtime.rows.find((item: Json) => item.chainId === chainId) as Json;
    assert.ok(refs); this.codes = { protocol: Object.fromEntries(Object.entries(refs.protocol)
      .map(([name, ref]) => [name, runtime.codes[String(ref)]])),
    tokenProxyCode: runtime.codes[refs.tokenProxyCode], tokenImplementationCode: runtime.codes[refs.tokenImplementationCode] };
  }
  async request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    assert.equal(endpoint, RPC_URL); assert.equal(method, "POST"); assert.notEqual(body, null);
    assert.equal(maxBytes, 4 * 1024 * 1024); assert.equal(code, "APN_RPC_CONFIG");
    const request = JSON.parse(body!) as Json;
    this.calls.push({ method: request.method, params: request.params });
    const result = this.respond(request.method, request.params);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }
  private respond(method: string, params: readonly unknown[]): unknown {
    if (method === "eth_chainId") return quantity(this.chainId);
    if (method === "eth_getBlockByNumber") return this.rawBlock(params[0] as string);
    if (method === "eth_getCode") return this.code(params[0] as string, blockNumber(params.at(-1)));
    if (method === "eth_getStorageAt") return addressWord(this.deployment.tokenImplementationAddress);
    if (method === "eth_call") {
      const call = params[0] as Json, selector = String(call.data).slice(0, 10);
      if (selector === "0x313ce567") return word(6n);
      if (selector === "0x70a08231") return word(1_000_000n);
      if (call.to.toLowerCase() === this.deployment.protocol.limitedCalls.address) {
        return word(this.options.counter?.(blockNumber(params.at(-1))) ?? 0n);
      }
      throw new Error(`unexpected eth_call ${selector}`);
    }
    if (method === "eth_getTransactionByHash") return this.options.transaction ?? null;
    if (method === "eth_getTransactionReceipt") return this.options.receipt ?? null;
    if (method === "eth_getLogs") return [];
    throw new Error(`unexpected write or unknown RPC method ${method}`);
  }
  private rawBlock(tag: string): Json {
    const number = tag === "safe" || tag === "finalized" ? (this.options.finality ?? 100n) :
      tag === "latest" ? (this.options.head ?? this.options.finality ?? 101n) : BigInt(tag);
    const hash = this.options.reorgBlock === number ? `0x${"f".repeat(64)}` : blockHash(this.chainId, number);
    const transactions = this.options.transaction?.blockNumber === quantity(number) ?
      [this.options.transaction.hash] : [];
    return { number: quantity(number), hash, timestamp: quantity(1_788_912_000n + number), transactions };
  }
  private code(addressInput: string, _blockNumber: bigint): Hex {
    const address = addressInput.toLowerCase(), row = this.deployment;
    for (const [name, pin] of Object.entries(row.protocol)) if (address === pin.address) {
      const code = this.codes.protocol[name] as Hex;
      return this.options.corruptProtocol && name === "manager" ? `${code.slice(0, -2)}00` as Hex : code;
    }
    if (address === row.token) return this.codes.tokenProxyCode as Hex;
    if (address === row.tokenImplementationAddress) return this.codes.tokenImplementationCode as Hex;
    if (address === vector.owner) return `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
    return "0x";
  }
}

test("static runtime fixture drives fixed EIP-1898 snapshots for all eight registry rows", async () => {
  assert.equal(sha256(runtimeText), "f37646220871b16931912855b8e5eb0a6627318378e7c132dabd165815364682");
  for (const chainId of MM_CHAINS) {
    const transport = new FakeRpcTransport(chainId);
    const rpc = new MetaMaskGaslessRpc({ chainId, rpcUrl: RPC_URL, clock: now, transport });
    const snapshot = await rpc.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash,
      grossAtomic: "1000000" });
    assert.equal(snapshot.chainId, chainId); assert.equal(snapshot.safeState.counterAtomic, "0");
    assert.equal(snapshot.headState.designation, "pinned");
    assert.ok(transport.calls.every(call => readMethods.has(call.method)));
    const pinned = transport.calls.filter(call => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(call.method));
    assert.ok(pinned.every(call => (call.params.at(-1) as Json).requireCanonical === true));
  }
});

test("lazy factory binds exact endpoints and protocol drift fails closed", async () => {
  const environment: Record<string, string> = {};
  for (const chainId of MM_CHAINS) environment[MM_RPC_ENV[chainId]] = RPC_URL;
  const transport = new FakeRpcTransport(8453), factory = metaMaskGaslessRpcFactory(environment, now, transport);
  assert.equal(transport.calls.length, 0); assert.equal(factory(8453), factory(8453));
  assert.equal(factory(8453).endpointHash, sha256(RPC_URL)); assert.equal(factory(8453).endpointOrigin, "https://rpc.example");
  const drift = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { corruptProtocol: true }) });
  await assert.rejects(drift.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash,
    grossAtomic: "1000000" }), protocolError);
});

test("same-height snapshot blocks must have identical hash and timestamp", () => {
  const snapshot = intent(block(8453, 100n)).initialSnapshot;
  assert.equal(validateMetaMaskGaslessSnapshot(snapshot, { chainId: 8453, endpointHash: sha256(RPC_URL),
    endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }).headBlock.hash, snapshot.safeBlock.hash);
  assert.throws(() => validateMetaMaskGaslessSnapshot({ ...snapshot,
    headBlock: { ...snapshot.headBlock, hash: `0x${"e".repeat(64)}` } }, { chainId: 8453,
    endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }), protocolError);
  assert.throws(() => validateMetaMaskGaslessSnapshot({ ...snapshot,
    headBlock: { ...snapshot.headBlock, timestampAtomic: "1788912101" } }, { chainId: 8453,
    endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }), protocolError);
});

test("scan advances one complete 2000-block window and preserves cursor on a later reorg", async () => {
  const firstTransport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n });
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: firstTransport });
  const value = intent(block(8453, 100n));
  const initial = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const first = await rpc.observe(value, initial, null);
  assert.equal(first.observation.phase, "pending"); assert.equal(first.cursor.nextBlockAtomic, "2100");
  assert.equal(first.cursor.previousEndBlock?.numberAtomic, "2099");
  const filter = firstTransport.calls.find(call => call.method === "eth_getLogs")!.params[0] as Json;
  assert.equal(filter.fromBlock, "0x64"); assert.equal(filter.toBlock, "0x833");
  const reorgRpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { finality: 2500n, reorgBlock: 2099n }) });
  const second = await reorgRpc.observe(value, first.cursor, null);
  assert.equal(second.observation.phase, "reorg"); assert.deepEqual(second.cursor, first.cursor);
});

test("full chain proof wins when provider reports failed", async () => {
  const value = intent(block(8453, 100n));
  const txBlock = block(8453, 101n), finality = block(8453, 102n);
  const transaction = { ...vector.type2.raw, blockNumber: "0x65", blockHash: txBlock.hash, transactionIndex: "0x0" };
  const receipt = { transactionHash: vector.type2.hash, blockNumber: "0x65", blockHash: txBlock.hash,
    transactionIndex: "0x0", type: "0x2", from: vector.relayer, to: value.relayTo, status: "0x1",
    logs: rawSettlementLogs(value, txBlock) };
  const transport = new FakeRpcTransport(8453, { finality: 102n, head: 102n, transaction, receipt,
    counter: number => number >= 101n ? 1n : 0n });
  let tick = 0;
  const advancingClock = { now: () => new Date(Date.parse("2026-09-09T00:01:00.000Z") + tick++ * 1000) };
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: advancingClock, transport });
  const observed = await rpc.observe(value, { startBlock: value.initialSnapshot.safeBlock,
    nextBlockAtomic: "100", previousEndBlock: null }, { observedAt: "2026-09-09T00:00:30.000Z",
    requestIdHash: hashObject({ request: "synthetic" }), status: "failed", txHash: vector.type2.hash });
  assert.equal(observed.observation.phase, "success"); assert.equal(observed.settlement?.debitAtomic, "1000000");
  assert.equal(observed.observation.observedAt, observed.settlement?.observedAt);
  assert.equal(observed.settlement?.outerSender, vector.relayer); assert.deepEqual(observed.settlement?.finalityBlock, finality);
  assert.ok(transport.calls.every(call => readMethods.has(call.method)));
});

test("confirmed provider hash stays private when RPC has no transaction or receipt", async () => {
  const value = intent(block(8453, 100n));
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { finality: 100n, head: 101n }) });
  const observed = await rpc.observe(value, { startBlock: value.initialSnapshot.safeBlock,
    nextBlockAtomic: "100", previousEndBlock: null }, { observedAt: "2026-09-09T00:00:30.000Z",
    requestIdHash: hashObject({ request: "synthetic" }), status: "confirmed", txHash: vector.type2.hash });
  assert.equal(observed.observation.phase, "pending"); assert.equal(observed.observation.reason, "mm_gasless_pending");
  assert.equal(observed.observation.candidateTxHash, null); assert.equal(observed.settlement, null);
});

function intent(start: ReturnType<typeof block>): MetaMaskGaslessIntent {
  const deployment = mmRegistry(8453), row = deployment.row;
  const executions = vector.executions as MetaMaskGaslessIntent["quote"]["executions"];
  const quote = { netAtomic: "900000", feeAtomic: "100000", feeRecipient: vector.feeRecipient as Address,
    executions, hash: "" }; quote.hash = mmQuoteHash(quote);
  const state = chainState("0");
  return { profile: "synthetic", request: { chainId: 8453, recipient: vector.recipient,
    grossAtomic: "1000000", maxFeeAtomic: "100000", minReceivedAtomic: "900000" },
    binding: { providerId: "metamask-agent-wallet", address: vector.owner,
      accountBindingHash: "2".repeat(64), capabilityHash: "3".repeat(64), revision: 1,
      projectHash: "4".repeat(64), walletReferenceHash: "5".repeat(64), walletIdHash: mmWalletIdentityHash(vector.owner),
      namespace: "eip155", mode: "server", environment: "prod" }, token: row.token, decimals: 6,
    deploymentEvidenceHash: deployment.deploymentEvidenceHash, initialSnapshot: { chainId: 8453,
      endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", observedAt: "2026-09-09T00:00:00.000Z",
      safeBlock: start, headBlock: start, safeState: state, headState: state }, quote,
    requestId: "synthetic-request", preparedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "6".repeat(64),
    unsignedDelegation: vector.unsignedDelegation, delegationHash: vector.delegationHash,
    signingDigest: vector.signingDigest, relayTo: row.protocol.manager.address, mode: vector.mode } as MetaMaskGaslessIntent;
}

function chainState(counterAtomic: string): MetaMaskGaslessChainState {
  const row = mmRegistry(8453).row, code = `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
  return { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
    [name, pin.codeHash])) as MetaMaskGaslessChainState["protocolCodeHashes"], tokenProxyCodeHash: row.tokenProxyCodeHash,
    tokenImplementationAddress: row.tokenImplementationAddress, tokenImplementationCodeHash: row.tokenImplementationCodeHash,
    tokenDecimals: 6, ownerCodeHash: keccak256(code), designation: "pinned", usdcBalanceAtomic: "1000000", counterAtomic };
}

function block(chainId: number, number: bigint) {
  return { numberAtomic: number.toString(), hash: blockHash(chainId, number),
    timestampAtomic: (1_788_912_000n + number).toString() };
}

function blockNumber(value: unknown): bigint {
  if (typeof value === "object" && value !== null && "blockHash" in value) {
    for (const number of [100n, 101n, 102n, 2099n, 2500n, 2501n])
      if ((value as Json).blockHash === blockHash(8453, number)) return number;
  }
  return 0n;
}

function rawSettlementLogs(value: MetaMaskGaslessIntent, at: ReturnType<typeof block>): Json[] {
  const row = mmRegistry(8453).row, common = { transactionHash: vector.type2.hash, blockHash: at.hash,
    blockNumber: "0x65", transactionIndex: "0x0", removed: false };
  return [{ ...common, address: row.protocol.limitedCalls.address, logIndex: "0x0",
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), addressWord(vector.relayer),
      value.delegationHash], data: `${word(1n)}${word(1n).slice(2)}` },
  { ...common, address: row.token, logIndex: "0x1",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.recipient)], data: word(900000n) },
  { ...common, address: row.token, logIndex: "0x2",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.feeRecipient)], data: word(100000n) }];
}

const readMethods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt",
  "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const protocolError = { code: "APN_RPC_PROTOCOL" };
