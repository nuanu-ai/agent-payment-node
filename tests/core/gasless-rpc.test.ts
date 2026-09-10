import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, keccak256, parseTransaction,
  type Abi, type AbiParameter, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { GASLESS_ENTRYPOINT_ABI, GASLESS_PAYMASTER_ABI, GASLESS_TOKEN_ABI } from "../../src/gasless/abi.js";
import { gaslessFee, gaslessGas } from "../../src/gasless/economics.js";
import { GaslessHttps, type GaslessTransport } from "../../src/gasless/https.js";
import type { GaslessBlock, GaslessCursor, GaslessDeployment, GaslessIntent, GaslessLog,
  GaslessSnapshot } from "../../src/gasless/model.js";
import type { GaslessBootstrapMaterial, GaslessUserOperationMaterial } from "../../src/gasless/ports.js";
import { gaslessDeployment, gaslessProtocolHash } from "../../src/gasless/registry.js";
import { GaslessRpc, gaslessRpcFactory } from "../../src/gasless/rpc.js";
import { observeGasless, type GaslessObservationContext } from "../../src/gasless/rpc-observe.js";
import { readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "../../src/gasless/rpc-state.js";
import { verifyGaslessOuterTransaction } from "../../src/gasless/rpc-transaction.js";
import { GASLESS_ESTIMATE_SIGNATURE } from "../../src/gasless/signature.js";
import { gaslessBatch, gaslessEnvelopeBinding, gaslessPermitTypedData, gaslessUserOperation,
  gaslessUserOperationHash, gaslessUserOperationTypedData } from "../../src/gasless/wire.js";
import { bundledGaslessFixture } from "./gasless-fixtures/bundler-transport.js";
import { temporaryState } from "./helpers.js";

type Json = Record<string, any>;
const RPC_URL = "https://rpc.example/private-path";
const BUNDLER_URL = "https://bundler.example/api/v1";
const KEY = `0x${"1".repeat(64)}` as Hex;
const OUTER_KEY = `0x${"2".repeat(64)}` as Hex;
const OWNER = privateKeyToAccount(KEY);
const OUTER = privateKeyToAccount(OUTER_KEY);
const RECIPIENT = getAddress("0x4444444444444444444444444444444444444444");
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint | number): Hex => `0x${sha256(`gasless-block-${number}`)}`;
const block = (number: bigint | number): GaslessBlock => ({ numberAtomic: String(number),
  hash: blockHash(number), timestampAtomic: String(1_788_912_000n + BigInt(number)) });

class TestTransport implements GaslessTransport {
  readonly calls: Array<{ endpoint: string; method: string; params: readonly unknown[] }> = [];
  constructor(readonly result: (endpoint: string, method: string, params: readonly unknown[]) => unknown) {}
  async request(endpoint: string, method: "POST" | "GET", body: string | null) {
    assert.equal(method, "POST"); assert.notEqual(body, null);
    const request = JSON.parse(body!) as Json;
    this.calls.push({ endpoint, method: request.method, params: request.params });
    const result = this.result(endpoint, request.method, request.params);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }
}

test("gasless production prepare and approval fit one public bundler request window", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root), { id } = await s.prepare();
  const result = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = await s.record(id), bundler = s.calls.filter(c => c.bundler);
  t.diagnostic(JSON.stringify({ bundlerRequests: bundler.length,
    afterApproval: bundler.filter(c => c.afterApproval).length,
    finalPhase: record.userOperation.phase, failure: record.failure }));
  assert.equal(bundler.filter(c => c.method === "eth_sendUserOperation").length, 1);
  assert.equal(bundler.filter(c => c.method === "eth_estimateUserOperationGas").length, 1);
  assert.equal(bundler.length, 14);
  assert.equal(bundler.filter(c => c.afterApproval).length, 12);
  assert.equal(record.intent.gas.maxPriorityFeePerGas, "300000");
  assert.equal(record.intent.gas.maxFeePerGas, "2300000");
  assert.equal(record.bootstrap.signingAttempts, 1);
  assert.equal(record.userOperation.signingAttempts, 1);
  assert.equal(record.userOperation.submissionAttempts, 1);
  assert.equal(record.userOperation.phase, "submitted_pending");
  // Locator absence is still ambiguous; passing the rate budget is not settlement.
  assert.equal(record.terminal, false);
});

for (const boundary of ["before_bootstrap", "before_send"] as const) {
  for (const fault of ["chain", "entrypoint", "balance", "allowance", "nonce", "fees"] as const) {
    test(`gasless production ${fault} drift ${boundary} blocks the next effect`, async (t) => {
      const temporary = await temporaryState(); t.after(temporary.cleanup);
      const s = await bundledGaslessFixture(temporary.root); s.setLimit(100);
      const { id } = await s.prepare();
      if (boundary === "before_bootstrap") {
        const confirm = s.approval.confirm.bind(s.approval);
        s.approval.confirm = async input => { const accepted = await confirm(input); s.setFault(fault); return accepted; };
      } else {
        const seal = s.custody.seal.bind(s.custody);
        s.custody.seal = async (...args) => {
          const material = await seal(...args);
          if (args[1] === "user_operation") s.setFault(fault);
          return material;
        };
      }
      const result = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
      assert.equal(result.ok, true, result.error?.message);
      const record = await s.record(id), signed = boundary === "before_bootstrap" ? 0 : 1;
      assert.equal(record.bootstrap.signingAttempts, signed);
      assert.equal(record.userOperation.signingAttempts, signed);
      assert.equal(record.userOperation.submissionAttempts, 0);
      assert.equal(s.calls.filter(c => c.method === "eth_sendUserOperation").length, 0);
      assert.equal(record.state, signed === 0 ? "failed_before_effect" : "unknown_finality");
    });
  }
}

