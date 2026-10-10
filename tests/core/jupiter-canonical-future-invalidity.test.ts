import test from "node:test";
import assert from "node:assert/strict";
import { getAddressDecoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, signatureBytes } from "@solana/kit";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { SolanaRpc, SolanaRpcBudget, type SolanaMethod } from "../../src/solana/rpc.js";
import { adaptJupiterFutureInvalidityReadPort, verifyJupiterCanonicalFutureInvalidity,
  type JupiterFutureInvalidityInput, type JupiterFutureInvalidityReadMethod, type JupiterFutureInvalidityReadPort } from "../../src/swap/jupiter-solana/canonical-future-invalidity.js";
import { SYSTEM_PROGRAM } from "../../src/swap/jupiter-solana/catalog.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";

type DecodedMessage = ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
type DecodedV0 = Extract<DecodedMessage, { readonly version: 0 }>;
const addr = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

function signedWire(mutate?: (message: DecodedV0) => DecodedV0): string {
  const material = fixture();
  const unsigned = getTransactionDecoder().decode(Buffer.from(material.transactionBase64, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes);
  if (message.version !== 0) throw new Error("fixture must be v0");
  const changed = mutate?.(message) ?? message;
  const bytes = signatureBytes(new Uint8Array(64).fill(7));
  const encoded = getTransactionEncoder().encode({ ...unsigned, messageBytes: getCompiledTransactionMessageEncoder().encode(changed) as typeof unsigned.messageBytes,
    signatures: { [material.payer]: bytes } });
  return Buffer.from(encoded).toString("base64");
}

function inputFor(raw = signedWire(), lastValidBlockHeight: string | null = "900"): JupiterFutureInvalidityInput {
  const tx = getTransactionDecoder().decode(Buffer.from(raw, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  return { signedTransactionBase64: raw, originalQuoteRpcLifetime: { contextSlot: "100", blockhash: String(message.lifetimeToken), lastValidBlockHeight } };
}

interface FakeOptions {
  readonly originHash?: string;
  readonly genesis?: unknown;
  readonly slots?: readonly number[];
  readonly birthBlockhash?: string;
  readonly birthHeight?: number;
  readonly finalSlot?: number;
  readonly anchorBlockhash?: string;
  readonly anchorHeight?: number;
  readonly finalizedHeight?: number;
  readonly isValid?: boolean;
  readonly status?: unknown;
  readonly missingSlot?: number;
  readonly alteredBirthParent?: boolean;
  readonly blockAt?: (slot: number) => unknown;
  readonly hang?: boolean;
}

class FakeRpc implements JupiterFutureInvalidityReadPort {
  readonly originHash: string;
  readonly calls: { readonly method: JupiterFutureInvalidityReadMethod; readonly params: readonly unknown[] }[] = [];
  readonly options: FakeOptions;
  readonly birthBlockhash: string;
  constructor(options: FakeOptions = {}) {
    this.options = options;
    this.originHash = options.originHash ?? "a".repeat(64);
    this.birthBlockhash = options.birthBlockhash ?? inputFor().originalQuoteRpcLifetime.blockhash;
  }
  async read(method: JupiterFutureInvalidityReadMethod, params: readonly unknown[], signal: AbortSignal): Promise<unknown> {
    this.calls.push({ method, params });
    if (signal.aborted) throw new Error("aborted");
    if (this.options.hang) return await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    if (method === "getGenesisHash") return this.options.genesis ?? SOLANA_GENESIS;
    if (method === "getBlocks") return this.options.slots ?? [50, 60, 80, 100];
    if (method === "getSlot") return BigInt(this.options.finalSlot ?? 400);
    if (method === "getBlockHeight") return BigInt(this.options.finalizedHeight ?? 2000);
    if (method === "isBlockhashValid") return { context: { slot: BigInt(this.options.finalSlot ?? 400) }, value: this.options.isValid ?? false };
    if (method === "getSignatureStatuses") return this.options.status ?? { context: { slot: BigInt(this.options.finalSlot ?? 400) }, value: [null] };
    if (method === "getBlock") {
      const slot = Number(params[0]);
      if (this.options.blockAt !== undefined) return this.options.blockAt(slot);
      if (slot === this.options.missingSlot) return null;
      if (slot === (this.options.finalSlot ?? 400)) return {
        blockHeight: BigInt(this.options.anchorHeight ?? 2000), blockhash: this.options.anchorBlockhash ?? addr(90),
        parentSlot: BigInt(slot - 1), previousBlockhash: addr(89),
      };
      const slots = this.options.slots ?? [50, 60, 80, 100];
      const index = slots.indexOf(slot);
      if (index < 0) return null;
      const before = slots[index - 1];
      const currentHash = (i: number) => i === 0 ? this.options.birthBlockhash ?? this.birthBlockhash : addr(10 + i);
      return {
        blockHeight: BigInt((this.options.birthHeight ?? 1000) + index),
        blockhash: currentHash(index),
        parentSlot: BigInt(before ?? slot - 1),
        previousBlockhash: index === 0 ? addr(9) : currentHash(index - 1),
        ...(index === 0 && this.options.alteredBirthParent ? { parentSlot: BigInt(slot - 2) } : {}),
      };
    }
    throw new Error(`unexpected method ${method}`);
  }
}

function rpcPair(options: FakeOptions = {}, second: FakeOptions = {}) {
  return [new FakeRpc({ ...options, originHash: "a".repeat(64) }), new FakeRpc({ ...options, ...second, originHash: "b".repeat(64) })] as const;
}
async function verify(pair: readonly [JupiterFutureInvalidityReadPort, JupiterFutureInvalidityReadPort] = rpcPair(), input = inputFor(),
  options: Parameters<typeof verifyJupiterCanonicalFutureInvalidity>[2] = {}) {
  return await verifyJupiterCanonicalFutureInvalidity(input, pair, options);
}

test("narrow adapter reuses typed SolanaRpc reads and isolates only the three extended methods", async () => {
  const shared: string[] = [];
  const rpc = { originHash: "c".repeat(64), async call(method: SolanaMethod, _params: readonly unknown[]) {
    shared.push(method); return method;
  }, async batch(reads: readonly { readonly method: SolanaMethod; readonly params: readonly unknown[] }[]) {
    shared.push(`batch:${reads.length}`); return reads.map(() => "block");
  } };
  const adapter = adaptJupiterFutureInvalidityReadPort(rpc);
  const controller = new AbortController();
  assert.equal(await adapter.read("getBlock", [50, {}], controller.signal), "getBlock");
  assert.equal(await adapter.read("getBlocks", [36, 100, {}], controller.signal), "getBlocks");
  const batched = await adapter.readBlockBatch!(Array.from({ length: 17 }, () => ({ method: "getBlock" as const, params: [50, {}] })), controller.signal);
  assert.equal(batched.length, 17);
  assert.deepEqual(shared.slice(0, 2), ["getBlock", "getBlocks"]);
  assert.equal(shared.filter(method => method.startsWith("batch:")).join(","), "batch:8,batch:8,batch:1");
});

interface JsonRpcRequest { readonly jsonrpc: "2.0"; readonly id: string; readonly method: string; readonly params: readonly unknown[]; }
interface SolanaRpcHarnessOptions {
  readonly slots?: readonly number[];
  readonly birthIndex?: number;
  readonly corruptBatchResponse?: boolean;
}
function solanaRpcHarness(options: SolanaRpcHarnessOptions = {}) {
  const slots = options.slots ?? [50, 60, 80, 100];
  const birthIndex = options.birthIndex ?? 0;
  const birthBlockhash = inputFor().originalQuoteRpcLifetime.blockhash;
  const blockHashAt = (index: number) => index === birthIndex ? birthBlockhash : addr((index % 180) + 1);
  const posts: { readonly endpoint: string; readonly batchSize: number; readonly isBatch: boolean }[] = [];
  let clock = 0;
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 64, minimumIntervalMs: 750, now: () => clock, wait: async ms => { clock += ms; } });
  const fetcher = (endpoint: string): typeof fetch => async (_url, init) => {
    const payload = JSON.parse(String(init?.body)) as JsonRpcRequest | readonly JsonRpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];
    posts.push({ endpoint, batchSize: Array.isArray(payload) ? payload.length : 1, isBatch: Array.isArray(payload) });
    const result = (request: JsonRpcRequest): unknown => {
      if (request.method === "getGenesisHash") return SOLANA_GENESIS;
      if (request.method === "getBlocks") return slots;
      if (request.method === "getSlot") return 400;
      if (request.method === "getBlockHeight") return 2000;
      if (request.method === "isBlockhashValid") return { context: { slot: 400 }, value: false };
      if (request.method === "getSignatureStatuses") return { context: { slot: 400 }, value: [null] };
      if (request.method === "getBlock") {
        const slot = Number(request.params[0]);
        if (slot === 400) return { blockHeight: 2000, blockhash: addr(190), parentSlot: 399, previousBlockhash: addr(189) };
        const index = slots.indexOf(slot);
        if (index < 0) return null;
        return { blockHeight: 1000 + index, blockhash: blockHashAt(index),
          parentSlot: index === 0 ? slot - 1 : slots[index - 1],
          previousBlockhash: index === 0 ? addr(181) : blockHashAt(index - 1) };
      }
      throw new Error(`unexpected method ${request.method}`);
    };
    let responses = requests.map(request => ({ jsonrpc: "2.0", id: request.id, result: result(request) }));
    if (Array.isArray(payload)) responses = responses.reverse();
    if (options.corruptBatchResponse && Array.isArray(payload)) responses = responses.slice(1);
    return new Response(JSON.stringify(Array.isArray(payload) ? responses : responses[0]), { headers: { "content-type": "application/json" } });
  };
  const first = new SolanaRpc("https://rpc-a.example", fetcher("a"), budget);
  const second = new SolanaRpc("https://rpc-b.example", fetcher("b"), budget);
  return { budget, posts, providers: [adaptJupiterFutureInvalidityReadPort(first), adaptJupiterFutureInvalidityReadPort(second)] as const };
}