test("gasless RPC binds full endpoint identities and verifies both chains plus EntryPoint support", async () => {
  const deployment = gaslessDeployment(8453);
  const transport = new TestTransport((_endpoint, method) => method === "eth_supportedEntryPoints"
    ? [deployment.entryPoint] : "0x2105");
  const rpc = new GaslessRpc(8453, RPC_URL, BUNDLER_URL, transport);
  assert.equal(rpc.rpcOrigin, "https://rpc.example"); assert.equal(rpc.bundlerOrigin, "https://bundler.example");
  assert.equal(rpc.rpcEndpointHash, sha256(RPC_URL)); assert.equal(rpc.bundlerEndpointHash, sha256(BUNDLER_URL));
  await rpc.assertChain(); assert.equal(transport.calls.length, 3);
  assert.throws(() => new GaslessRpc(8453, `${RPC_URL}?key=secret`, BUNDLER_URL, transport), { code: "APN_RPC_CONFIG" });
  const mismatch = new GaslessRpc(8453, RPC_URL, BUNDLER_URL,
    new TestTransport((_endpoint, method) => method === "eth_supportedEntryPoints" ? [deployment.entryPoint] : "0x1"));
  await assert.rejects(mismatch.assertChain(), { code: "APN_CHAIN_MISMATCH" });
});

test("gasless RPC factory is lazy and requires only the selected chain RPC configuration", () => {
  const factory = gaslessRpcFactory({});
  assert.throws(() => factory(8453), { code: "APN_RPC_CONFIG" });
  const configured = gaslessRpcFactory({ APN_BASE_RPC_URL: RPC_URL });
  const first = configured(8453), repeated = configured(8453);
  assert.equal(first, repeated); assert.equal(first.rpcEndpointHash, sha256(RPC_URL));
  assert.equal(first.bundlerEndpointHash, sha256(gaslessDeployment(8453).publicBundlerUrl));
});

test("gasless JSON-RPC parser rejects malformed envelopes, bounds responses, and redacts provider errors", async () => {
  const deployment = gaslessDeployment(8453), canary = "canary_provider_path_secret";
  const cases: Array<{ name: string; response: (id: string) => { status: number; body: string }; code: string }> = [
    { name: "mismatched id", response: () => ({ status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: "0x2105" }) }), code: "APN_RPC_PROTOCOL" },
    { name: "result and error", response: (id) => ({ status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id, result: "0x2105", error: { message: canary } }) }), code: "APN_RPC_PROTOCOL" },
    { name: "missing result", response: (id) => ({ status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id }) }), code: "APN_RPC_PROTOCOL" },
    { name: "invalid JSON", response: () => ({ status: 200, body: "{" }), code: "APN_RPC_PROTOCOL" },
    { name: "wrong HTTP status", response: () => ({ status: 503, body: canary }), code: "APN_RPC_PROTOCOL" },
    { name: "oversize response", response: () => ({ status: 200, body: "x".repeat(2 * 1024 * 1024 + 1) }),
      code: "APN_RPC_PROTOCOL" },
    { name: "provider error", response: (id) => ({ status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32_000, message: canary } }) }),
      code: "APN_PROVIDER_EFFECT_UNAVAILABLE" },
  ];
  for (const row of cases) {
    const transport: GaslessTransport = { request: async (_endpoint, _method, body) => {
      const id = body === null ? "missing" : (JSON.parse(body) as Json).id as string;
      return row.response(id);
    } };
    const rpc = new GaslessRpc(8453, RPC_URL, BUNDLER_URL, transport);
    await assert.rejects(rpc.assertChain(), (error: any) => {
      assert.equal(error.code, row.code, row.name); assert.equal(String(error.message).includes(canary), false, row.name); return true;
    });
  }
  const valid = new GaslessRpc(8453, RPC_URL, BUNDLER_URL, new TestTransport((_endpoint, method) =>
    method === "eth_supportedEntryPoints" ? [deployment.entryPoint] : "0x2105"));
  await valid.assertChain();
});

test("gasless HTTPS rejects unsafe targets and invalid local bounds before any network access", async () => {
  const transport = new GaslessHttps();
  await assert.rejects(transport.request("https://127.0.0.1/rpc", "POST", null, 1024, "APN_RPC_CONFIG"),
    { code: "APN_RPC_CONFIG" });
  await assert.rejects(transport.request("https://user:password@example.com/rpc", "POST", null, 1024, "APN_RPC_CONFIG"),
    { code: "APN_RPC_CONFIG" });
  await assert.rejects(transport.request("https://example.com/rpc", "POST", null, 0, "APN_RPC_CONFIG"),
    { code: "APN_RPC_AMBIGUOUS" });
  await assert.rejects(transport.request("https://example.com/rpc", "POST", "x".repeat(256 * 1024 + 1), 1024,
    "APN_RPC_CONFIG"), { code: "APN_RPC_AMBIGUOUS" });
});

test("gasless estimate sends only the exact v0.8 wire and send accepts only its locally authenticated hash", async () => {
  const intent = makeIntent();
  const permitSignature = await OWNER.signTypedData(gaslessPermitTypedData(intent));
  const bootstrap = material("bootstrap", { permitSignature, authorization: null }) as GaslessBootstrapMaterial;
  let sentHash: Hex | null = null;
  const transport = new TestTransport((_endpoint, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_supportedEntryPoints") return [intent.entryPoint];
    if (method === "eth_estimateUserOperationGas") return { verificationGasLimit: "0x15f90", callGasLimit: "0x30d40",
      paymasterVerificationGasLimit: "0x2bf20", paymasterPostOpGasLimit: "0x88b8", preVerificationGas: "0x1d4c0" };
    if (method === "eth_sendUserOperation") return sentHash;
    throw new Error("unexpected method");
  });
  const rpc = new GaslessRpc(8453, RPC_URL, BUNDLER_URL, transport);
  const estimate = await rpc.estimate(intent, bootstrap);
  assert.deepEqual({ ...estimate, responseHash: undefined }, { verificationGasLimit: "90000", callGasLimit: "200000",
    paymasterVerificationGasLimit: "180000", paymasterPostOpGasLimit: "35000",
    preVerificationGas: "120000", responseHash: undefined });
  assert.match(estimate.responseHash, /^[a-f0-9]{64}$/u);
  const estimateCall = transport.calls.find((call) => call.method === "eth_estimateUserOperationGas")!;
  assert.deepEqual(Object.keys(estimateCall.params[0] as Json).sort(), ["callData", "callGasLimit", "factory", "factoryData",
    "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "paymaster", "paymasterData", "paymasterPostOpGasLimit",
    "paymasterVerificationGasLimit", "preVerificationGas", "sender", "signature", "verificationGasLimit"].sort());
  assert.equal((estimateCall.params[0] as Json).signature, GASLESS_ESTIMATE_SIGNATURE);
  const estimateWire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE);
  const signature = await OWNER.signTypedData(gaslessUserOperationTypedData(intent, estimateWire));
  const wire = gaslessUserOperation(intent, bootstrap, signature), localHash = gaslessUserOperationHash(intent, wire);
  const sealed = material("user_operation", { bootstrapMaterialHash: bootstrap.materialHash,
    estimateHash: estimate.responseHash, userOperation: wire, userOperationHash: localHash }) as GaslessUserOperationMaterial;
  sentHash = localHash; assert.equal(await rpc.send(intent, sealed), localHash);
  const sends = transport.calls.filter((call) => call.method === "eth_sendUserOperation");
  assert.equal(sends.length, 1); assert.deepEqual(sends[0]!.params, [wire, intent.entryPoint]);
  sentHash = word(999n); await assert.rejects(rpc.send(intent, sealed), { code: "APN_RPC_AMBIGUOUS" });
});

test("gasless canonical state reads pin every effect value to one block hash", async () => {
  const intent = makeIntent(), deployment = gaslessDeployment(8453), at = block(100);
  const pinned = { blockHash: at.hash, requireCanonical: true }, seen: Array<readonly unknown[]> = [];
  const call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    seen.push(params);
    if (method === "eth_getBalance" || method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_getCode") return `0xef0100${deployment.delegate.slice(2).toLowerCase()}`;
    const data = (params[0] as Json).data as string;
    if (data.startsWith("0x70a08231")) return word(10_000_000n);
    if (data.startsWith("0xdd62ed3e")) return word(0n);
    if (data.startsWith("0x7ecebe00")) return word(7n);
    if (data.startsWith("0x35567e1a")) return word(9n);
    if (data.startsWith("0x5c975abb") || data.startsWith("0xe877a526")) return word(0n);
    if (data.startsWith("0x1c704f2e")) return word(35_000n);
    if (data.startsWith("0x37876f0d")) return word(100n);
    if (data.startsWith("0x0fdb11cf")) return word(2_500_000_000n);
    throw new Error(`unexpected call ${data}`);
  };
  const account = await readAccountAt(call as never, deployment, intent.owner.address, at, true);
  assert.equal(account.delegation, "expected"); assert.equal(account.nativeBalanceWei, "0");
  const config = await readFeeConfigurationAt(call as never, deployment, intent.owner.address, at);
  assert.deepEqual(config, { additionalGasCharge: "35000", feeSpread: "100", nativeTokenPrice: "2500000000" });
  assert.ok(seen.filter((params) => params.at(-1) !== "pending").every((params) => hashObject(params.at(-1)) === hashObject(pinned)));
  const tiny = { ...deployment, code: [{ address: deployment.token, codeHash: keccak256("0x6000") }],
    reads: [{ kind: "call" as const, address: deployment.token, data: "0x12345678" as Hex, expected: word(7n) }] };
  const protocolRead = async (method: string, params: readonly unknown[]) => method === "eth_call" &&
    (params[0] as Json).data === "0x12345678" ? word(7n) : call(method, params);
  await verifyProtocolAt(async (method, params) => method === "eth_getCode" ? "0x6000" : protocolRead(method, params), tiny, at);
  await assert.rejects(verifyProtocolAt(async (method, params) => method === "eth_getCode" ? "0x6001" : protocolRead(method, params),
    tiny, at), { code: "APN_RPC_PROTOCOL" });
});