test("SolanaRpc batch scan counts one physical POST per batch and aggregates the shared 64-request budget", async () => {
  const slots = Array.from({ length: 65 }, (_, index) => 36 + index);
  const harness = solanaRpcHarness({ slots, birthIndex: 0 });
  for (let operation = 1; operation <= 2; operation += 1) {
    const result = await verify(harness.providers, inputFor());
    assert.equal(result.outcome, "future_invalidity_witness");
    if (result.outcome !== "future_invalidity_witness") continue;
    assert.ok(result.providers.every(provider => provider.readCount === 72));
    assert.equal(harness.budget.logicalCalls, operation * 144);
    assert.equal(harness.budget.physicalRequests, operation * 32);
    assert.equal(harness.posts.filter(post => post.isBatch).length, operation * 18);
    assert.ok(harness.posts.every(post => post.batchSize <= 8));
  }
  const exhausted = await verify(harness.providers, inputFor());
  assert.equal(exhausted.outcome, "inconclusive");
  assert.equal(exhausted.reason, "read_budget_exhausted");
  assert.equal(harness.budget.physicalRequests, 64);
});

test("three short checks share one SolanaRpc budget and batch response IDs are correlated", async () => {
  const harness = solanaRpcHarness();
  for (let operation = 1; operation <= 3; operation += 1) {
    const result = await verify(harness.providers, inputFor());
    assert.equal(result.outcome, "future_invalidity_witness");
    assert.equal(harness.budget.physicalRequests, operation * 16);
    assert.equal(harness.budget.logicalCalls, operation * 22);
  }
});