for (let type = 0; type <= 4; type += 1) test(`gasless outer type ${type} is reconstructed from signed bytes`, async () => {
  const signed = await signedOuter(type);
  const verified = await verifyGaslessOuterTransaction(signed.rpc, 8453, signed.hash);
  assert.equal(verified.from, OUTER.address); assert.equal(verified.to, gaslessDeployment(8453).entryPoint);
  await assert.rejects(verifyGaslessOuterTransaction({ ...signed.rpc, input: "0x12345679" }, 8453, signed.hash),
    { code: "APN_RPC_PROTOCOL" });
});

test("gasless observation reports bootstrap-only permission without inventing a payment hash", async () => {
  const intent = makeIntent(), cursor = initialCursor(intent), calls: string[] = [];
  const context = { chainId: 8453 as const, rpcOrigin: "https://rpc.example", deployment: gaslessDeployment(8453),
    rpc: async (method: string) => { calls.push(method); throw new Error("no RPC expected"); },
    bundler: async (method: string) => { calls.push(method); throw new Error("no bundler expected"); },
    snapshot: async () => intent.initialSnapshot } as GaslessObservationContext;
  const observation = await observeGasless(context, intent,
    { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: null, userOperationHash: null }, cursor);
  assert.equal(observation.status, "unresolved"); assert.equal(observation.transactionHash, null);
  assert.equal(observation.reason, "gasless_bootstrap_unresolved"); assert.equal(observation.evidenceHash, null);
  assert.deepEqual(calls, ["eth_getBlockByNumber"]);
});

for (const designation of ["empty", "expected"] as const) {
  test(`gasless ${designation} bootstrap RPC proves permission invalidation without bundler or effect calls`, async () => {
    const { context, intent, calls, setFault } = bootstrapRpcFixture(designation);
    const identity = { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: null, userOperationHash: null };
    const good = await observeGasless(context, intent, identity, initialCursor(intent));
    assert.equal(good.status, "permissions_invalidated"); assert.equal(good.transactionHash, null);
    assert.equal(good.settlement, null); assert.equal(good.permissionInvalidation?.safeBlock.numberAtomic, "102");
    assert.equal(good.permissionInvalidation?.headBlock.numberAtomic, "103");
    assert.equal(good.permissionInvalidation?.headAccount.permitNonceAtomic, "8");
    if (designation === "expected") {
      assert.equal(good.permissionInvalidation?.safeAccount.eoaNonceAtomic, intent.initialSnapshot.eoaNonceAtomic);
      assert.equal(good.permissionInvalidation?.headAccount.eoaNonceAtomic, intent.initialSnapshot.eoaNonceAtomic);
    }
    assert.equal(good.evidenceHash, hashObject(good.permissionInvalidation));
    assert.ok(calls.includes("eth_getCode")); assert.ok(calls.includes("eth_getStorageAt"));
    assert.ok(calls.includes("eth_call")); assert.ok(calls.includes("eth_getTransactionCount"));
    assert.equal(calls.some((m) => /UserOperation|send|estimate|bundler|snapshot/u.test(m)), false);
    for (const fault of ["permit", "allowance", "pending", "entrypoint", "owner_code", "protocol_code", "storage",
      "domain", "prepare_reorg", "safe_reorg", "head_reorg", "chain", "safe_ahead", "hash_zero",
      ...(designation === "empty" ? ["authorization"] : [])]) {
      setFault(fault);
      const held = await observeGasless(context, intent, identity, initialCursor(intent));
      assert.equal(held.status, "unresolved", fault); assert.equal(held.permissionInvalidation, undefined, fault);
      assert.equal(held.settlement, null); assert.deepEqual(held.cursor, initialCursor(intent));
    }
  });
}

for (const designation of ["empty", "expected"] as const) test(`gasless production ${designation} final invalidation requires canonical scan and all revoked permissions`, async () => {
  const { context, intent, calls, setFault } = bootstrapRpcFixture(designation, true);
  const identity = { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: "b".repeat(64), userOperationHash: word(71n) };
  const result = await observeGasless(context, intent, identity, initialCursor(intent));
  assert.equal(result.status, "permissions_invalidated"); assert.equal(result.reason, "gasless_final_permissions_invalidated");
  assert.equal(result.permissionInvalidation?.userOperationHash, identity.userOperationHash);
  assert.equal(result.permissionInvalidation?.userOperationMaterialHash, identity.userOperationMaterialHash);
  assert.equal(result.cursor.nextBlockAtomic, "103"); assert.deepEqual(result.cursor.previousEndBlock, result.permissionInvalidation?.safeBlock);
  assert.ok(calls.includes("eth_getLogs")); assert.equal(calls.some(c => /send|estimate|snapshot/iu.test(c)), false);
  for (const fault of ["permit", "allowance", "pending", "entrypoint", "owner_code", "protocol_code", "storage",
    "domain", "prepare_reorg", "safe_reorg", "head_reorg", "chain", "safe_ahead", "hash_zero", "scan_error",
    ...(designation === "empty" ? ["authorization"] : [])]) {
    setFault(fault);
    const held = await observeGasless(context, intent, identity, initialCursor(intent));
    assert.notEqual(held.status, "permissions_invalidated", fault); assert.equal(held.permissionInvalidation, undefined, fault);
  }
});

function bootstrapRpcFixture(designation: "empty" | "expected", final = false) {
  const original = makeIntent(), base = gaslessDeployment(8453);
  const deployment: GaslessDeployment = { ...base,
    code: [{ address: base.token, codeHash: keccak256("0x6000") }],
    reads: [{ kind: "storage", address: base.paymaster, data: word(1n), expected: word(2n) },
      { kind: "call", address: base.token, data: "0x3644e515", expected: base.tokenDomain.domainSeparator }] };
  const intent = { ...original, initialSnapshot: { ...original.initialSnapshot, delegation: designation,
    protocolHash: gaslessProtocolHash(deployment) } };
  const eoaNonce = `0x${(BigInt(intent.initialSnapshot.eoaNonceAtomic) + (designation === "empty" ? 1n : 0n)).toString(16)}`;
  const calls: string[] = []; let fault = "";
  const context: GaslessObservationContext = { chainId: 8453, rpcOrigin: "https://rpc.example", deployment,
    snapshot: async () => { calls.push("snapshot"); throw new Error("no snapshot"); },
    bundler: async () => { calls.push("bundler"); if (final) return null; throw new Error("no bundler"); },
    rpc: async (method, params) => {
      calls.push(method);
      if (method === "eth_getLogs" && final) { if (fault === "scan_error") throw new Error("scan failed"); return []; }
      if (method === "eth_getBlockByNumber") {
        const tag = params[0], n = tag === "safe" ? 102n : tag === "latest" ? (fault === "safe_ahead" ? 101n : 103n) : BigInt(tag as string);
        const reorg = (fault === "prepare_reorg" && n === 100n) ||
          (fault === "safe_reorg" && tag === "0x66") || (fault === "head_reorg" && tag === "0x67");
        return rawBlock(n, fault === "hash_zero" ? word(0n) : reorg ? word(123n) : blockHash(n));
      }
      if (method === "eth_getTransactionCount" && params[1] === "pending") return fault === "pending" ? "0x2" : eoaNonce;
      const pinned = params.at(-1) as Json;
      assert.equal(pinned.requireCanonical, true); assert.ok([blockHash(102), blockHash(103)].includes(pinned.blockHash));
      if (method === "eth_getBalance") return "0x100";
      if (method === "eth_getTransactionCount") return fault === "authorization" ? "0x0" : eoaNonce;
      if (method === "eth_getCode") {
        if (params[0] === intent.owner.address) return fault === "owner_code" ? "0x6001" :
          designation === "empty" ? "0x" : `0xef0100${intent.delegate.slice(2).toLowerCase()}`;
        assert.equal(params[0], deployment.token); return fault === "protocol_code" ? "0x6001" : "0x6000";
      }
      if (method === "eth_getStorageAt") return fault === "storage" ? word(3n) : word(2n);
      if (method === "eth_call") {
        const request = params[0] as Json, data = request.data as string;
        if (data === "0x3644e515") return fault === "domain" ? word(0n) : base.tokenDomain.domainSeparator;
        if (data.startsWith("0x70a08231")) return word(9_990_000n);
        if (data.startsWith("0xdd62ed3e")) return word(fault === "allowance" ? 1n : 0n);
        if (data.startsWith("0x7ecebe00")) return word(fault === "permit" ? 7n : 8n);
        if (data.startsWith("0x35567e1a")) return word((fault === "entrypoint") !== final ? 10n : 9n);
      }
      throw new Error(`unexpected read ${method}`);
    } };
  return { context, intent, calls, setFault: (value: string) => {
    fault = value; (context as { chainId: number }).chainId = value === "chain" ? 1 : 8453;
  } };
}

test("gasless finite safe-block scan uses ten-block RPC ranges and resets on cursor reorg", async () => {
  const intent = makeIntent(), userOperationHash = word(71n), cursor = initialCursor(intent);
  let reorg = false; const tags: unknown[] = [], ranges: Array<[bigint, bigint]> = [];
  const context = { chainId: 8453 as const, rpcOrigin: "https://rpc.example", deployment: gaslessDeployment(8453),
    bundler: async () => null,
    snapshot: async () => intent.initialSnapshot,
    rpc: async (method: string, params: readonly unknown[]) => {
      if (method === "eth_getBlockByNumber") {
        const tag = params[0]; tags.push(tag); const number = tag === "safe" ? 400n : BigInt(tag as string);
        return rawBlock(number, reorg && number === 355n ? word(123_456n) : blockHash(number));
      }
      if (method === "eth_getLogs") { const filter = params[0] as Json;
        const from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
        ranges.push([from, to]);
        if (to - from + 1n > 10n) throw new Error("provider maximum block range is 10");
        return []; }
      throw new Error(`unexpected ${method}`);
    },
  } as GaslessObservationContext;
  const identity = { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: "b".repeat(64), userOperationHash };
  const first = await observeGasless(context, intent, identity, cursor);
  assert.equal(first.status, "not_found"); assert.equal(first.cursor.nextBlockAtomic, "356");
  assert.equal(first.cursor.previousEndBlock?.numberAtomic, "355"); assert.ok(tags.includes("safe"));
  assert.equal(ranges.length, 26); assert.deepEqual(ranges[0], [100n, 109n]);
  assert.deepEqual(ranges.at(-1), [350n, 355n]);
  for (let index = 1; index < ranges.length; index += 1) assert.equal(ranges[index]![0], ranges[index - 1]![1] + 1n);
  reorg = true; const second = await observeGasless(context, intent, identity, first.cursor);
  assert.equal(second.status, "unresolved"); assert.deepEqual(second.cursor, cursor);
  assert.equal(ranges.length, 26);
});