test("missing logical result in a SolanaRpc batch fails closed", async () => {
  const harness = solanaRpcHarness({ corruptBatchResponse: true });
  const result = await verify(harness.providers, inputFor());
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "rpc_proof_failed");
  assert.ok(harness.posts.some(post => post.batchSize > 1));
});

test("caller abort does not replenish an already-started shared SolanaRpc budget", async () => {
  let clock = 0, started = 0, finished = 0;
  let entered!: () => void, release!: () => void, allFinished!: () => void;
  const bothEntered = new Promise<void>(resolve => { entered = resolve; });
  const releasePosts = new Promise<void>(resolve => { release = resolve; });
  const bothFinished = new Promise<void>(resolve => { allFinished = resolve; });
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 2, minimumIntervalMs: 750, now: () => clock, wait: async ms => { clock += ms; } });
  const fetcher: typeof fetch = async (_url, init) => {
    started += 1;
    if (started === 2) entered();
    await releasePosts;
    finished += 1;
    if (finished === 2) allFinished();
    const request = JSON.parse(String(init?.body)) as JsonRpcRequest;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: SOLANA_GENESIS }), { headers: { "content-type": "application/json" } });
  };
  const providers = [
    adaptJupiterFutureInvalidityReadPort(new SolanaRpc("https://abort-a.example", fetcher, budget)),
    adaptJupiterFutureInvalidityReadPort(new SolanaRpc("https://abort-b.example", fetcher, budget)),
  ] as const;
  const controller = new AbortController();
  const pending = verify(providers, inputFor(), { signal: controller.signal, deadlineMs: 5000 });
  await bothEntered;
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.outcome, "inconclusive");
  assert.equal(aborted.reason, "caller_aborted");
  assert.equal(budget.physicalRequests, 2);
  release();
  await bothFinished;
  const next = await verify(providers, inputFor());
  assert.equal(next.outcome, "inconclusive");
  assert.equal(next.reason, "read_budget_exhausted");
  assert.equal(budget.physicalRequests, 2);
  assert.equal(started, 2);
});