for (const fault of ["transport", "range", "count", "reorg"] as const) {
  test(`gasless scan retains the original cursor after a later RPC range ${fault} failure`, async () => {
    const intent = makeIntent(), userOperationHash = word(73n), cursor = initialCursor(intent);
    const userLog = settlementLogs(intent, userOperationHash).at(-1)!;
    let requests = 0, endReads = 0;
    const context: GaslessObservationContext = { chainId: 8453, rpcOrigin: "https://rpc.example",
      deployment: gaslessDeployment(8453), bundler: async () => null, snapshot: async () => intent.initialSnapshot,
      rpc: async (method, params) => {
        if (method === "eth_getBlockByNumber") {
          const number = params[0] === "safe" ? 400n : BigInt(params[0] as string);
          if (number === 355n) endReads += 1;
          return rawBlock(number, fault === "reorg" && number === 355n && endReads === 2 ? word(999n) : blockHash(number));
        }
        assert.equal(method, "eth_getLogs"); requests += 1;
        const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
        assert.ok(to - from + 1n <= 10n);
        if (fault === "transport" && requests === 3) throw new Error("provider unavailable");
        if (fault === "range" && requests === 3) return [rawLog(userLog, word(74n), block(to + 1n))];
        if (fault === "count") return Array.from({ length: 65 }, (_, index) => ({
          ...rawLog(userLog, word(74n), block(from)), logIndex: quantity(index) }));
        return [];
      } };
    const observation = await observeGasless(context, intent,
      { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: "b".repeat(64), userOperationHash }, cursor);
    assert.equal(observation.status, "unresolved"); assert.equal(observation.settlement, null);
    assert.deepEqual(observation.cursor, cursor); assert.equal(observation.evidenceHash, null);
    assert.equal(requests, fault === "count" ? 2 : fault === "reorg" ? 26 : 3);
  });
}

test("gasless scan locates a matching operation in a later range without an effect call", async () => {
  const intent = makeIntent(), userOperationHash = word(75n), transactionHash = word(76n), calls: string[] = [];
  const userLog = rawLog(settlementLogs(intent, userOperationHash).at(-1)!, transactionHash, block(125n));
  const ranges: Array<[bigint, bigint]> = [];
  const context: GaslessObservationContext = { chainId: 8453, rpcOrigin: "https://rpc.example",
    deployment: gaslessDeployment(8453), bundler: async () => null, snapshot: async () => intent.initialSnapshot,
    rpc: async (method, params) => {
      calls.push(method);
      if (method === "eth_getBlockByNumber") return rawBlock(params[0] === "safe" ? 150n : BigInt(params[0] as string),
        blockHash(params[0] === "safe" ? 150n : BigInt(params[0] as string)));
      if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") {
        assert.equal(params[0], transactionHash); return null;
      }
      assert.equal(method, "eth_getLogs");
      const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
      assert.ok(to - from + 1n <= 10n); ranges.push([from, to]);
      return from <= 125n && to >= 125n ? [userLog] : [];
    } };
  const cursor = initialCursor(intent), observation = await observeGasless(context, intent,
    { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: "b".repeat(64), userOperationHash }, cursor);
  assert.equal(observation.status, "pending"); assert.equal(observation.transactionHash, transactionHash);
  assert.equal(observation.settlement, null); assert.deepEqual(observation.cursor, cursor);
  assert.equal(ranges.length, 6); assert.deepEqual(ranges.at(-1), [150n, 150n]);
  assert.ok(calls.includes("eth_getTransactionReceipt")); assert.equal(calls.some((method) => /send|estimate/iu.test(method)), false);
});