test("canonical future-invalidity witness is deterministic and keeps signature absence non-authoritative", async () => {
  const pair = rpcPair();
  const first = await verify(pair);
  const second = await verify(rpcPair());
  assert.equal(first.outcome, "future_invalidity_witness");
  assert.equal(first.resultHash, second.resultHash);
  if (first.outcome !== "future_invalidity_witness") return;
  assert.equal(first.scope, "blockhash_future_invalidity_only");
  assert.equal(first.birth.slot, "50");
  assert.equal(first.processingAge.requiredConservativeFinalizedHeight, "1152");
  assert.equal(first.providers.length, 2);
  assert.ok(first.providers.every(provider => provider.isBlockhashValid === false && provider.signatureStatusObservation === "not_reported"));
  assert.equal("signedTransactionBase64" in first, false);
  assert.equal("signature" in first, false);
  assert.ok(pair.every(rpc => rpc.calls.every(call => ["getGenesisHash", "getBlocks", "getBlock", "getSlot", "getBlockHeight", "isBlockhashValid", "getSignatureStatuses"].includes(call.method))));
});

test("H+150 and H+151 remain inconclusive at the documented processing-age boundary", async () => {
  const birthBlockhash = inputFor().originalQuoteRpcLifetime.blockhash;
  const at150 = await verify(rpcPair({ birthHeight: 1000, finalizedHeight: 1150, anchorHeight: 1150, birthBlockhash }));
  const at151 = await verify(rpcPair({ birthHeight: 1000, finalizedHeight: 1151, anchorHeight: 1151, birthBlockhash }));
  assert.equal(at150.outcome, "inconclusive");
  assert.equal(at150.reason, "processing_age_not_exceeded");
  assert.equal(at151.outcome, "inconclusive");
  assert.equal(at151.reason, "processing_age_not_exceeded");
});