test("gasless safe observation fixes effect proof while later safe account state may advance", async () => {
  const intent = makeIntent(), userOperationHash = word(72n), signed = await signedOuter(2);
  const effectBlock = block(101), transaction = { ...signed.rpc, blockNumber: "0x65", blockHash: effectBlock.hash,
    transactionIndex: "0x0" };
  const logs = settlementLogs(intent, userOperationHash), receipt = { transactionHash: signed.hash, blockNumber: "0x65",
    blockHash: effectBlock.hash, transactionIndex: "0x0", type: "0x2", from: OUTER.address, to: intent.entryPoint,
    status: "0x1", logs: logs.map((log) => rawLog(log, signed.hash, effectBlock)) };
  let safeNumber = 102n;
  const context = { chainId: 8453 as const, rpcOrigin: "https://rpc.example",
    deployment: { ...gaslessDeployment(8453), code: [], reads: [] } as GaslessDeployment,
    snapshot: async () => intent.initialSnapshot,
    bundler: async (method: string) => method === "eth_getUserOperationReceipt"
      ? { userOpHash: userOperationHash, receipt: { transactionHash: signed.hash } }
      : { userOpHash: userOperationHash, entryPoint: intent.entryPoint, transactionHash: signed.hash },
    rpc: async (method: string, params: readonly unknown[]) => {
      if (method === "eth_getTransactionByHash") return transaction;
      if (method === "eth_getTransactionReceipt") return receipt;
      if (method === "eth_getBlockByNumber") {
        const tag = params[0], number = tag === "safe" ? safeNumber : BigInt(tag as string);
        return rawBlock(number, blockHash(number), number === 101n ? [signed.hash] : []);
      }
      if (method === "eth_getBalance" || method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_getCode") return `0xef0100${intent.delegate.slice(2).toLowerCase()}`;
      if (method === "eth_call") return accountRead(params);
      throw new Error(`unexpected ${method}`);
    },
  } as GaslessObservationContext;
  const identity = { bootstrapMaterialHash: "a".repeat(64), userOperationMaterialHash: "b".repeat(64), userOperationHash };
  const first = await observeGasless(context, intent, identity, initialCursor(intent));
  assert.equal(first.status, "safe"); assert.equal(first.settlement?.safeBlock.numberAtomic, "102");
  assert.equal(first.settlement?.effectAccount.balanceAtomic, "6000000");
  safeNumber = 103n; const second = await observeGasless(context, intent, identity, first.cursor);
  assert.equal(second.status, "safe"); assert.equal(second.settlement?.safeBlock.numberAtomic, "103");
  assert.equal(second.settlement?.safeAccount.balanceAtomic, "6000001");
  const { safeBlock: _firstSafeBlock, safeAccount: _firstSafeAccount, ...firstEffect } = first.settlement!;
  const { safeBlock: _secondSafeBlock, safeAccount: _secondSafeAccount, ...secondEffect } = second.settlement!;
  assert.deepEqual(secondEffect, firstEffect);
});

function makeIntent(): GaslessIntent {
  const deployment = gaslessDeployment(8453);
  const snapshot: GaslessSnapshot = { chainId: 8453, rpcOrigin: new URL(RPC_URL).origin,
    rpcEndpointHash: sha256(RPC_URL), bundlerOrigin: new URL(BUNDLER_URL).origin,
    bundlerEndpointHash: sha256(BUNDLER_URL), block: block(100), protocolHash: gaslessProtocolHash(deployment),
    owner: OWNER.address, token: deployment.token, balanceAtomic: "10000000", nativeBalanceWei: "0", allowanceAtomic: "0",
    permitNonceAtomic: "7", entryPointNonceAtomic: "9", eoaNonceAtomic: "0", pendingEoaNonceAtomic: "0",
    delegation: "expected", feeConfiguration: { additionalGasCharge: "35000", feeSpread: "100",
      nativeTokenPrice: "2500000000" }, baseFeePerGas: "1000000000", maxFeePerGas: "2100000000",
    maxPriorityFeePerGas: "100000000" };
  const gas = gaslessGas(snapshot), feeCapAtomic = gaslessFee(gas, snapshot.feeConfiguration), grossAtomic = "10000000";
  const withoutHash = { profile: "synthetic", request: { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic,
    maxFeeAtomic: "6000000", minReceivedAtomic: "4000000" }, owner: { profile: "synthetic", profileHash: "1".repeat(64),
    address: OWNER.address, walletBindingHash: "2".repeat(64), walletCreatedAt: "2026-09-09T00:00:00.000Z" },
    providerBinding: { providerId: "local" as const, accountBindingHash: "3".repeat(64), capabilityHash: "4".repeat(64),
      revision: 1 }, initialSnapshot: snapshot, gas, token: deployment.token, tokenDomain: deployment.tokenDomain,
    paymaster: deployment.paymaster, entryPoint: deployment.entryPoint, delegate: deployment.delegate, feeCapAtomic,
    recipientAtomic: (BigInt(grossAtomic) - BigInt(feeCapAtomic)).toString(), callData: "0x" as Hex,
    preparedAt: "2026-09-09T00:00:00.000Z", expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "5".repeat(64) };
  const bound = { ...withoutHash, callData: gaslessBatch(deployment.token, RECIPIENT,
    withoutHash.recipientAtomic, deployment.paymaster) };
  return { ...bound, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(bound)) };
}

function material(role: "bootstrap" | "user_operation", fields: Json): Json {
  return { schemaVersion: "apn.gasless-effect.v1", profileHash: "1".repeat(64), operationId: "gasless-rpc-test",
    fingerprint: "6".repeat(64), envelopeHash: "7".repeat(64), materialHash: "8".repeat(64), role, ...fields };
}

async function signedOuter(type: number) {
  const deployment = gaslessDeployment(8453), common = { chainId: 8453, to: deployment.entryPoint, nonce: 7,
    gas: 400_000n, value: 0n, data: "0x12345678" as Hex }, fees = { maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 0n };
  let transaction: TransactionSerializable;
  if (type === 0) transaction = { ...common, type: "legacy", gasPrice: fees.maxFeePerGas };
  else if (type === 1) transaction = { ...common, type: "eip2930", gasPrice: fees.maxFeePerGas, accessList: [] };
  else if (type === 2) transaction = { ...common, ...fees, type: "eip1559", accessList: [] };
  else if (type === 3) transaction = { ...common, ...fees, type: "eip4844", accessList: [], maxFeePerBlobGas: 100n,
    blobVersionedHashes: [`0x01${"67".repeat(31)}`] };
  else transaction = { ...common, ...fees, type: "eip7702", accessList: [], authorizationList: [
    await OUTER.signAuthorization({ chainId: 8453, contractAddress: deployment.delegate, nonce: 0 })] };
  const raw = await OUTER.signTransaction(transaction), parsed = parseTransaction(raw) as Json, hash = keccak256(raw);
  const rpc = { hash, chainId: "0x2105", type: quantity(type), nonce: "0x7", from: OUTER.address, to: common.to,
    gas: quantity(common.gas), value: "0x0", input: common.data, r: parsed.r, s: parsed.s,
    v: quantity(parsed.v ?? BigInt(parsed.yParity)), ...(type === 0 ? {} : { yParity: quantity(parsed.yParity),
      accessList: parsed.accessList ?? [] }), ...(type < 2 ? { gasPrice: quantity(fees.maxFeePerGas) } : {
      maxFeePerGas: quantity(fees.maxFeePerGas), maxPriorityFeePerGas: "0x0" }), ...(type === 3 ? {
      maxFeePerBlobGas: "0x64", blobVersionedHashes: parsed.blobVersionedHashes } : {}), ...(type === 4 ? {
      authorizationList: parsed.authorizationList.map((authorization: Json) => ({ ...authorization,
        chainId: quantity(authorization.chainId), nonce: quantity(authorization.nonce ?? 0),
        yParity: quantity(authorization.yParity) })) } : {}) };
  return { hash, rpc };
}

function initialCursor(intent: GaslessIntent): GaslessCursor {
  return { startBlock: intent.initialSnapshot.block, nextBlockAtomic: intent.initialSnapshot.block.numberAtomic,
    previousEndBlock: null };
}

function rawBlock(number: bigint, hash: Hex, transactions: readonly Hex[] = []): Json {
  return { number: quantity(number), hash, timestamp: quantity(1_788_912_000n + number), baseFeePerGas: "0x1",
    transactions };
}

function settlementLogs(intent: GaslessIntent, userOperationHash: Hex): readonly GaslessLog[] {
  const prefund = BigInt(intent.feeCapAtomic) - 100n, refund = prefund / 4n, fee = prefund - refund;
  return [eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
    { owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic) }, 0),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token, { from: intent.owner.address, to: intent.paymaster, value: prefund }, 1),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token,
    { from: intent.owner.address, to: intent.request.recipient, value: BigInt(intent.recipientAtomic) }, 2),
  eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token, { owner: intent.owner.address, spender: intent.paymaster, value: 0n }, 3),
  eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token, { from: intent.paymaster, to: intent.owner.address, value: refund }, 4),
  eventLog(GASLESS_PAYMASTER_ABI, "UserOperationSponsored", intent.paymaster, { token: intent.token,
    sender: intent.owner.address, userOpHash: userOperationHash, nativeTokenPrice: 2_500_000_000n,
    actualTokenNeeded: fee, feeTokenAmount: 1n }, 5),
  eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationEvent", intent.entryPoint, { userOpHash: userOperationHash,
    sender: intent.owner.address, paymaster: intent.paymaster, nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic),
    success: true, actualGasCost: 100n, actualGasUsed: 50n }, 6)];
}

function eventLog(abi: Abi, eventName: string, address: Address, args: Json, index: number): GaslessLog {
  const item = getAbiItem({ abi, name: eventName as never }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item], eventName: eventName as never, args: args as never }) as readonly Hex[];
  const plain = inputs.filter((input) => !input.indexed) as readonly AbiParameter[];
  const values = plain.map((input) => args[input.name!]);
  return { address, topics, data: encodeAbiParameters(plain, values as never), logIndexAtomic: String(index) };
}

function rawLog(log: GaslessLog, transactionHash: Hex, at: GaslessBlock): Json {
  return { address: log.address, topics: log.topics, data: log.data, logIndex: quantity(BigInt(log.logIndexAtomic)),
    transactionHash, blockHash: at.hash, blockNumber: quantity(BigInt(at.numberAtomic)), transactionIndex: "0x0", removed: false };
}

function accountRead(params: readonly unknown[]): Hex {
  const data = ((params[0] as Json).data as string).slice(0, 10);
  const pinned = params.at(-1) as { blockHash?: Hex };
  if (data === "0x70a08231") return word(pinned.blockHash === blockHash(103n) ? 6_000_001n : 6_000_000n);
  if (data === "0xdd62ed3e") return word(0n);
  if (data === "0x7ecebe00") return word(8n);
  if (data === "0x35567e1a") return word(10n);
  throw new Error(`unexpected account read ${data}`);
}