test("H+152 meets only the helper's conservative finalized-height safety bound", async () => {
  const birthBlockhash = inputFor().originalQuoteRpcLifetime.blockhash;
  const at152 = await verify(rpcPair({ birthHeight: 1000, finalizedHeight: 1152, anchorHeight: 1152, birthBlockhash }));
  assert.equal(at152.outcome, "future_invalidity_witness");
  if (at152.outcome === "future_invalidity_witness") {
    assert.equal(at152.processingAge.requiredConservativeFinalizedHeight, "1152");
  }
});

test("false validity while the bank has not passed the processing horizon is inconclusive", async () => {
  const result = await verify(rpcPair({ birthHeight: 1000, finalizedHeight: 1150, anchorHeight: 1150, isValid: false }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "processing_age_not_exceeded");
});

test("a positive finalized isBlockhashValid result is inconclusive even after the height horizon", async () => {
  const result = await verify(rpcPair({ isValid: true }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "blockhash_still_valid");
});

test("authenticated last-valid height is an additional bound, never a substitute for birth", async () => {
  const result = await verify(rpcPair({ finalizedHeight: 2000 }), inputFor(undefined, "2000"));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "quote_lifetime_not_exceeded");
  const absentBirth = await verify(rpcPair({ slots: [] }), inputFor(undefined, "900"));
  assert.equal(absentBirth.outcome, "inconclusive");
  assert.equal(absentBirth.reason, "empty_or_missing_history");
});

test("missing finalized archive block in the bounded history refuses", async () => {
  const result = await verify(rpcPair({ missingSlot: 60 }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "archive_data_missing");
});

test("a bounded finalized search without an exact hash match is inconclusive", async () => {
  const result = await verify(rpcPair({ birthBlockhash: addr(120) }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "birth_not_found");
});

test("two providers must agree on every finalized candidate header and the exact birth", async () => {
  const result = await verify(rpcPair({}, { birthHeight: 1001 }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "finalized_history_mismatch");
});

test("mainnet genesis is checked independently before block history", async () => {
  const result = await verify(rpcPair({ genesis: addr(11) }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "wrong_genesis");
});

test("common finalized reanchor must be monotonic and match across providers", async () => {
  const result = await verify(rpcPair({}, { anchorBlockhash: addr(91) }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "reanchor_failed");
  const stale = await verify(rpcPair({ finalSlot: 49 }));
  assert.equal(stale.outcome, "inconclusive");
  assert.equal(stale.reason, "reanchor_failed");
});

test("signature status presence, including finalized, blocks a future-invalidity-only result", async () => {
  const status = { context: { slot: 400n }, value: [{ slot: 101n, confirmationStatus: "finalized", err: null }] };
  const result = await verify(rpcPair({ status }));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "signature_status_reported");
});

test("durable nonce first instruction is refused before any RPC read", async () => {
  const raw = signedWire(message => {
    const systemIndex = message.staticAccounts.findIndex(address => address === SYSTEM_PROGRAM);
    assert.ok(systemIndex >= 0);
    return { ...message, instructions: [{ ...message.instructions[0]!, programAddressIndex: systemIndex, data: new Uint8Array([4, 0, 0, 0]) }, ...message.instructions.slice(1)] };
  });
  const pair = rpcPair();
  const result = await verify(pair, inputFor(raw));
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "durable_nonce");
  assert.ok(pair.every(rpc => rpc.calls.length === 0));
});

test("unresolved ALT first program is refused; resolved non-system program can proceed", async () => {
  const material = fixture();
  const unsigned = getTransactionDecoder().decode(Buffer.from(material.transactionBase64, "base64"));
  const original = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes);
  if (original.version !== 0) throw new Error("fixture must be v0");
  assert.ok((original.addressTableLookups ?? []).length > 0);
  const raw = signedWire(message => ({ ...message, instructions: [{ ...message.instructions[0]!, programAddressIndex: message.staticAccounts.length }, ...message.instructions.slice(1)] }));
  const missing = await verify(rpcPair(), inputFor(raw));
  assert.equal(missing.outcome, "inconclusive");
  assert.equal(missing.reason, "unresolved_alt_program");
  const resolved = {
    signedTransactionBase64: raw,
    originalQuoteRpcLifetime: inputFor(raw).originalQuoteRpcLifetime,
    resolvedLookupAddresses: {
      loadedWritable: material.compiledAccounts.filter(account => account.source === "lookup" && account.writable).map(account => account.address),
      loadedReadonly: material.compiledAccounts.filter(account => account.source === "lookup" && !account.writable).map(account => account.address),
    },
  };
  const complete = await verify(rpcPair(), resolved);
  assert.equal(complete.outcome, "future_invalidity_witness");
});

test("all 65 candidate slots stay within the 72-read provider ceiling", async () => {
  const slots = Array.from({ length: 65 }, (_, index) => 36 + index);
  const birthBlockhash = inputFor().originalQuoteRpcLifetime.blockhash;
  const currentHash = (index: number) => index === 0 ? birthBlockhash : addr(10 + index);
  const blockAt = (slot: number) => {
    const index = slots.indexOf(slot);
    if (index < 0) return slot === 400 ? { blockHeight: 2000n, blockhash: addr(90), parentSlot: 399n, previousBlockhash: addr(89) } : null;
    return { blockHeight: BigInt(1000 + index), blockhash: currentHash(index),
      parentSlot: BigInt(index === 0 ? slot - 1 : slots[index - 1]!), previousBlockhash: index === 0 ? addr(9) : currentHash(index - 1) };
  };
  const pair = rpcPair({ slots, blockAt, birthHeight: 1000 });
  const result = await verify(pair);
  assert.equal(result.outcome, "future_invalidity_witness");
  assert.ok(pair.every(rpc => rpc.calls.length <= 72));
  assert.ok(pair.every(rpc => rpc.calls.length === 72));
  for (const rpc of pair) {
    const blocks = rpc.calls.find(call => call.method === "getBlocks")!;
    assert.deepEqual(blocks.params, [36, 100, { commitment: "finalized", minContextSlot: 100 }]);
    const block = rpc.calls.find(call => call.method === "getBlock")!;
    assert.deepEqual(block.params[1], { commitment: "finalized", encoding: "json", transactionDetails: "none", maxSupportedTransactionVersion: 0, rewards: false });
  }
});

test("descending finite search stops after the first batch containing the exact birth block", async () => {
  const slots = Array.from({ length: 65 }, (_, index) => 36 + index);
  const birthBlockhash = inputFor().originalQuoteRpcLifetime.blockhash;
  const currentHash = (index: number) => index === 64 ? birthBlockhash : addr(10 + index);
  const blockAt = (slot: number) => {
    const index = slots.indexOf(slot);
    if (index < 0) return slot === 400 ? { blockHeight: 2000n, blockhash: addr(190), parentSlot: 399n, previousBlockhash: addr(189) } : null;
    return { blockHeight: BigInt(1000 + index), blockhash: currentHash(index),
      parentSlot: BigInt(index === 0 ? slot - 1 : slots[index - 1]!), previousBlockhash: index === 0 ? addr(181) : currentHash(index - 1) };
  };
  const pair = rpcPair({ slots, blockAt, birthHeight: 1064 });
  const result = await verify(pair);
  assert.equal(result.outcome, "future_invalidity_witness");
  assert.ok(pair.every(rpc => rpc.calls.filter(call => call.method === "getBlock" && call.params[0] !== 400).length === 8));
});

test("caller abort and one absolute deadline stop further reads without per-call reset", async () => {
  const controller = new AbortController();
  const abortedPair = rpcPair({ hang: true });
  setTimeout(() => controller.abort(), 2);
  const aborted = await verify(abortedPair, inputFor(), { signal: controller.signal, deadlineMs: 1000 });
  assert.equal(aborted.outcome, "inconclusive");
  assert.equal(aborted.reason, "caller_aborted");
  const timeout = await verify(rpcPair({ hang: true }), inputFor(), { deadlineMs: 2 });
  assert.equal(timeout.outcome, "inconclusive");
  assert.equal(timeout.reason, "deadline_exceeded");
});
