import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters } from "viem";
import { canonicalJson, domainHash, hashObject, sha256 } from "../../src/canonical.js";
import { parseArgv } from "../../src/cli.js";
import { ApnError } from "../../src/errors.js";
import { StateStore } from "../../src/state.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { materializePaymentIdentifier, tokenDomainSeparator } from "../../src/x402-policy.js";
import {
  appendX402Transition,
  validateX402Operation,
  validateX402Receipt,
  validateX402Result,
  x402Fingerprint,
  type X402OperationRecord,
} from "../../src/x402-state-integrity.js";
import { challengeObservation, TestHttp } from "./x402-helpers.js";
import {
  canonicalPaymentRequiredHeader,
  paymentIdentifierDeclaration,
  X402_PAYMENT_REQUIRED,
  X402_REQUIREMENTS,
  X402_URL,
} from "./x402-vectors.js";
import {
  OTHER_RECIPIENT,
  RECIPIENT,
  WALLET,
  TestNative,
  TestRpc,
  ensureWallet,
  makeCore,
  temporaryState,
} from "./helpers.js";

const PREPARE_REQUEST = {
  command: "x402.fetch.prepare" as const,
  profile: "default",
  url: X402_URL,
  maxAmountAtomic: "10000000",
  idempotencyKey: "x402-payment-001",
};

function operationRecord(envelope: Awaited<ReturnType<ReturnType<typeof makeCore>["execute"]>>): Record<string, unknown> {
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.notEqual(envelope.operation, null);
  return envelope.operation as Record<string, unknown>;
}

function challenge(value: unknown = X402_PAYMENT_REQUIRED): TestHttp {
  return new TestHttp(challengeObservation({ header: canonicalPaymentRequiredHeader(value) }));
}

function sealed<T extends Record<string, unknown>>(domain: string, value: T): T & { readonly integrityHash: string } {
  return { ...value, integrityHash: domainHash(domain, canonicalJson(value)) };
}

function resealOperation(value: X402OperationRecord | Record<string, unknown>): X402OperationRecord {
  const { integrityHash: _old, ...body } = value;
  return sealed("apn.x402.state.v1", body) as unknown as X402OperationRecord;
}

function paymentResponseBindingHash(settlementResponseHash: string): string {
  return domainHash("apn.x402.transaction-hint.v1", canonicalJson({
    source: "payment_response",
    settlementResponseHash,
  }));
}

function authorizationUsedLogBindingHash(authorizationUsedScanEvidenceHash: string): string {
  return domainHash("apn.x402.transaction-hint.v1", canonicalJson({
    source: "authorization_used_log",
    authorizationUsedScanEvidenceHash,
  }));
}

function operationBindingHash(operation: X402OperationRecord): string {
  return domainHash("apn.x402.binding.v1", canonicalJson({
    version: 1,
    x402Version: 2,
    method: "GET",
    canonicalFullUrl: operation.resource.canonicalUrl,
    resource: JSON.parse(operation.sellerWire.resourceCanonicalJson) as unknown,
    acceptedResolvedDefaults: operation.selectedOffer.resolved,
    payer: operation.wallet,
    operationId: operation.operationId,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
  }));
}

function safeSettlementEvidence(operationId: string): Record<string, unknown> {
  const transactionHash = `0x${"9".repeat(64)}`;
  const blockHash = `0x${"8".repeat(64)}`;
  const value = {
    schemaVersion: "apn.x402.settlement-evidence.v1",
    network: "eip155:8453",
    chainId: "8453",
    token: X402_REQUIREMENTS.asset.toLowerCase(),
    transactionHash,
    safeHead: { number: "12400", hash: blockHash, observedAt: "2026-08-26T00:02:00.000Z" },
    transactionBlock: { number: "12399", hash: blockHash, timestamp: "1787702500" },
    receiptStatus: "1",
    blockHashRechecked: true,
    authorizationUsed: {
      logIndex: "1", authorizer: WALLET.toLowerCase(), nonce: `0x${"7".repeat(64)}`,
      blockNumber: "12399", blockHash, transactionHash,
    },
    transfer: {
      logIndex: "2", from: WALLET.toLowerCase(), to: X402_REQUIREMENTS.payTo.toLowerCase(), value: "1000000",
      blockNumber: "12399", blockHash, transactionHash,
    },
    authorizationState: { value: true, blockNumber: "12399", blockHash, blockTag: "number", observedAt: "2026-08-26T00:02:00.000Z" },
    rpcOriginHash: sha256("https://rpc.example"),
    operationBinding: operationId,
  };
  const { operationBinding: _testOnly, ...schema } = value;
  return { ...schema, evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(schema)) };
}

function unusedExpiryEvidence(): Record<string, unknown> {
  const blockHash = `0x${"6".repeat(64)}`;
  const value = {
    schemaVersion: "apn.x402.unused-expiry-evidence.v1",
    network: "eip155:8453",
    chainId: "8453",
    token: X402_REQUIREMENTS.asset.toLowerCase(),
    validBefore: "1787702460",
    finalizedHead: { number: "12500", hash: blockHash, timestamp: "1787702461", observedAt: "2026-08-26T00:03:00.000Z" },
    authorizationState: { value: false, blockNumber: "12500", blockHash, blockTag: "finalized", observedAt: "2026-08-26T00:03:00.000Z" },
    absence: { localSettlement: false, httpSettlement: false, authorizationUsed: false, transactionReceipt: false },
    rpcOriginHash: sha256("https://rpc.example"),
  };
  return { ...value, evidenceHash: domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(value)) };
}

function mixedChallenge(required = false): unknown {
  return {
    ...X402_PAYMENT_REQUIRED,
    accepts: [
      { ...X402_REQUIREMENTS, amount: "20000000" },
      { ...X402_REQUIREMENTS, amount: "2000000", extra: { name: "Wrong Coin", version: "2" } },
      { ...X402_REQUIREMENTS, amount: "2000000", extra: { name: "USD Coin", version: "2" } },
      { ...X402_REQUIREMENTS, amount: "1000000", extra: { name: "USD Coin", version: "2" } },
    ],
    extensions: { "payment-identifier": paymentIdentifierDeclaration(required) },
  };
}

async function readOperation(root: string, profile: string, operationId: string): Promise<X402OperationRecord> {
  const store = new StateStore(root);
  const path = join(root, "x402-operations", store.profileHash(profile), `${operationId}.json`);
  return JSON.parse(await readFile(path, "utf8")) as X402OperationRecord;
}

test("fresh prepare freezes first fully payable seller entry and exact duplicate is read-only after restart", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative();
  await ensureWallet(makeCore({ root: temporary.root, native }));

  const staleInspect = challenge({ ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "1" }] });
  const inspected = await makeCore({ root: temporary.root, http: staleInspect }).execute({ command: "x402.inspect", url: X402_URL });
  assert.equal(inspected.ok, true);
  assert.equal(staleInspect.calls.length, 1);

  const http = challenge(mixedChallenge(false));
  const rpc = new TestRpc();
  const prepared = await makeCore({ root: temporary.root, native, rpc, http }).execute(PREPARE_REQUEST);
  const publicOperation = operationRecord(prepared);
  assert.deepEqual(Object.keys(publicOperation), [
    "schemaVersion", "kind", "operationId", "state", "finalityClass", "terminal", "reason", "proofClass",
    "nextActions", "createdAt", "updatedAt", "resource", "payer", "paymentMethod", "payee", "amountAtomic", "network", "token",
    "paymentIdentifier", "integrityHash",
  ]);
  assert.equal(publicOperation.state, "awaiting_approval");
  assert.equal(prepared.proof_class, "x402_frozen_offer");
  assert.deepEqual(prepared.next_actions, ["x402.fetch.approve", "operation.status"]);
  assert.equal(publicOperation.finalityClass, "pre_effect");
  assert.equal(publicOperation.amountAtomic, "2000000", "first fully payable seller entry wins over later cheaper entry");
  const { integrityHash: publicIntegrityHash, ...publicWithoutIntegrityHash } = publicOperation;
  assert.equal(
    publicIntegrityHash,
    domainHash("apn.x402.public-operation.v1", canonicalJson(publicWithoutIntegrityHash)),
    "public integrity must bind the exact safe projection rather than protected state",
  );
  assert.equal(http.calls.length, 1, "prepare performs one fresh unpaid GET");
  assert.deepEqual(http.calls, [{ url: X402_URL }], "prepare must not send payment material");
  assert.equal(rpc.x402PrepareCalls, 1, "all candidate decisions reuse one safe-block observation");
  assert.equal(native.calls.length, 1, "prepare must add zero native calls after the earlier wallet setup");

  const operationId = String(publicOperation.operationId);
  const state = await readOperation(temporary.root, "default", operationId);
  assert.equal(state.schemaVersion, "apn.x402.state.v1");
  assert.equal(state.kind, "x402_fetch");
  assert.equal(state.selectedOffer.index, "2");
  assert.deepEqual(JSON.parse(state.selectedOffer.declaredCanonicalJson), {
    amount: "2000000",
    asset: X402_REQUIREMENTS.asset,
    extra: { name: "USD Coin", version: "2" },
    maxTimeoutSeconds: 60,
    network: "eip155:8453",
    payTo: X402_REQUIREMENTS.payTo,
    scheme: "exact",
  });
  assert.deepEqual(state.selectedOffer.resolved, {
    tokenName: "USD Coin",
    tokenVersion: "2",
    assetTransferMethod: "eip3009",
    paymentFlow: "transferWithAuthorization",
  });
  assert.equal(state.paymentIdentifier?.value, `apn_${operationId}`);
  assert.equal(state.authorization.from, state.wallet);
  assert.equal(state.authorization.to, state.payee);
  assert.equal(state.authorization.value, state.amountAtomic);
  assert.equal(state.authorization.validAfter, "0");
  assert.equal(state.authorization.createdAt, "1787702400");
  assert.equal(state.authorization.validBefore, "1787702460");
  assert.match(state.authorization.nonce, /^0x[0-9a-f]{64}$/u);
  assert.deepEqual(state.attempts, []);
  assert.equal(state.transitions.length, 1);
  assert.equal(JSON.stringify(state).includes("signature"), false);
  assert.deepEqual(await readdir(join(temporary.root, "x402-operations", state.profileHash)), [`${operationId}.json`]);
  assert.deepEqual(await readdir(join(temporary.root, "x402-results")), []);
  assert.deepEqual(await readdir(join(temporary.root, "x402-receipts")), []);

  const statePath = join(temporary.root, "x402-operations", state.profileHash, `${operationId}.json`);
  const before = await readFile(statePath, "utf8");
  const beforeStat = await stat(statePath, { bigint: true });
  const duplicateHttp = challenge();
  const duplicateRpc = new TestRpc();
  const duplicate = await makeCore({ root: temporary.root, rpc: duplicateRpc, http: duplicateHttp }).execute(PREPARE_REQUEST);
  assert.equal(operationRecord(duplicate).operationId, operationId);
  assert.equal(duplicateHttp.calls.length, 0);
  assert.equal(duplicateRpc.x402PrepareCalls, 0);
  assert.equal(await readFile(statePath, "utf8"), before);
  assert.equal((await stat(statePath, { bigint: true })).mtimeNs, beforeStat.mtimeNs, "duplicate must not rewrite state");
});

test("prepare classifies malformed cap, over-cap, insufficient balance, and wrong domain before effects", async (t) => {
  for (const cap of ["", "0", " 1", "+1", "1.0", "1e6"] as const) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    const http = challenge();
    const rpc = new TestRpc();
    const native = new TestNative();
    const result = await makeCore({ root: temporary.root, native, rpc, http }).execute({ ...PREPARE_REQUEST, maxAmountAtomic: cap });
    assert.equal(result.ok, false, cap);
    assert.equal(result.error?.code, "APN_INVALID_INPUT", cap);
    assert.equal(http.calls.length, 0, cap);
    assert.equal(rpc.x402PrepareCalls, 0, cap);
    assert.equal(native.calls.length, 0, cap);
    await assert.rejects(access(temporary.root), /ENOENT/u);
  }

  const missingRpcState = await temporaryState();
  t.after(missingRpcState.cleanup);
  await ensureWallet(makeCore({ root: missingRpcState.root, native: new TestNative() }));
  const missingRpcHttp = challenge();
  const missingRpc = await makeCore({ root: missingRpcState.root, http: missingRpcHttp }).execute(PREPARE_REQUEST);
  assert.equal(missingRpc.error?.code, "APN_RPC_CONFIG");
  assert.equal(missingRpcHttp.calls.length, 0);

  const missingWalletState = await temporaryState();
  t.after(missingWalletState.cleanup);
  const missingWalletHttp = challenge();
  const missingWalletRpc = new TestRpc();
  const missingWallet = await makeCore({ root: missingWalletState.root, rpc: missingWalletRpc, http: missingWalletHttp }).execute(PREPARE_REQUEST);
  assert.equal(missingWallet.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(missingWalletHttp.calls.length, 0);
  assert.equal(missingWalletRpc.x402PrepareCalls, 0);

  const cases = [
    {
      key: "cap-only-001",
      expected: "APN_X402_OFFER_EXCEEDS_LIMIT",
      value: { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "11" }] },
      cap: "10",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, domainSeparator: `0x${"f".repeat(64)}` }; },
      rpcCalls: 0,
    },
    {
      key: "insufficient-001",
      expected: "APN_INSUFFICIENT_USDC",
      value: { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "11" }] },
      cap: "20",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, usdcAtomic: "10" }; },
      rpcCalls: 1,
    },
    {
      key: "wrong-domain-001",
      expected: "APN_X402_UNSUPPORTED_OFFER",
      value: { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "11" }] },
      cap: "20",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, domainSeparator: `0x${"f".repeat(64)}` }; },
      rpcCalls: 1,
    },
    {
      key: "wrong-wallet-001",
      expected: "APN_RPC_PROTOCOL",
      value: { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "11" }] },
      cap: "20",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, address: OTHER_RECIPIENT }; },
      rpcCalls: 1,
    },
    {
      key: "wrong-block-001",
      expected: "APN_RPC_PROTOCOL",
      value: { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: "11" }] },
      cap: "20",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, block: { ...rpc.x402Evidence.block, hash: `0x${"B".repeat(64)}` } }; },
      rpcCalls: 1,
    },
  ] as const;
  for (const input of cases) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
    const http = challenge(input.value);
    const rpc = new TestRpc();
    input.mutate(rpc);
    const native = new TestNative();
    const result = await makeCore({ root: temporary.root, native, rpc, http }).execute({
      ...PREPARE_REQUEST,
      idempotencyKey: input.key,
      maxAmountAtomic: input.cap,
    });
    assert.equal(result.ok, false, input.key);
    assert.equal(result.error?.code, input.expected, input.key);
    assert.equal(http.calls.length, 1, input.key);
    assert.equal(rpc.x402PrepareCalls, input.rpcCalls, input.key);
    assert.equal(native.calls.length, 0, input.key);
    const profileRoot = join(temporary.root, "x402-operations", new StateStore(temporary.root).profileHash("default"));
    const entries = await readdir(profileRoot).catch(() => []);
    assert.deepEqual(entries, [], input.key);
  }
});

test("prepare binds current-invocation safe evidence without inventing a block-age threshold", async (t) => {
  const cases = [
    {
      key: "false-origin",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, rpcOriginHash: "f".repeat(64) }; },
    },
    {
      key: "stale-observation",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, observedAt: "2000-01-01T00:00:00.000Z" }; },
    },
    {
      key: "future-observation",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, observedAt: "2026-08-26T00:00:01.000Z" }; },
    },
    {
      key: "future-block-time",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, block: { ...rpc.x402Evidence.block, timestamp: "1787702401" } }; },
    },
    {
      key: "zero-block-hash",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, block: { ...rpc.x402Evidence.block, hash: `0x${"0".repeat(64)}` } }; },
    },
    {
      key: "zero-block-number",
      mutate: (rpc: TestRpc) => { rpc.x402Evidence = { ...rpc.x402Evidence, block: { ...rpc.x402Evidence.block, number: "0" } }; },
    },
  ] as const;
  for (const input of cases) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
    const rpc = new TestRpc();
    input.mutate(rpc);
    const http = challenge();
    const result = await makeCore({ root: temporary.root, rpc, http }).execute({
      ...PREPARE_REQUEST,
      idempotencyKey: `evidence-${input.key}`,
    });
    assert.equal(result.error?.code, "APN_RPC_PROTOCOL", input.key);
    assert.equal(http.calls.length, 1, input.key);
    assert.equal(rpc.x402PrepareCalls, 1, input.key);
    assert.deepEqual(await readdir(join(temporary.root, "x402-operations", new StateStore(temporary.root).profileHash("default"))).catch(() => []), []);
  }

  for (const [key, timestamp] of [["evidence-realistic-lag", "1787702280"], ["evidence-old-consistent", "946684800"]] as const) {
    const valid = await temporaryState();
    t.after(valid.cleanup);
    await ensureWallet(makeCore({ root: valid.root, native: new TestNative() }));
    const validRpc = new TestRpc();
    validRpc.x402Evidence = {
      ...validRpc.x402Evidence,
      block: { ...validRpc.x402Evidence.block, timestamp },
    };
    const validResult = await makeCore({ root: valid.root, rpc: validRpc, http: challenge() }).execute({
      ...PREPARE_REQUEST,
      idempotencyKey: key,
    });
    assert.equal(validResult.ok, true, `${key} must not be rejected by an arbitrary age threshold`);
  }
});

test("production prepare RPC pins every eth_call and rechecks the exact block identity", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  const rpc = new HttpsBaseRpc("https://rpc.example");
  const initialHash = `0x${"b".repeat(64)}`;
  const changedHash = `0x${"c".repeat(64)}`;
  const tag = "0x3039";
  const calls: readonly [string, readonly unknown[]][] = [];
  const mutableCalls = calls as [string, readonly unknown[]][];
  let blockReads = 0;
  (rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> }).call = async (method, params) => {
    mutableCalls.push([method, params]);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") {
      blockReads += 1;
      return { number: tag, hash: blockReads === 1 ? initialHash : changedHash, timestamp: "0x6a91d200" };
    }
    const data = (params[0] as { readonly data?: string }).data;
    if (data?.startsWith("0x70a08231")) return encodeAbiParameters([{ type: "uint256" }], [50_000_000n]);
    if (data === "0x06fdde03") return encodeAbiParameters([{ type: "string" }], ["USD Coin"]);
    if (data === "0x54fd4d50") return encodeAbiParameters([{ type: "string" }], ["2"]);
    if (data === "0x3644e515") return encodeAbiParameters([{ type: "bytes32" }], [tokenDomainSeparator("USD Coin", "2")]);
    throw new Error(`unexpected RPC method ${method}`);
  };
  const http = challenge();
  const result = await makeCore({ root: temporary.root, rpc, http }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "safe-reorg-001",
  });
  assert.equal(result.error?.code, "APN_RPC_PROTOCOL");
  assert.equal(http.calls.length, 1);
  assert.equal(blockReads, 2, "the safe head and exact pinned block must both be read");
  const blockTags = mutableCalls.filter(([method]) => method === "eth_getBlockByNumber").map(([, params]) => params);
  assert.deepEqual(blockTags, [["safe", false], [tag, false]], "the second identity read must recheck the pinned height, not a newer safe head");
  const callTags = mutableCalls.filter(([method]) => method === "eth_call").map(([, params]) => (params[1]));
  assert.deepEqual(callTags, [tag, tag, tag, tag]);
  assert.deepEqual(await readdir(join(temporary.root, "x402-operations", new StateStore(temporary.root).profileHash("default"))).catch(() => []), []);

  for (const [label, rechecked] of [
    ["number", { number: "0x303a", hash: initialHash, timestamp: "0x6a91d200" }],
    ["timestamp", { number: tag, hash: initialHash, timestamp: "0x6a91d201" }],
  ] as const) {
    const variant = new HttpsBaseRpc("https://rpc.example");
    const variantCalls: [string, readonly unknown[]][] = [];
    let variantBlockReads = 0;
    (variant as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> }).call = async (method, params) => {
      variantCalls.push([method, params]);
      if (method === "eth_getBlockByNumber") {
        variantBlockReads += 1;
        return variantBlockReads === 1
          ? { number: tag, hash: initialHash, timestamp: "0x6a91d200" }
          : rechecked;
      }
      const data = (params[0] as { readonly data?: string }).data;
      if (data?.startsWith("0x70a08231")) return encodeAbiParameters([{ type: "uint256" }], [50_000_000n]);
      if (data === "0x06fdde03") return encodeAbiParameters([{ type: "string" }], ["USD Coin"]);
      if (data === "0x54fd4d50") return encodeAbiParameters([{ type: "string" }], ["2"]);
      if (data === "0x3644e515") return encodeAbiParameters([{ type: "bytes32" }], [tokenDomainSeparator("USD Coin", "2")]);
      throw new Error(`unexpected RPC method ${method}`);
    };
    await assert.rejects(variant.getX402PrepareEvidence(WALLET), { code: "APN_RPC_PROTOCOL" }, label);
    assert.deepEqual(
      variantCalls.filter(([method]) => method === "eth_getBlockByNumber").map(([, params]) => params),
      [["safe", false], [tag, false]],
      label,
    );
  }
});

test("global idempotency and active-operation scans cover direct and x402 stores before seller or RPC", async (t) => {
  const directFirst = await temporaryState();
  t.after(directFirst.cleanup);
  await ensureWallet(makeCore({ root: directFirst.root, native: new TestNative() }));
  const directRpc = new TestRpc();
  const direct = await makeCore({ root: directFirst.root, rpc: directRpc }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: PREPARE_REQUEST.idempotencyKey,
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(direct.ok, true);
  const blockedHttp = challenge();
  const blockedRpc = new TestRpc();
  const crossKind = await makeCore({ root: directFirst.root, rpc: blockedRpc, http: blockedHttp }).execute(PREPARE_REQUEST);
  assert.equal(crossKind.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(blockedHttp.calls.length, 0);
  assert.equal(blockedRpc.x402PrepareCalls, 0);

  const x402First = await temporaryState();
  t.after(x402First.cleanup);
  await ensureWallet(makeCore({ root: x402First.root, native: new TestNative() }));
  const x402Http = challenge();
  const x402Rpc = new TestRpc();
  assert.equal((await makeCore({ root: x402First.root, rpc: x402Rpc, http: x402Http }).execute(PREPARE_REQUEST)).ok, true);
  const changedHttp = challenge();
  const changedRpc = new TestRpc();
  const changed = await makeCore({ root: x402First.root, rpc: changedRpc, http: changedHttp }).execute({
    ...PREPARE_REQUEST,
    maxAmountAtomic: "10000001",
  });
  assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(changedHttp.calls.length, 0);
  assert.equal(changedRpc.x402PrepareCalls, 0);

  const otherProfile = await makeCore({ root: x402First.root, rpc: changedRpc, http: changedHttp }).execute({
    ...PREPARE_REQUEST,
    profile: "other",
  });
  assert.equal(otherProfile.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(changedHttp.calls.length, 0);

  const directAfter = new TestRpc();
  const directConflict = await makeCore({ root: x402First.root, rpc: directAfter }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: PREPARE_REQUEST.idempotencyKey,
    recipient: OTHER_RECIPIENT,
    amount: "1",
  });
  assert.equal(directConflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(directAfter.balanceCalls, 0);
  const differentDirectRpc = new TestRpc();
  const differentDirect = await makeCore({ root: x402First.root, rpc: differentDirectRpc }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "different-direct-key",
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(differentDirect.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(differentDirectRpc.balanceCalls, 0);

  const activeHttp = challenge();
  const activeRpc = new TestRpc();
  const activeBlocked = await makeCore({ root: directFirst.root, rpc: activeRpc, http: activeHttp }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "different-x402-key",
  });
  assert.equal(activeBlocked.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(activeHttp.calls.length, 0);
  assert.equal(activeRpc.x402PrepareCalls, 0);
});

test("direct and x402 concurrency shares profile then operation locks", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  const rpc = new TestRpc();
  const http = challenge();
  const [direct, x402] = await Promise.all([
    makeCore({ root: temporary.root, rpc }).execute({
      command: "transfer.prepare",
      profile: "default",
      idempotencyKey: "concurrent-direct",
      recipient: RECIPIENT,
      amount: "1",
    }),
    makeCore({ root: temporary.root, rpc, http }).execute({ ...PREPARE_REQUEST, idempotencyKey: "concurrent-x402" }),
  ]);
  assert.equal([direct, x402].filter((result) => result.ok).length, 1);
  assert.equal([direct, x402].filter((result) => result.error?.code === "APN_OPERATION_BLOCKED").length, 1);
  assert.equal(rpc.balanceCalls + rpc.x402PrepareCalls, 1);
  assert.ok(http.calls.length === 0 || http.calls.length === 1);

  class ObservedStore extends StateStore {
    readonly acquired: string[] = [];
    protected override async beforeLockAcquire(key: string): Promise<void> { this.acquired.push(key); }
  }
  const lockState = await temporaryState();
  t.after(lockState.cleanup);
  const store = new ObservedStore(lockState.root);
  await store.initialize();
  await store.withLocks(["operation:z", "profile:a", "operation:a", "profile:a"], async () => undefined);
  assert.deepEqual(store.acquired, ["profile:a", "operation:a", "operation:z"]);
});

test("same global idempotency identity serializes across profiles and kinds before seller or RPC effects", async (t) => {
  class HeldHttp extends TestHttp {
    private releaseFirst!: () => void;
    private signalFirst!: () => void;
    private signalSecond!: () => void;
    private readonly firstRelease = new Promise<void>((resolve) => { this.releaseFirst = resolve; });
    readonly firstStarted = new Promise<void>((resolve) => { this.signalFirst = resolve; });
    readonly secondStarted = new Promise<void>((resolve) => { this.signalSecond = resolve; });

    override async get(request: Parameters<TestHttp["get"]>[0]): ReturnType<TestHttp["get"]> {
      this.calls.push(request);
      if (this.calls.length === 1) {
        this.signalFirst();
        await this.firstRelease;
      } else {
        this.signalSecond();
      }
      return this.response;
    }

    release(): void { this.releaseFirst(); }
  }

  async function bothProfiles(root: string): Promise<void> {
    const native = new TestNative();
    const core = makeCore({ root, native });
    assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
    assert.equal((await core.execute({ command: "wallet.ensure", profile: "other" })).ok, true);
  }

  const sameKindState = await temporaryState();
  t.after(sameKindState.cleanup);
  await bothProfiles(sameKindState.root);
  const sameKindHttp = new HeldHttp(challengeObservation({ header: canonicalPaymentRequiredHeader() }));
  const first = makeCore({ root: sameKindState.root, rpc: new TestRpc(), http: sameKindHttp }).execute(PREPARE_REQUEST);
  await sameKindHttp.firstStarted;
  const second = makeCore({ root: sameKindState.root, rpc: new TestRpc(), http: sameKindHttp }).execute({ ...PREPARE_REQUEST, profile: "other" });
  const sameKindSecondReachedSeller = await Promise.race([
    sameKindHttp.secondStarted.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 40)),
  ]);
  sameKindHttp.release();
  const sameKind = await Promise.all([first, second]);
  assert.equal(sameKindSecondReachedSeller, false, "the loser must remain behind the global identity lock");
  assert.equal(sameKind.filter((result) => result.ok).length, 1);
  assert.equal(sameKind.filter((result) => result.error?.code === "APN_IDEMPOTENCY_CONFLICT").length, 1);
  assert.equal(sameKindHttp.calls.length, 1);

  const crossKindState = await temporaryState();
  t.after(crossKindState.cleanup);
  await bothProfiles(crossKindState.root);
  const crossKindHttp = new HeldHttp(challengeObservation({ header: canonicalPaymentRequiredHeader() }));
  const winner = makeCore({ root: crossKindState.root, rpc: new TestRpc(), http: crossKindHttp }).execute({ ...PREPARE_REQUEST, idempotencyKey: "cross-kind-global" });
  await crossKindHttp.firstStarted;
  const loserRpc = new TestRpc();
  const loser = makeCore({ root: crossKindState.root, rpc: loserRpc }).execute({
    command: "transfer.prepare",
    profile: "other",
    idempotencyKey: "cross-kind-global",
    recipient: RECIPIENT,
    amount: "1",
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  crossKindHttp.release();
  const [x402, direct] = await Promise.all([winner, loser]);
  assert.equal(x402.ok, true);
  assert.equal(direct.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(loserRpc.balanceCalls, 0);
  assert.equal(loserRpc.nonceCalls, 0);
});

test("future exact x402 operation, result, and all four receipt schemas validate and round-trip", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), http: challenge(mixedChallenge(false)) }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "future-schema-001",
  });
  const operationId = String(operationRecord(prepared).operationId);
  const store = new StateStore(temporary.root) as StateStore & {
    writeX402Result(profileHash: string, result: Record<string, unknown>): Promise<void>;
    loadX402Result(profileHash: string, operationId: string): Promise<Record<string, unknown> | null>;
    findX402Result(operationId: string): Promise<Record<string, unknown> | null>;
    listX402Results(profileHash: string): Promise<readonly Record<string, unknown>[]>;
    writeX402Receipt(profileHash: string, receipt: Record<string, unknown>): Promise<void>;
    loadX402Receipt(profileHash: string, operationId: string): Promise<Record<string, unknown> | null>;
    findX402Receipt(operationId: string): Promise<Record<string, unknown> | null>;
    listX402Receipts(profileHash: string): Promise<readonly Record<string, unknown>[]>;
  };
  await store.initialize();
  const profileHash = store.profileHash("default");
  const bodyText = '{"ok":true}';
  const result = sealed("apn.x402.result.v1", {
    schemaVersion: "apn.x402.result.v1" as const,
    operationId,
    mediaType: "application/json",
    bodyEncoding: "utf8" as const,
    bodyText,
    resultHash: domainHash("apn.x402.result-body.v1", bodyText),
    byteLength: Buffer.byteLength(bodyText).toString(),
    responseStatus: "200" as const,
    createdAt: "2026-08-26T00:02:00.000Z",
  });
  assert.deepEqual(validateX402Result(result), result);
  await store.writeX402Result(profileHash, result);
  assert.equal(await store.loadX402Result(profileHash, operationId), null, "an operation-first unlinked result is hidden");
  assert.equal(await store.findX402Result(operationId), null);
  assert.deepEqual(await store.listX402Results(profileHash), []);
  const orphanResult = sealed("apn.x402.result.v1", {
    ...(() => { const { integrityHash: _integrity, ...body } = result; return body; })(),
    operationId: sha256("orphan-result"),
  });
  await assert.rejects(store.writeX402Result(profileHash, orphanResult), { code: "APN_STATE_CORRUPT" });
  const orphanResultPath = join(temporary.root, "x402-results", profileHash, `${orphanResult.operationId}.json`);
  await writeFile(orphanResultPath, `${canonicalJson(orphanResult)}\n`, { mode: 0o600 });
  assert.equal(await store.loadX402Result(profileHash, orphanResult.operationId), null);
  assert.equal(await store.findX402Result(orphanResult.operationId), null);
  assert.deepEqual(await store.listX402Results(profileHash), []);
  await assert.rejects(
    store.writeX402Result(store.profileHash("other"), result),
    { code: "APN_STATE_CORRUPT" },
    "an operation-owned result cannot be written under another profile",
  );

  const operationOwnedReceipt = sealed("apn.x402.receipt.v1", {
    schemaVersion: "apn.x402.receipt.v1",
    kind: "x402_fetch",
    operationId,
    terminalState: "failed_before_effect",
    reason: "x402_failed_before_effect",
    proofClass: "x402_proven_no_effect",
    resource: { origin: "https://seller.example", path: "/resource", urlHash: sha256(X402_URL) },
    fingerprint: "4".repeat(64), offerHash: "5".repeat(64), payer: WALLET.toLowerCase(),
    payee: X402_REQUIREMENTS.payTo.toLowerCase(), amountAtomic: "1000000", network: "eip155:8453",
    token: X402_REQUIREMENTS.asset.toLowerCase(), operationBindingHash: "a".repeat(64),
    previousLinkHash: "0".repeat(64), createdAt: "2026-08-26T00:03:00.000Z",
  });
  await assert.rejects(
    store.writeX402Receipt(store.profileHash("other"), operationOwnedReceipt),
    { code: "APN_STATE_CORRUPT" },
    "an operation-owned receipt cannot be written under another profile",
  );

  const settlement = safeSettlementEvidence(operationId);
  const settlementResponseHash = "3".repeat(64);
  const common = {
    schemaVersion: "apn.x402.receipt.v1",
    kind: "x402_fetch",
    resource: { origin: "https://seller.example", path: "/resource", urlHash: sha256(X402_URL) },
    fingerprint: "4".repeat(64),
    offerHash: "5".repeat(64),
    payer: WALLET.toLowerCase(),
    payee: X402_REQUIREMENTS.payTo.toLowerCase(),
    amountAtomic: "1000000",
    network: "eip155:8453",
    token: X402_REQUIREMENTS.asset.toLowerCase(),
    operationBindingHash: "a".repeat(64),
    previousLinkHash: "0".repeat(64),
    createdAt: "2026-08-26T00:03:00.000Z",
  };
  const variants = [
    sealed("apn.x402.receipt.v1", {
      ...common,
      operationId: sha256("receipt-completed"),
      terminalState: "completed",
      reason: "x402_completed",
      proofClass: "x402_safe_settlement",
      settlementResponseHash,
      settlementEvidence: settlement,
      result: { resultHash: result.resultHash, mediaType: result.mediaType, byteLength: result.byteLength, resultIntegrityHash: result.integrityHash },
    }),
    sealed("apn.x402.receipt.v1", {
      ...common,
      operationId: sha256("receipt-no-result"),
      terminalState: "failed_settled_without_result",
      reason: "x402_failed_settled_without_result",
      proofClass: "x402_settled_result_unavailable",
      settlementResponseHash,
      settlementEvidence: settlement,
    }),
    sealed("apn.x402.receipt.v1", {
      ...common,
      operationId: sha256("receipt-expired"),
      terminalState: "failed_expired_unused",
      reason: "x402_failed_expired_unused",
      proofClass: "x402_expired_unused_finalized",
      unusedExpiryEvidence: unusedExpiryEvidence(),
    }),
    sealed("apn.x402.receipt.v1", {
      ...common,
      operationId: sha256("receipt-before-effect"),
      terminalState: "failed_before_effect",
      reason: "x402_failed_before_effect",
      proofClass: "x402_proven_no_effect",
    }),
  ];
  for (const receipt of variants) {
    assert.deepEqual(validateX402Receipt(receipt), receipt);
    await assert.rejects(store.writeX402Receipt(profileHash, receipt), { code: "APN_STATE_CORRUPT" });
    assert.equal(await store.loadX402Receipt(profileHash, String(receipt.operationId)), null);
    assert.equal(await store.findX402Receipt(String(receipt.operationId)), null);
  }
  const orphanReceipt = variants[3]!;
  await mkdir(join(temporary.root, "x402-receipts", profileHash), { mode: 0o700, recursive: true });
  const orphanReceiptPath = join(temporary.root, "x402-receipts", profileHash, `${orphanReceipt.operationId}.json`);
  await writeFile(orphanReceiptPath, `${canonicalJson(orphanReceipt)}\n`, { mode: 0o600 });
  assert.equal(await store.loadX402Receipt(profileHash, String(orphanReceipt.operationId)), null);
  assert.equal(await store.findX402Receipt(String(orphanReceipt.operationId)), null);
  assert.deepEqual(await store.listX402Receipts(profileHash), []);

  await assert.rejects(store.writeX402Result(profileHash, { ...result, unknown: true }), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(store.writeX402Result(profileHash, { ...result, resultHash: "f".repeat(64) }), { code: "APN_STATE_CORRUPT" });
  const oversizedBody = "x".repeat(256 * 1024 + 1);
  const oversizedResult = sealed("apn.x402.result.v1", {
    schemaVersion: "apn.x402.result.v1",
    operationId: sha256("oversized-result"),
    mediaType: "text/plain",
    bodyEncoding: "utf8",
    bodyText: oversizedBody,
    resultHash: domainHash("apn.x402.result-body.v1", oversizedBody),
    byteLength: Buffer.byteLength(oversizedBody).toString(),
    responseStatus: "200",
    createdAt: "2026-08-26T00:02:00.000Z",
  });
  await assert.rejects(store.writeX402Result(profileHash, oversizedResult), { code: "APN_STATE_CORRUPT" });
  const { integrityHash: _resultIntegrity, ...resultBody } = result;
  const loneSurrogateBody = "bad\ud800";
  const loneSurrogateResult = sealed("apn.x402.result.v1", {
    ...resultBody,
    bodyText: loneSurrogateBody,
    resultHash: domainHash("apn.x402.result-body.v1", loneSurrogateBody),
    byteLength: Buffer.byteLength(loneSurrogateBody).toString(),
  });
  await assert.rejects(store.writeX402Result(profileHash, loneSurrogateResult), { code: "APN_STATE_CORRUPT" });
  const fullTokenMediaResult = sealed("apn.x402.result.v1", {
    ...resultBody,
    mediaType: "text/vnd.test+json~x|y",
  });
  await store.writeX402Result(profileHash, fullTokenMediaResult);
  const maxMediaResult = sealed("apn.x402.result.v1", {
    ...resultBody,
    mediaType: `text/${"x".repeat(123)}`,
  });
  await store.writeX402Result(profileHash, maxMediaResult);
  const oversizedMediaResult = sealed("apn.x402.result.v1", {
    ...resultBody,
    mediaType: `text/${"x".repeat(124)}`,
  });
  await assert.rejects(store.writeX402Result(profileHash, oversizedMediaResult), { code: "APN_STATE_CORRUPT" });
  const invalidCompleted = sealed("apn.x402.receipt.v1", {
    ...common,
    operationId: sha256("receipt-invalid"),
    terminalState: "completed",
    reason: "x402_completed",
    proofClass: "x402_safe_settlement",
  });
  await assert.rejects(store.writeX402Receipt(profileHash, invalidCompleted), { code: "APN_STATE_CORRUPT" });
});

test("future attempt/state combinations accept exact pending schema and reject state-incompatible observation", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), http: challenge(mixedChallenge(false)) }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "future-attempt-001",
  });
  const operationId = String(operationRecord(prepared).operationId);
  const state = await readOperation(temporary.root, "default", operationId);
  const transition = {
    at: state.updatedAt,
    state: "paid_request_pending" as const,
    terminal: false,
    reason: "x402_paid_request_pending" as const,
    proofClass: "x402_unknown_finality" as const,
  };
  const materialPending = {
    at: state.updatedAt,
    state: "authorization_material_pending" as const,
    terminal: false,
    reason: "x402_authorization_material_pending" as const,
    proofClass: "x402_authorization_recovery" as const,
  };
  const authorized = {
    at: state.updatedAt,
    state: "authorized_not_sent" as const,
    terminal: false,
    reason: "x402_authorized_not_sent" as const,
    proofClass: "x402_authorization_verified" as const,
  };
  const futureTransitions = appendX402Transition(appendX402Transition(appendX402Transition(
    state.transitions,
    materialPending,
  ), authorized), transition);
  const attempt = {
    attemptNumber: "1",
    purpose: "payment",
    phase: "pending",
    requestHeaderHash: "4".repeat(64),
    persistedAt: state.updatedAt,
  };
  const { integrityHash: _oldIntegrity, ...base } = state;
  const materialPendingOperation = resealOperation({
    ...state,
    state: materialPending.state,
    finalityClass: "pre_effect",
    reason: materialPending.reason,
    proofClass: materialPending.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(state.transitions, materialPending),
  });
  const authorizedOperation = resealOperation({
    ...materialPendingOperation,
    signatureHash: "2".repeat(64),
    paymentPayloadHash: "3".repeat(64),
    paymentHeaderHash: "4".repeat(64),
    state: authorized.state,
    finalityClass: "pre_effect",
    reason: authorized.reason,
    proofClass: authorized.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(materialPendingOperation.transitions, authorized),
  });
  const future = resealOperation({
    ...authorizedOperation,
    attempts: [attempt],
    state: transition.state,
    finalityClass: "unknown_finality",
    reason: transition.reason,
    proofClass: transition.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(authorizedOperation.transitions, transition),
  });
  const store = new StateStore(temporary.root);
  await store.writeX402Operation(materialPendingOperation);
  await store.writeX402Operation(authorizedOperation);
  await store.writeX402Operation(future as unknown as X402OperationRecord);
  assert.deepEqual((await store.loadX402Operation(state.profileHash, operationId))?.attempts, [attempt]);
  const changedCapBody = {
    ...future,
    capAtomic: "20000000",
    requestHash: hashObject({
      method: "x402.fetch.prepare",
      profile: future.profile,
      canonicalUrl: future.resource.canonicalUrl,
      capAtomic: "20000000",
    }),
  };
  const changedCap = resealOperation({
    ...changedCapBody,
    fingerprint: x402Fingerprint(changedCapBody as unknown as X402OperationRecord),
  });
  await assert.rejects(
    store.writeX402Operation(changedCap),
    { code: "APN_STATE_CORRUPT" },
    "a resealed overwrite cannot replace cap/request/fingerprint",
  );

  const invalid = sealed("apn.x402.state.v1", {
    ...base,
    signatureHash: "2".repeat(64),
    paymentPayloadHash: "3".repeat(64),
    paymentHeaderHash: "4".repeat(64),
    attempts: [{ ...attempt, observation: { unexpected: true } }],
    state: transition.state,
    finalityClass: "unknown_finality",
    reason: transition.reason,
    proofClass: transition.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: futureTransitions,
  });
  await assert.rejects(store.writeX402Operation(invalid as unknown as X402OperationRecord), { code: "APN_STATE_CORRUPT" });

  const transaction = `0x${"9".repeat(64)}`;
  const normalizedCanonicalJson = canonicalJson({
    network: "eip155:8453",
    success: true,
    transaction,
  });
  const settlementResponseObservation = {
    schemaVersion: "apn.x402.settlement-response.v1",
    classification: "success",
    normalizedCanonicalJson,
    paymentResponseHeaderHash: "5".repeat(64),
    settlementResponseHash: domainHash("apn.x402.settlement.v1", normalizedCanonicalJson),
    httpAttemptNumber: "1",
    observedAt: state.updatedAt,
  };
  const startBlock = BigInt(state.preparedBlock.number);
  const authorizationUsedScanBase = {
    schemaVersion: "apn.x402.authorization-used-scan.v1",
    searchStartBlock: state.preparedBlock.number,
    nextFromBlock: state.preparedBlock.number,
    targetSafeHead: { number: (startBlock + 10n).toString(), hash: state.preparedBlock.hash, observedAt: state.updatedAt },
    candidates: [],
    status: "active",
    updatedAt: state.updatedAt,
  };
  const authorizationUsedScan = {
    ...authorizationUsedScanBase,
    evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(authorizationUsedScanBase)),
  };
  const observedAttempt = {
    ...attempt,
    phase: "observed",
    observation: {
      attemptNumber: "1",
      purpose: "payment",
      targetHash: state.resource.urlHash,
      status: "200",
      rawHeadersHash: "6".repeat(64),
      paymentResponseHeaderHash: settlementResponseObservation.paymentResponseHeaderHash,
      bodyHash: domainHash("apn.x402.result-body.v1", "{}"),
      bodyByteLength: "2",
      mediaType: "application/json",
      finalUrlHash: state.resource.urlHash,
      origin: state.resource.origin,
      selectedIpFamily: "ipv4",
      startedAt: state.updatedAt,
      observedAt: state.updatedAt,
    },
  };
  const effectUnknownTransition = {
    at: state.updatedAt,
    state: "effect_unknown" as const,
    terminal: false,
    reason: "x402_effect_unknown" as const,
    proofClass: "x402_unknown_finality" as const,
  };
  const effectUnknownTransitions = appendX402Transition(futureTransitions, effectUnknownTransition);
  const linkedBody = "{}";
  const linkedResult = sealed("apn.x402.result.v1", {
    schemaVersion: "apn.x402.result.v1" as const,
    operationId,
    mediaType: "application/json",
    bodyEncoding: "utf8" as const,
    bodyText: linkedBody,
    resultHash: domainHash("apn.x402.result-body.v1", linkedBody),
    byteLength: Buffer.byteLength(linkedBody).toString(),
    responseStatus: "200" as const,
    createdAt: state.updatedAt,
  });
  const effectUnknownWithoutResult = sealed("apn.x402.state.v1", {
    ...base,
    signatureHash: "2".repeat(64),
    paymentPayloadHash: "3".repeat(64),
    paymentHeaderHash: "4".repeat(64),
    attempts: [observedAttempt],
    settlementResponseObservation,
    transactionHint: {
      transactionHash: transaction,
      source: "payment_response",
      sourceBindingHash: paymentResponseBindingHash(settlementResponseObservation.settlementResponseHash),
      observedAt: state.updatedAt,
    },
    authorizationUsedScan,
    state: effectUnknownTransition.state,
    finalityClass: "unknown_finality",
    reason: effectUnknownTransition.reason,
    proofClass: effectUnknownTransition.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: effectUnknownTransitions,
  });
  await store.writeX402Operation(effectUnknownWithoutResult as unknown as X402OperationRecord);
  await store.writeX402Result(state.profileHash, linkedResult);
  const restartedStore = new StateStore(temporary.root) as StateStore & {
    loadX402RecoveryResult(profileHash: string, operationId: string): Promise<Record<string, unknown> | null>;
  };
  await restartedStore.initialize();
  assert.equal(await restartedStore.loadX402Result(state.profileHash, operationId), null);
  assert.deepEqual(
    await restartedStore.loadX402RecoveryResult(state.profileHash, operationId),
    linkedResult,
    "an explicit deterministic restart read can recover an operation-owned orphan result",
  );
  const { integrityHash: _effectUnknownIntegrity, ...effectUnknownWithoutIntegrity } = effectUnknownWithoutResult;
  const effectUnknown = sealed("apn.x402.state.v1", {
    ...effectUnknownWithoutIntegrity,
    resultLink: { resultHash: linkedResult.resultHash, resultIntegrityHash: linkedResult.integrityHash },
  });
  await store.writeX402Operation(effectUnknown as unknown as X402OperationRecord);
  assert.equal((await store.loadX402Operation(state.profileHash, operationId))?.state, "effect_unknown");
  const { transactionHint: _removedHint, ...withoutDurableHint } = effectUnknown;
  await assert.rejects(
    store.writeX402Operation(resealOperation(withoutDurableHint)),
    { code: "APN_STATE_CORRUPT" },
    "a durable transaction hint cannot be removed",
  );
  const { resultLink: _removedResultLink, ...withoutDurableResultLink } = effectUnknown;
  await assert.rejects(
    store.writeX402Operation(resealOperation(withoutDurableResultLink)),
    { code: "APN_STATE_CORRUPT" },
    "a durable result link cannot be removed",
  );
  await assert.rejects(
    store.writeX402Operation(resealOperation({
      ...effectUnknown,
      settlementResponseObservation: {
        ...effectUnknown.settlementResponseObservation,
        observedAt: "2026-08-26T00:00:00.001Z",
      },
    })),
    { code: "APN_STATE_CORRUPT" },
    "a durable settlement response cannot be replaced",
  );

  const candidate = {
    blockNumber: state.preparedBlock.number,
    blockHash: state.preparedBlock.hash,
    transactionHash: transaction,
    logIndex: "0",
    authorizer: state.wallet,
    nonce: state.authorization.nonce,
  };
  const scan = (value: Record<string, unknown>): Record<string, unknown> => ({
    ...value,
    evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(value)),
  });
  const activeScanBase = {
    schemaVersion: "apn.x402.authorization-used-scan.v1",
    searchStartBlock: state.preparedBlock.number,
    nextFromBlock: state.preparedBlock.number,
    targetSafeHead: { number: (startBlock + 10n).toString(), hash: state.preparedBlock.hash, observedAt: state.updatedAt },
    candidates: [],
    status: "active",
    updatedAt: state.updatedAt,
  };
  const graphCases: readonly { readonly label: string; readonly scan: Record<string, unknown>; readonly hint?: Record<string, unknown> }[] = [
    {
      label: "candidate-wallet-nonce-binding",
      scan: scan({ ...activeScanBase, candidates: [{ ...candidate, authorizer: OTHER_RECIPIENT.toLowerCase(), nonce: `0x${"f".repeat(64)}` }] }),
    },
    {
      label: "duplicate-candidate-key",
      scan: scan({
        ...activeScanBase,
        nextFromBlock: (startBlock + 1n).toString(),
        lastCompletedChunk: { fromBlock: state.preparedBlock.number, toBlock: state.preparedBlock.number, toBlockHash: state.preparedBlock.hash },
        candidates: [candidate, { ...candidate }],
        status: "ambiguous",
      }),
    },
    {
      label: "three-distinct-candidates",
      scan: scan({
        ...activeScanBase,
        nextFromBlock: (startBlock + 3n).toString(),
        lastCompletedChunk: { fromBlock: state.preparedBlock.number, toBlock: (startBlock + 2n).toString(), toBlockHash: state.preparedBlock.hash },
        candidates: [candidate, { ...candidate, logIndex: "1" }, { ...candidate, logIndex: "2" }],
        status: "ambiguous",
      }),
    },
    {
      label: "search-start-moved",
      scan: scan({ ...activeScanBase, searchStartBlock: (startBlock + 1n).toString(), nextFromBlock: (startBlock + 1n).toString() }),
    },
    {
      label: "chunk-over-2048",
      scan: scan({
        ...activeScanBase,
        targetSafeHead: { ...activeScanBase.targetSafeHead, number: (startBlock + 2048n).toString() },
        nextFromBlock: (startBlock + 2049n).toString(),
        lastCompletedChunk: { fromBlock: state.preparedBlock.number, toBlock: (startBlock + 2048n).toString(), toBlockHash: state.preparedBlock.hash },
        status: "complete",
      }),
    },
    {
      label: "unavailable-advanced",
      scan: scan({ ...activeScanBase, nextFromBlock: (startBlock + 1n).toString(), status: "unavailable", unavailableReason: "pruned" }),
    },
    {
      label: "incomplete-log-hint",
      scan: scan(activeScanBase),
      hint: { transactionHash: transaction, source: "authorization_used_log", sourceBindingHash: "a".repeat(64), observedAt: state.updatedAt },
    },
    {
      label: "wrong-payment-response-binding",
      scan: scan(activeScanBase),
      hint: { transactionHash: transaction, source: "payment_response", sourceBindingHash: "f".repeat(64), observedAt: state.updatedAt },
    },
  ];
  for (const graphCase of graphCases) {
    const operation = resealOperation({
      ...effectUnknown,
      authorizationUsedScan: graphCase.scan,
      ...(graphCase.hint === undefined ? {} : { transactionHint: graphCase.hint }),
    });
    assert.throws(() => validateX402Operation(operation), { code: "APN_STATE_CORRUPT" }, graphCase.label);
  }

  const completeScanBody = {
    ...activeScanBase,
    nextFromBlock: (startBlock + 11n).toString(),
    lastCompletedChunk: { fromBlock: state.preparedBlock.number, toBlock: (startBlock + 10n).toString(), toBlockHash: state.preparedBlock.hash },
    candidates: [{ ...candidate, blockNumber: (startBlock + 10n).toString() }],
    status: "complete",
  };
  const completeScan = scan(completeScanBody);
  const validLogHint = {
    transactionHash: transaction,
    source: "authorization_used_log",
    sourceBindingHash: authorizationUsedLogBindingHash(String(completeScan.evidenceHash)),
    observedAt: state.updatedAt,
  };
  assert.doesNotThrow(() => validateX402Operation(resealOperation({
    ...effectUnknown,
    authorizationUsedScan: completeScan,
    transactionHint: validLogHint,
  })));
  for (const [label, hint] of [
    ["raw-authorization-scan-hash", { ...validLogHint, sourceBindingHash: completeScan.evidenceHash }],
    ["wrong-authorization-variant", {
      ...validLogHint,
      sourceBindingHash: paymentResponseBindingHash(String(completeScan.evidenceHash)),
    }],
    ["raw-payment-response-hash", {
      ...effectUnknown.transactionHint,
      sourceBindingHash: settlementResponseObservation.settlementResponseHash,
    }],
    ["wrong-payment-variant", {
      ...effectUnknown.transactionHint,
      sourceBindingHash: authorizationUsedLogBindingHash(settlementResponseObservation.settlementResponseHash),
    }],
  ] as const) {
    assert.throws(() => validateX402Operation(resealOperation({
      ...effectUnknown,
      ...(hint.source === "authorization_used_log" ? { authorizationUsedScan: completeScan } : {}),
      transactionHint: hint,
    })), { code: "APN_STATE_CORRUPT" }, label);
  }
  const skippedChunkBody = {
    ...activeScanBase,
    nextFromBlock: (startBlock + 2n).toString(),
    lastCompletedChunk: {
      fromBlock: (startBlock + 1n).toString(),
      toBlock: (startBlock + 1n).toString(),
      toBlockHash: state.preparedBlock.hash,
    },
  };
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...effectUnknown, authorizationUsedScan: scan(skippedChunkBody) })),
    { code: "APN_STATE_CORRUPT" },
    "scan persistence cannot skip the previous cursor",
  );
  const progressedScanBody = {
    ...activeScanBase,
    nextFromBlock: (startBlock + 1n).toString(),
    lastCompletedChunk: {
      fromBlock: startBlock.toString(),
      toBlock: startBlock.toString(),
      toBlockHash: state.preparedBlock.hash,
    },
    candidates: [candidate],
  };
  const progressed = resealOperation({ ...effectUnknown, authorizationUsedScan: scan(progressedScanBody) });
  await store.writeX402Operation(progressed);
  await store.writeX402Operation(resealOperation({
    ...progressed,
    updatedAt: progressed.updatedAt,
  }));
  const unavailableWithChangedCandidatesBody = {
    ...progressedScanBody,
    candidates: [],
    status: "unavailable",
    unavailableReason: "pruned",
  };
  await assert.rejects(
    store.writeX402Operation(resealOperation({
      ...progressed,
      authorizationUsedScan: scan(unavailableWithChangedCandidatesBody),
      nextActions: ["operation.resume", "operation.status", "use.archival_rpc"],
    })),
    { code: "APN_STATE_CORRUPT" },
    "an unavailable scan cannot alter candidates or advance",
  );
  const droppedCandidateOnNextChunkBody = {
    ...activeScanBase,
    nextFromBlock: (startBlock + 2n).toString(),
    lastCompletedChunk: {
      fromBlock: (startBlock + 1n).toString(),
      toBlock: (startBlock + 1n).toString(),
      toBlockHash: state.preparedBlock.hash,
    },
    candidates: [],
  };
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...progressed, authorizationUsedScan: scan(droppedCandidateOnNextChunkBody) })),
    { code: "APN_STATE_CORRUPT" },
    "a later scan chunk cannot discard a prior candidate",
  );
  const sameHeadResetBody = {
    ...activeScanBase,
    candidates: [],
  };
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...progressed, authorizationUsedScan: scan(sameHeadResetBody) })),
    { code: "APN_STATE_CORRUPT" },
    "a scan reset must pin a new safe head",
  );
  const unavailableProgressedBody = {
    ...progressedScanBody,
    status: "unavailable",
    unavailableReason: "range_unavailable",
  };
  const unavailableProgressed = resealOperation({
    ...progressed,
    authorizationUsedScan: scan(unavailableProgressedBody),
    nextActions: ["operation.resume", "operation.status", "use.archival_rpc"],
    transitions: appendX402Transition(progressed.transitions, {
      at: state.updatedAt, state: "effect_unknown", terminal: false,
      reason: "x402_effect_unknown", proofClass: "x402_unknown_finality",
    }),
  });
  await assert.rejects(
    store.writeX402Operation(resealOperation({
      ...unavailableProgressed,
      transitions: progressed.transitions,
    })),
    { code: "APN_STATE_CORRUPT" },
    "an unavailable classification requires a durable self-transition",
  );
  await store.writeX402Operation(unavailableProgressed);
  const rearmedScanBody = {
    ...unavailableProgressedBody,
    status: "active",
    unavailableReason: undefined,
  };
  const { unavailableReason: _removedUnavailableReason, ...rearmedScanWithoutReason } = rearmedScanBody;
  const rearmed = resealOperation({
    ...unavailableProgressed,
    authorizationUsedScan: scan(rearmedScanWithoutReason),
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(unavailableProgressed.transitions, {
      at: state.updatedAt, state: "effect_unknown", terminal: false,
      reason: "x402_effect_unknown", proofClass: "x402_unknown_finality",
    }),
  });
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...rearmed, transitions: unavailableProgressed.transitions })),
    { code: "APN_STATE_CORRUPT" },
    "an unavailable scan rearm requires a durable self-transition",
  );
  await store.writeX402Operation(rearmed);
  const newHeadResetBody = {
    ...sameHeadResetBody,
    targetSafeHead: {
      number: (startBlock + 20n).toString(),
      hash: `0x${"e".repeat(64)}`,
      observedAt: state.updatedAt,
    },
  };
  const resetOperation = resealOperation({
    ...rearmed,
    authorizationUsedScan: scan(newHeadResetBody),
    transitions: appendX402Transition(rearmed.transitions, {
      at: state.updatedAt, state: "effect_unknown", terminal: false,
      reason: "x402_effect_unknown", proofClass: "x402_unknown_finality",
    }),
  });
  await store.writeX402Operation(resetOperation);

  const repeatedUnknown = {
    at: state.updatedAt, state: "effect_unknown" as const, terminal: false,
    reason: "x402_effect_unknown" as const, proofClass: "x402_unknown_finality" as const,
  };
  const extendedOperation = resealOperation({
    ...resetOperation,
    transitions: appendX402Transition(resetOperation.transitions, repeatedUnknown),
  });
  await store.writeX402Operation(extendedOperation);
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...extendedOperation, transitions: resetOperation.transitions })),
    { code: "APN_STATE_CORRUPT" },
    "transition history cannot be truncated",
  );
  const secondPaymentAttempt = {
    attemptNumber: "2", purpose: "payment" as const, phase: "pending" as const,
    requestHeaderHash: extendedOperation.paymentHeaderHash as string, persistedAt: state.updatedAt,
  };
  const extendedAttemptsOperation = resealOperation({
    ...extendedOperation,
    attempts: [...extendedOperation.attempts, secondPaymentAttempt],
  });
  await store.writeX402Operation(extendedAttemptsOperation);
  await assert.rejects(
    store.writeX402Operation(resealOperation({ ...extendedAttemptsOperation, attempts: extendedOperation.attempts })),
    { code: "APN_STATE_CORRUPT" },
    "attempt history cannot be truncated",
  );
  assert.throws(
    () => validateX402Operation(resealOperation({
      ...extendedOperation,
      attempts: [
        ...extendedOperation.attempts,
        { ...secondPaymentAttempt, persistedAt: "2026-08-25T23:59:59.000Z" },
      ],
    })),
    { code: "APN_STATE_CORRUPT" },
    "attempt persisted timestamps cannot move backward",
  );

  const resultPath = join(temporary.root, "x402-results", state.profileHash, `${operationId}.json`);
  const linkedResultBytes = await readFile(resultPath);
  await unlink(resultPath);
  await assert.rejects(store.loadX402Operation(state.profileHash, operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(resultPath, linkedResultBytes, { mode: 0o600 });
  const mismatchedLinkedResult = sealed("apn.x402.result.v1", {
    ...(() => { const { integrityHash: _integrity, ...body } = linkedResult; return body; })(),
    bodyText: '{"ok":false}',
    resultHash: domainHash("apn.x402.result-body.v1", '{"ok":false}'),
    byteLength: Buffer.byteLength('{"ok":false}').toString(),
  });
  await writeFile(resultPath, `${canonicalJson(mismatchedLinkedResult)}\n`);
  await assert.rejects(store.loadX402Operation(state.profileHash, operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(resultPath, linkedResultBytes);
  const twoRecoveryAttempts = resealOperation({
    ...effectUnknown,
    attempts: [
      observedAttempt,
      { attemptNumber: "2", purpose: "result_recovery", phase: "pending", requestHeaderHash: effectUnknown.paymentHeaderHash, persistedAt: state.updatedAt },
      { attemptNumber: "3", purpose: "result_recovery", phase: "pending", requestHeaderHash: effectUnknown.paymentHeaderHash, persistedAt: state.updatedAt },
    ],
  });
  assert.throws(() => validateX402Operation(twoRecoveryAttempts), { code: "APN_STATE_CORRUPT" }, "at most one cached recovery attempt");
  const invalidOptional = sealed("apn.x402.state.v1", {
    ...effectUnknown,
    transactionHint: { ...effectUnknown.transactionHint, unknown: true },
    integrityHash: undefined,
  });
  await assert.rejects(store.writeX402Operation(invalidOptional as unknown as X402OperationRecord), { code: "APN_STATE_CORRUPT" });
});

test("terminal x402 graph forbids material on no-effect failure and requires exact durable receipt links", async (t) => {
  async function setup(key: string): Promise<{ readonly root: string; readonly store: StateStore; readonly operation: X402OperationRecord }> {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
    const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), http: challenge(mixedChallenge(false)) }).execute({
      ...PREPARE_REQUEST,
      idempotencyKey: key,
    });
    const operationId = String(operationRecord(prepared).operationId);
    return { root: temporary.root, store: new StateStore(temporary.root), operation: await readOperation(temporary.root, "default", operationId) };
  }

  function receiptFor(operation: X402OperationRecord, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return sealed("apn.x402.receipt.v1", {
      schemaVersion: "apn.x402.receipt.v1",
      kind: "x402_fetch",
      operationId: operation.operationId,
      terminalState: "failed_before_effect",
      reason: "x402_failed_before_effect",
      proofClass: "x402_proven_no_effect",
      resource: { origin: operation.resource.origin, path: operation.resource.path, urlHash: operation.resource.urlHash },
      fingerprint: operation.fingerprint,
      offerHash: operation.selectedOffer.offerHash,
      payer: operation.wallet,
      payee: operation.payee,
      amountAtomic: operation.amountAtomic,
      network: operation.network,
      token: operation.token,
      ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
      operationBindingHash: operationBindingHash(operation),
      previousLinkHash: operation.transitions.at(-1)!.hash,
      createdAt: operation.updatedAt,
      ...overrides,
    });
  }

  function terminalFor(operation: X402OperationRecord, receiptIntegrityHash: string, includeMaterial = false): X402OperationRecord {
    const terminalTransition = {
      at: operation.updatedAt,
      state: "failed_before_effect" as const,
      terminal: true,
      reason: "x402_failed_before_effect" as const,
      proofClass: "x402_proven_no_effect" as const,
    };
    return resealOperation({
      ...operation,
      ...(includeMaterial ? {
        signatureHash: "1".repeat(64),
        paymentPayloadHash: "2".repeat(64),
        paymentHeaderHash: "3".repeat(64),
      } : {}),
      state: terminalTransition.state,
      finalityClass: "terminal",
      terminal: true,
      reason: terminalTransition.reason,
      proofClass: terminalTransition.proofClass,
      nextActions: ["receipt.get"],
      receiptLink: { receiptIntegrityHash },
      transitions: appendX402Transition(operation.transitions, terminalTransition),
    });
  }

  const material = await setup("terminal-material");
  assert.throws(
    () => validateX402Operation(terminalFor(material.operation, "a".repeat(64), true)),
    { code: "APN_STATE_CORRUPT" },
  );

  const dangling = await setup("terminal-dangling");
  await assert.rejects(
    dangling.store.writeX402Operation(terminalFor(dangling.operation, "b".repeat(64))),
    { code: "APN_STATE_CORRUPT" },
  );

  const mismatched = await setup("terminal-mismatch");
  const mismatchedReceipt = receiptFor(mismatched.operation, { payee: OTHER_RECIPIENT.toLowerCase() });
  await assert.rejects(
    mismatched.store.writeX402Receipt(mismatched.operation.profileHash, mismatchedReceipt as never),
    { code: "APN_STATE_CORRUPT" },
  );

  const wrongPreviousLink = await setup("terminal-previous-link");
  const wrongPreviousLinkReceipt = receiptFor(wrongPreviousLink.operation, { previousLinkHash: "f".repeat(64) });
  await assert.rejects(
    wrongPreviousLink.store.writeX402Receipt(wrongPreviousLink.operation.profileHash, wrongPreviousLinkReceipt as never),
    { code: "APN_STATE_CORRUPT" },
    "a receipt must link the immediately preceding nonterminal transition",
  );

  const missingResult = await setup("terminal-result-missing");
  const transactionHash = `0x${"9".repeat(64)}`;
  const blockHash = `0x${"8".repeat(64)}`;
  const settlementEvidenceBody = {
    schemaVersion: "apn.x402.settlement-evidence.v1",
    network: "eip155:8453",
    chainId: "8453",
    token: missingResult.operation.token,
    transactionHash,
    safeHead: { number: "12400", hash: blockHash, observedAt: missingResult.operation.updatedAt },
    transactionBlock: { number: "12399", hash: blockHash, timestamp: "1787702400" },
    receiptStatus: "1",
    blockHashRechecked: true,
    authorizationUsed: {
      logIndex: "0", authorizer: missingResult.operation.wallet, nonce: missingResult.operation.authorization.nonce,
      blockNumber: "12399", blockHash, transactionHash,
    },
    transfer: {
      logIndex: "1", from: missingResult.operation.wallet, to: missingResult.operation.payee,
      value: missingResult.operation.amountAtomic, blockNumber: "12399", blockHash, transactionHash,
    },
    authorizationState: { value: true, blockNumber: "12399", blockHash, blockTag: "number", observedAt: missingResult.operation.updatedAt },
    rpcOriginHash: sha256("https://rpc.example"),
  };
  const settlementEvidence = {
    ...settlementEvidenceBody,
    evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(settlementEvidenceBody)),
  };
  const normalizedCanonicalJson = canonicalJson({ network: "eip155:8453", success: true, transaction: transactionHash });
  const settlementResponseObservation = {
    schemaVersion: "apn.x402.settlement-response.v1",
    classification: "success",
    normalizedCanonicalJson,
    paymentResponseHeaderHash: "4".repeat(64),
    settlementResponseHash: domainHash("apn.x402.settlement.v1", normalizedCanonicalJson),
    httpAttemptNumber: "1",
    observedAt: missingResult.operation.updatedAt,
  };
  const recoveredBodyText = "{}";
  const recoveredResult = sealed("apn.x402.result.v1", {
    schemaVersion: "apn.x402.result.v1" as const,
    operationId: missingResult.operation.operationId,
    mediaType: "application/json",
    bodyEncoding: "utf8" as const,
    bodyText: recoveredBodyText,
    resultHash: domainHash("apn.x402.result-body.v1", recoveredBodyText),
    byteLength: Buffer.byteLength(recoveredBodyText).toString(),
    responseStatus: "200" as const,
    createdAt: missingResult.operation.updatedAt,
  });
  const missingResultHash = recoveredResult.resultHash;
  const missingResultIntegrityHash = recoveredResult.integrityHash;
  const observedAttempt = {
    attemptNumber: "1", purpose: "payment", phase: "observed", requestHeaderHash: "3".repeat(64), persistedAt: missingResult.operation.updatedAt,
    observation: {
      attemptNumber: "1", purpose: "payment", targetHash: missingResult.operation.resource.urlHash, status: "200",
      rawHeadersHash: "5".repeat(64), paymentResponseHeaderHash: settlementResponseObservation.paymentResponseHeaderHash,
      bodyHash: missingResultHash, bodyByteLength: "2", mediaType: "application/json",
      finalUrlHash: missingResult.operation.resource.urlHash, origin: missingResult.operation.resource.origin,
      selectedIpFamily: "ipv4", startedAt: missingResult.operation.updatedAt, observedAt: missingResult.operation.updatedAt,
    },
  };
  const materialPending = {
    at: missingResult.operation.updatedAt, state: "authorization_material_pending" as const, terminal: false,
    reason: "x402_authorization_material_pending" as const, proofClass: "x402_authorization_recovery" as const,
  };
  const authorized = {
    at: missingResult.operation.updatedAt, state: "authorized_not_sent" as const, terminal: false,
    reason: "x402_authorized_not_sent" as const, proofClass: "x402_authorization_verified" as const,
  };
  const paid = {
    at: missingResult.operation.updatedAt, state: "paid_request_pending" as const, terminal: false,
    reason: "x402_paid_request_pending" as const, proofClass: "x402_unknown_finality" as const,
  };
  const completed = {
    at: missingResult.operation.updatedAt, state: "completed" as const, terminal: true,
    reason: "x402_completed" as const, proofClass: "x402_safe_settlement" as const,
  };
  const completedTransitions = appendX402Transition(appendX402Transition(appendX402Transition(appendX402Transition(
    missingResult.operation.transitions, materialPending,
  ), authorized), paid), completed);
  const unknownWithEvidenceTransition = {
    at: missingResult.operation.updatedAt, state: "effect_unknown" as const, terminal: false,
    reason: "x402_effect_unknown" as const, proofClass: "x402_unknown_finality" as const,
  };
  const unknownWithEvidenceTransitions = appendX402Transition(appendX402Transition(appendX402Transition(appendX402Transition(
    missingResult.operation.transitions, materialPending,
  ), authorized), paid), unknownWithEvidenceTransition);
  const { integrityHash: _failedReceiptIntegrity, ...completedReceiptBase } = receiptFor(missingResult.operation);
  const completedReceipt = sealed("apn.x402.receipt.v1", {
    ...completedReceiptBase,
    previousLinkHash: completedTransitions.at(-1)!.previousHash,
    terminalState: "completed",
    reason: "x402_completed",
    proofClass: "x402_safe_settlement",
    settlementResponseHash: settlementResponseObservation.settlementResponseHash,
    settlementEvidence,
    result: { resultHash: missingResultHash, mediaType: "application/json", byteLength: "2", resultIntegrityHash: missingResultIntegrityHash },
  });
  const completedOperation = resealOperation({
    ...missingResult.operation,
    signatureHash: "1".repeat(64), paymentPayloadHash: "2".repeat(64), paymentHeaderHash: "3".repeat(64),
    attempts: [observedAttempt], settlementResponseObservation,
    transactionHint: {
      transactionHash,
      source: "payment_response",
      sourceBindingHash: paymentResponseBindingHash(settlementResponseObservation.settlementResponseHash),
      observedAt: missingResult.operation.updatedAt,
    },
    settlementEvidence,
    resultLink: { resultHash: missingResultHash, resultIntegrityHash: missingResultIntegrityHash },
    receiptLink: { receiptIntegrityHash: completedReceipt.integrityHash },
    state: "completed", finalityClass: "terminal", terminal: true, reason: "x402_completed", proofClass: "x402_safe_settlement",
    nextActions: ["receipt.get"], transitions: completedTransitions,
  });
  assert.doesNotThrow(() => validateX402Operation(completedOperation));
  const scanSafeHead = settlementEvidence.safeHead as { readonly number: string; readonly hash: `0x${string}`; readonly observedAt: string };
  const scanTransactionBlock = settlementEvidence.transactionBlock as { readonly number: string; readonly hash: `0x${string}` };
  const recoveryScanBody = {
    schemaVersion: "apn.x402.authorization-used-scan.v1",
    searchStartBlock: missingResult.operation.preparedBlock.number,
    nextFromBlock: (BigInt(scanSafeHead.number) + 1n).toString(),
    targetSafeHead: scanSafeHead,
    lastCompletedChunk: {
      fromBlock: missingResult.operation.preparedBlock.number,
      toBlock: scanSafeHead.number,
      toBlockHash: scanSafeHead.hash,
    },
    candidates: [{
      blockNumber: scanTransactionBlock.number, blockHash: scanTransactionBlock.hash,
      transactionHash, logIndex: "0", authorizer: missingResult.operation.wallet,
      nonce: missingResult.operation.authorization.nonce,
    }],
    status: "complete",
    updatedAt: missingResult.operation.updatedAt,
  };
  const recoveryScan = {
    ...recoveryScanBody,
    evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(recoveryScanBody)),
  };
  const scanHint = {
    transactionHash,
    source: "authorization_used_log",
    sourceBindingHash: authorizationUsedLogBindingHash(recoveryScan.evidenceHash),
    observedAt: missingResult.operation.updatedAt,
  };
  const sellerRecoveryTransition = {
    at: missingResult.operation.updatedAt, state: "seller_result_recovery_pending" as const, terminal: false,
    reason: "x402_seller_result_recovery_pending" as const,
    proofClass: "x402_settlement_verified_result_pending" as const,
  };
  const sellerRecoveryTransitions = appendX402Transition(appendX402Transition(appendX402Transition(appendX402Transition(
    missingResult.operation.transitions, materialPending,
  ), authorized), paid), sellerRecoveryTransition);
  const paymentAttemptWithoutResult = {
    ...observedAttempt,
    observation: { ...observedAttempt.observation, bodyHash: "6".repeat(64) },
  };
  const sellerRecovery = resealOperation({
    ...missingResult.operation,
    signatureHash: "1".repeat(64), paymentPayloadHash: "2".repeat(64), paymentHeaderHash: "3".repeat(64),
    attempts: [paymentAttemptWithoutResult], transactionHint: scanHint, authorizationUsedScan: recoveryScan,
    settlementEvidence,
    state: "seller_result_recovery_pending", finalityClass: "known_settled", terminal: false,
    reason: "x402_seller_result_recovery_pending", proofClass: "x402_settlement_verified_result_pending",
    nextActions: ["operation.resume", "operation.status"], transitions: sellerRecoveryTransitions,
  });
  assert.doesNotThrow(
    () => validateX402Operation(sellerRecovery),
    "scan-derived exact settlement can enter cached-result recovery without a settlement response",
  );
  const paymentMaterialPendingOperation = resealOperation({
    ...missingResult.operation,
    state: "authorization_material_pending", finalityClass: "pre_effect", terminal: false,
    reason: "x402_authorization_material_pending", proofClass: "x402_authorization_recovery",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(missingResult.operation.transitions, materialPending),
  });
  const paymentAuthorizedOperation = resealOperation({
    ...paymentMaterialPendingOperation,
    signatureHash: "1".repeat(64), paymentPayloadHash: "2".repeat(64), paymentHeaderHash: "3".repeat(64),
    state: "authorized_not_sent", finalityClass: "pre_effect", terminal: false,
    reason: "x402_authorized_not_sent", proofClass: "x402_authorization_verified",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(paymentMaterialPendingOperation.transitions, authorized),
  });
  const paymentPendingOperation = resealOperation({
    ...paymentAuthorizedOperation,
    attempts: [{
      attemptNumber: "1", purpose: "payment", phase: "pending",
      requestHeaderHash: "3".repeat(64), persistedAt: missingResult.operation.updatedAt,
    }],
    state: "paid_request_pending", finalityClass: "unknown_finality", terminal: false,
    reason: "x402_paid_request_pending", proofClass: "x402_unknown_finality",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(paymentAuthorizedOperation.transitions, paid),
  });
  const recoveryPendingAttempt = {
    attemptNumber: "2",
    purpose: "result_recovery",
    phase: "pending",
    requestHeaderHash: sellerRecovery.paymentHeaderHash,
    persistedAt: missingResult.operation.updatedAt,
  } as const;
  const sellerRecoveryWithPendingAttempt = resealOperation({
    ...sellerRecovery,
    attempts: [paymentAttemptWithoutResult, recoveryPendingAttempt],
  });
  const recoveryAttempt = {
    ...observedAttempt,
    attemptNumber: "2",
    purpose: "result_recovery",
    observation: {
      ...observedAttempt.observation,
      attemptNumber: "2",
      purpose: "result_recovery",
    },
  };
  const recoveryResponse = { ...settlementResponseObservation, httpAttemptNumber: "2" };
  const recoveryObservedTransitions = appendX402Transition(sellerRecoveryTransitions, sellerRecoveryTransition);
  const { integrityHash: _completedReceiptIntegrity, ...recoveryCompletedReceiptBody } = completedReceipt;
  const recoveryCompletedReceipt = sealed("apn.x402.receipt.v1", {
    ...recoveryCompletedReceiptBody,
    previousLinkHash: recoveryObservedTransitions.at(-1)!.hash,
  });
  const recoveryObservedOperation = resealOperation({
    ...sellerRecoveryWithPendingAttempt,
    attempts: [paymentAttemptWithoutResult, recoveryAttempt],
    settlementResponseObservation: recoveryResponse,
    transactionHint: {
      transactionHash, source: "payment_response",
      sourceBindingHash: paymentResponseBindingHash(recoveryResponse.settlementResponseHash),
      observedAt: missingResult.operation.updatedAt,
    },
    transitions: recoveryObservedTransitions,
  });
  const recoveryResultLinkedOperation = resealOperation({
    ...recoveryObservedOperation,
    resultLink: { resultHash: missingResultHash, resultIntegrityHash: missingResultIntegrityHash },
  });
  const recoveredCompletion = resealOperation({
    ...recoveryResultLinkedOperation,
    receiptLink: { receiptIntegrityHash: recoveryCompletedReceipt.integrityHash },
    state: "completed", finalityClass: "terminal", terminal: true,
    reason: "x402_completed", proofClass: "x402_safe_settlement", nextActions: ["receipt.get"],
    transitions: appendX402Transition(recoveryObservedTransitions, completed),
  });
  assert.doesNotThrow(
    () => validateX402Operation(recoveredCompletion),
    "a successful cached-result response can complete with its response-derived hint",
  );
  await missingResult.store.writeX402Operation(paymentMaterialPendingOperation);
  await missingResult.store.writeX402Operation(paymentAuthorizedOperation);
  await missingResult.store.writeX402Operation(paymentPendingOperation);
  await missingResult.store.writeX402Operation(sellerRecovery);
  await missingResult.store.writeX402Operation(sellerRecoveryWithPendingAttempt);
  await assert.rejects(
    missingResult.store.writeX402Operation(resealOperation({
      ...recoveryObservedOperation,
      attempts: [paymentAttemptWithoutResult, {
        ...recoveryAttempt,
        observation: { ...recoveryAttempt.observation, paymentResponseHeaderHash: "f".repeat(64) },
      }],
    })),
    { code: "APN_STATE_CORRUPT" },
    "recovery observation must bind the exact success response header",
  );
  await assert.rejects(
    missingResult.store.writeX402Operation(resealOperation({
      ...recoveredCompletion,
      transitions: appendX402Transition(sellerRecoveryTransitions, completed),
    })),
    { code: "APN_STATE_CORRUPT" },
    "recovery cannot skip the nonterminal observation/result/receipt commit sequence",
  );
  await assert.doesNotReject(
    missingResult.store.writeX402Operation(recoveryObservedOperation),
    "scan-derived recovery first persists its observed response as a nonterminal self-transition",
  );
  const observedRecovery = await missingResult.store.loadX402Operation(
    missingResult.operation.profileHash,
    missingResult.operation.operationId,
  );
  assert.equal(observedRecovery?.state, "seller_result_recovery_pending");
  assert.equal(observedRecovery?.attempts[1]?.phase, "observed");
  assert.equal(observedRecovery?.resultLink, undefined);
  await missingResult.store.writeX402Result(missingResult.operation.profileHash, recoveredResult);
  await assert.rejects(
    missingResult.store.writeX402Operation(resealOperation({
      ...recoveryObservedOperation,
      resultLink: {
        resultHash: recoveredResult.resultHash,
        resultIntegrityHash: "f".repeat(64),
      },
    })),
    { code: "APN_STATE_CORRUPT" },
    "the nonterminal result link must bind the exact durable recovered result",
  );
  const restartedRecoveryStore = new StateStore(missingResult.root) as StateStore & {
    loadX402RecoveryResult(profileHash: string, operationId: string): Promise<Record<string, unknown> | null>;
    loadX402RecoveryReceipt(profileHash: string, operationId: string): Promise<Record<string, unknown> | null>;
  };
  await restartedRecoveryStore.initialize();
  assert.equal(await restartedRecoveryStore.loadX402Result(missingResult.operation.profileHash, missingResult.operation.operationId), null);
  assert.equal(await restartedRecoveryStore.loadX402Receipt(missingResult.operation.profileHash, missingResult.operation.operationId), null);
  assert.deepEqual(
    await restartedRecoveryStore.loadX402RecoveryResult(missingResult.operation.profileHash, missingResult.operation.operationId),
    recoveredResult,
  );
  await missingResult.store.writeX402Operation(recoveryResultLinkedOperation);
  assert.deepEqual(
    await missingResult.store.loadX402Result(missingResult.operation.profileHash, missingResult.operation.operationId),
    recoveredResult,
  );
  await missingResult.store.writeX402Receipt(missingResult.operation.profileHash, recoveryCompletedReceipt as never);
  assert.deepEqual(
    await restartedRecoveryStore.loadX402RecoveryReceipt(missingResult.operation.profileHash, missingResult.operation.operationId),
    recoveryCompletedReceipt,
  );
  assert.equal(await restartedRecoveryStore.loadX402Receipt(missingResult.operation.profileHash, missingResult.operation.operationId), null);
  await assert.doesNotReject(
    missingResult.store.writeX402Operation(recoveredCompletion),
    "the scan-derived four-write recovery sequence can complete only after result and receipt durability",
  );

  const responseRecovery = await setup("terminal-response-recovery");
  const responseMaterialPendingOperation = resealOperation({
    ...responseRecovery.operation,
    state: "authorization_material_pending", finalityClass: "pre_effect", terminal: false,
    reason: "x402_authorization_material_pending", proofClass: "x402_authorization_recovery",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(responseRecovery.operation.transitions, materialPending),
  });
  const responseAuthorizedOperation = resealOperation({
    ...responseMaterialPendingOperation,
    signatureHash: "1".repeat(64), paymentPayloadHash: "2".repeat(64), paymentHeaderHash: "3".repeat(64),
    state: "authorized_not_sent", finalityClass: "pre_effect", terminal: false,
    reason: "x402_authorized_not_sent", proofClass: "x402_authorization_verified",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(responseMaterialPendingOperation.transitions, authorized),
  });
  const responsePaidTransitions = appendX402Transition(responseAuthorizedOperation.transitions, paid);
  const responsePaymentPendingAttempt = {
    attemptNumber: "1", purpose: "payment", phase: "pending",
    requestHeaderHash: "3".repeat(64), persistedAt: responseRecovery.operation.updatedAt,
  } as const;
  const responsePaidPending = resealOperation({
    ...responseAuthorizedOperation,
    attempts: [responsePaymentPendingAttempt],
    state: "paid_request_pending", finalityClass: "unknown_finality", terminal: false,
    reason: "x402_paid_request_pending", proofClass: "x402_unknown_finality",
    nextActions: ["operation.resume", "operation.status"], transitions: responsePaidTransitions,
  });
  const responsePaymentObserved = {
    ...paymentAttemptWithoutResult,
    observation: {
      ...paymentAttemptWithoutResult.observation,
      targetHash: responseRecovery.operation.resource.urlHash,
      finalUrlHash: responseRecovery.operation.resource.urlHash,
      origin: responseRecovery.operation.resource.origin,
    },
  };
  const responseSettlementEvidenceBody = JSON.parse(JSON.stringify(settlementEvidence)) as Record<string, unknown>;
  delete responseSettlementEvidenceBody.evidenceHash;
  responseSettlementEvidenceBody.token = responseRecovery.operation.token;
  const responseAuthorizationUsed = responseSettlementEvidenceBody.authorizationUsed as Record<string, unknown>;
  responseAuthorizationUsed.authorizer = responseRecovery.operation.wallet;
  responseAuthorizationUsed.nonce = responseRecovery.operation.authorization.nonce;
  const responseTransfer = responseSettlementEvidenceBody.transfer as Record<string, unknown>;
  responseTransfer.from = responseRecovery.operation.wallet;
  responseTransfer.to = responseRecovery.operation.payee;
  responseTransfer.value = responseRecovery.operation.amountAtomic;
  const responseSettlementEvidence = {
    ...responseSettlementEvidenceBody,
    evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(responseSettlementEvidenceBody)),
  };
  const responseSellerTransitions = appendX402Transition(responsePaidTransitions, sellerRecoveryTransition);
  const responseSellerRecovery = resealOperation({
    ...responsePaidPending,
    attempts: [responsePaymentObserved],
    settlementResponseObservation,
    transactionHint: {
      transactionHash, source: "payment_response",
      sourceBindingHash: paymentResponseBindingHash(settlementResponseObservation.settlementResponseHash),
      observedAt: responseRecovery.operation.updatedAt,
    },
    settlementEvidence: responseSettlementEvidence,
    state: "seller_result_recovery_pending", finalityClass: "known_settled", terminal: false,
    reason: "x402_seller_result_recovery_pending", proofClass: "x402_settlement_verified_result_pending",
    nextActions: ["operation.resume", "operation.status"], transitions: responseSellerTransitions,
  });
  const responseRecoveryPending = resealOperation({
    ...responseSellerRecovery,
    attempts: [responsePaymentObserved, {
      ...recoveryPendingAttempt,
      requestHeaderHash: responseSellerRecovery.paymentHeaderHash,
      persistedAt: responseRecovery.operation.updatedAt,
    }],
  });
  const responseRecoveredResult = sealed("apn.x402.result.v1", {
    ...(() => { const { integrityHash: _integrity, ...body } = recoveredResult; return body; })(),
    operationId: responseRecovery.operation.operationId,
  });
  const responseRecoveryNormalizedCanonicalJson = canonicalJson({
    amount: responseRecovery.operation.amountAtomic,
    network: "eip155:8453",
    payer: responseRecovery.operation.wallet,
    success: true,
    transaction: transactionHash,
  });
  const responseRecoveryResponse = {
    ...recoveryResponse,
    normalizedCanonicalJson: responseRecoveryNormalizedCanonicalJson,
    paymentResponseHeaderHash: "d".repeat(64),
    settlementResponseHash: domainHash("apn.x402.settlement.v1", responseRecoveryNormalizedCanonicalJson),
  };
  const responseRecoveryObserved = {
    ...recoveryAttempt,
    requestHeaderHash: responseRecoveryPending.paymentHeaderHash,
    persistedAt: responseRecovery.operation.updatedAt,
    observation: {
      ...recoveryAttempt.observation,
      targetHash: responseRecovery.operation.resource.urlHash,
      paymentResponseHeaderHash: responseRecoveryResponse.paymentResponseHeaderHash,
      bodyHash: responseRecoveredResult.resultHash,
      bodyByteLength: responseRecoveredResult.byteLength,
      mediaType: responseRecoveredResult.mediaType,
      finalUrlHash: responseRecovery.operation.resource.urlHash,
      origin: responseRecovery.operation.resource.origin,
    },
  };
  const responseRecoveryObservedTransitions = appendX402Transition(responseSellerTransitions, sellerRecoveryTransition);
  const responseRecoveryReceipt = receiptFor(responseRecovery.operation, {
    terminalState: "completed", reason: "x402_completed", proofClass: "x402_safe_settlement",
    previousLinkHash: responseRecoveryObservedTransitions.at(-1)!.hash,
    settlementResponseHash: responseRecoveryResponse.settlementResponseHash,
    settlementEvidence: responseSettlementEvidence,
    result: {
      resultHash: responseRecoveredResult.resultHash, mediaType: responseRecoveredResult.mediaType,
      byteLength: responseRecoveredResult.byteLength, resultIntegrityHash: responseRecoveredResult.integrityHash,
    },
  });
  const responseRecoveryObservedOperation = resealOperation({
    ...responseRecoveryPending,
    attempts: [responsePaymentObserved, responseRecoveryObserved],
    settlementResponseObservation: responseRecoveryResponse,
    transactionHint: {
      transactionHash, source: "payment_response",
      sourceBindingHash: paymentResponseBindingHash(responseRecoveryResponse.settlementResponseHash),
      observedAt: responseRecovery.operation.updatedAt,
    },
    transitions: responseRecoveryObservedTransitions,
  });
  const responseRecoveryResultLinked = resealOperation({
    ...responseRecoveryObservedOperation,
    resultLink: { resultHash: responseRecoveredResult.resultHash, resultIntegrityHash: responseRecoveredResult.integrityHash },
  });
  const responseRecoveredCompletion = resealOperation({
    ...responseRecoveryResultLinked,
    receiptLink: { receiptIntegrityHash: responseRecoveryReceipt.integrityHash },
    state: "completed", finalityClass: "terminal", terminal: true,
    reason: "x402_completed", proofClass: "x402_safe_settlement", nextActions: ["receipt.get"],
    transitions: appendX402Transition(responseRecoveryObservedTransitions, completed),
  });
  await responseRecovery.store.writeX402Operation(responseMaterialPendingOperation);
  await responseRecovery.store.writeX402Operation(responseAuthorizedOperation);
  await responseRecovery.store.writeX402Operation(responsePaidPending);
  await responseRecovery.store.writeX402Operation(responseSellerRecovery);
  await responseRecovery.store.writeX402Operation(responseRecoveryPending);
  await assert.rejects(
    responseRecovery.store.writeX402Operation(responseRecoveredCompletion),
    { code: "APN_STATE_CORRUPT" },
    "response-derived recovery cannot skip its four-write commit sequence",
  );
  await assert.doesNotReject(
    responseRecovery.store.writeX402Operation(responseRecoveryObservedOperation),
    "response-derived recovery persists the new response hash and attempt number nonterminally",
  );
  await assert.rejects(
    responseRecovery.store.writeX402Operation(resealOperation({
      ...responseRecoveryObservedOperation,
      settlementResponseObservation,
      transactionHint: responseSellerRecovery.transactionHint,
    })),
    { code: "APN_STATE_CORRUPT" },
    "the persisted recovery response and hint cannot be rolled back or replaced",
  );
  await responseRecovery.store.writeX402Result(responseRecovery.operation.profileHash, responseRecoveredResult);
  await responseRecovery.store.writeX402Operation(responseRecoveryResultLinked);
  await responseRecovery.store.writeX402Receipt(responseRecovery.operation.profileHash, responseRecoveryReceipt as never);
  await assert.doesNotReject(
    responseRecovery.store.writeX402Operation(responseRecoveredCompletion),
    "response-derived recovery completes after exact result and receipt durability",
  );
  assert.throws(
    () => validateX402Operation(resealOperation({
      ...completedOperation,
      authorizationUsedScan: recoveryScan,
      transactionHint: scanHint,
    })),
    { code: "APN_STATE_CORRUPT" },
    "completed requires a payment-response hint rather than a log-only hint",
  );
  const { receiptLink: _terminalReceiptLink, ...withoutTerminalReceipt } = completedOperation;
  const unknownWithFinalEvidence = resealOperation({
    ...withoutTerminalReceipt,
    state: "effect_unknown", finalityClass: "unknown_finality", terminal: false,
    reason: "x402_effect_unknown", proofClass: "x402_unknown_finality",
    nextActions: ["operation.resume", "operation.status"], transitions: unknownWithEvidenceTransitions,
  });
  assert.throws(
    () => validateX402Operation(unknownWithFinalEvidence),
    { code: "APN_STATE_CORRUPT" },
    "effect_unknown cannot contain final settlement evidence",
  );
  const { transactionHint: _unknownHint, ...unknownWithoutHint } = unknownWithFinalEvidence;
  assert.throws(
    () => validateX402Operation(resealOperation(unknownWithoutHint)),
    { code: "APN_STATE_CORRUPT" },
    "settlement evidence requires a transaction hint",
  );
  const evidenceMutation = (patch: (value: Record<string, unknown>) => void): X402OperationRecord => {
    const value = JSON.parse(JSON.stringify(settlementEvidence)) as Record<string, unknown>;
    patch(value);
    delete value.evidenceHash;
    const resealedEvidence = { ...value, evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(value)) };
    return resealOperation({ ...completedOperation, settlementEvidence: resealedEvidence });
  };
  for (const [label, value] of [
    ["authorization-used-authorizer", evidenceMutation((evidence) => { (evidence.authorizationUsed as Record<string, unknown>).authorizer = OTHER_RECIPIENT.toLowerCase(); })],
    ["authorization-used-nonce", evidenceMutation((evidence) => { (evidence.authorizationUsed as Record<string, unknown>).nonce = `0x${"f".repeat(64)}`; })],
    ["transfer-from", evidenceMutation((evidence) => { (evidence.transfer as Record<string, unknown>).from = OTHER_RECIPIENT.toLowerCase(); })],
    ["transfer-to", evidenceMutation((evidence) => { (evidence.transfer as Record<string, unknown>).to = OTHER_RECIPIENT.toLowerCase(); })],
    ["transfer-value", evidenceMutation((evidence) => { (evidence.transfer as Record<string, unknown>).value = "9999999"; })],
    ["safe-tag-must-bind-safe-head", evidenceMutation((evidence) => { (evidence.authorizationState as Record<string, unknown>).blockTag = "safe"; })],
    ["equal-auth-safe-number-hash", evidenceMutation((evidence) => {
      const safeHead = evidence.safeHead as Record<string, unknown>;
      const authorizationState = evidence.authorizationState as Record<string, unknown>;
      authorizationState.blockNumber = safeHead.number;
      authorizationState.blockHash = `0x${"f".repeat(64)}`;
    })],
    ["equal-transaction-safe-number-hash", evidenceMutation((evidence) => {
      const transactionBlock = evidence.transactionBlock as Record<string, unknown>;
      const safeHead = evidence.safeHead as Record<string, unknown>;
      safeHead.number = transactionBlock.number;
      safeHead.hash = `0x${"f".repeat(64)}`;
    })],
  ] as const) {
    assert.throws(() => validateX402Operation(value), { code: "APN_STATE_CORRUPT" }, label);
  }

  const completedMutation = (patch: (value: Record<string, unknown>) => void): X402OperationRecord => {
    const value = JSON.parse(JSON.stringify(completedOperation)) as Record<string, unknown>;
    delete value.integrityHash;
    patch(value);
    return resealOperation(value);
  };
  const settlementMutation = (settlement: Record<string, unknown>): X402OperationRecord => completedMutation((value) => {
    const response = value.settlementResponseObservation as Record<string, unknown>;
    const normalized = canonicalJson(settlement);
    response.normalizedCanonicalJson = normalized;
    response.settlementResponseHash = domainHash("apn.x402.settlement.v1", normalized);
    const hint = value.transactionHint as Record<string, unknown>;
    hint.sourceBindingHash = paymentResponseBindingHash(String(response.settlementResponseHash));
    hint.transactionHash = settlement.transaction;
  });
  const responseGraphCases = [
    ["settlement-payer", settlementMutation({ network: "eip155:8453", payer: OTHER_RECIPIENT.toLowerCase(), success: true, transaction: transactionHash })],
    ["settlement-amount", settlementMutation({ amount: "9999999", network: "eip155:8453", success: true, transaction: transactionHash })],
    ["completed-non-success", settlementMutation({ errorReason: "settlement_pending", network: "eip155:8453", success: false, transaction: transactionHash })],
    ["attempt-status", completedMutation((value) => { (((value.attempts as unknown[])[0] as Record<string, unknown>).observation as Record<string, unknown>).status = "201"; })],
    ["attempt-header", completedMutation((value) => { (value.settlementResponseObservation as Record<string, unknown>).paymentResponseHeaderHash = "f".repeat(64); })],
    ["attempt-request-header", completedMutation((value) => { ((value.attempts as unknown[])[0] as Record<string, unknown>).requestHeaderHash = "f".repeat(64); })],
    ["attempt-target", completedMutation((value) => { (((value.attempts as unknown[])[0] as Record<string, unknown>).observation as Record<string, unknown>).targetHash = "f".repeat(64); })],
    ["attempt-final-url", completedMutation((value) => { (((value.attempts as unknown[])[0] as Record<string, unknown>).observation as Record<string, unknown>).finalUrlHash = "f".repeat(64); })],
    ["attempt-origin", completedMutation((value) => { (((value.attempts as unknown[])[0] as Record<string, unknown>).observation as Record<string, unknown>).origin = "https://other.example"; })],
    ["attempt-result-hash", completedMutation((value) => { (((value.attempts as unknown[])[0] as Record<string, unknown>).observation as Record<string, unknown>).bodyHash = "f".repeat(64); })],
    ["attempt-persisted-after-start", completedMutation((value) => { ((value.attempts as unknown[])[0] as Record<string, unknown>).persistedAt = "2026-08-26T00:00:00.001Z"; })],
  ] as const;
  for (const [label, value] of responseGraphCases) {
    assert.throws(() => validateX402Operation(value), { code: "APN_STATE_CORRUPT" }, label);
  }

  const recoveryWithPaymentId = completedMutation((value) => {
    const attemptValue = (value.attempts as unknown[])[0] as Record<string, unknown>;
    attemptValue.purpose = "result_recovery";
    (attemptValue.observation as Record<string, unknown>).purpose = "result_recovery";
  });
  const { paymentIdentifier: _removedPaymentIdentifier, ...recoveryWithoutPaymentIdBody } = recoveryWithPaymentId;
  const recoveryWithoutPaymentId = resealOperation({
    ...recoveryWithoutPaymentIdBody,
    fingerprint: x402Fingerprint(recoveryWithoutPaymentIdBody as unknown as X402OperationRecord),
  });
  assert.throws(() => validateX402Operation(recoveryWithoutPaymentId), { code: "APN_STATE_CORRUPT" }, "result recovery requires payment identifier");
  await assert.rejects(missingResult.store.writeX402Operation(completedOperation), { code: "APN_STATE_CORRUPT" });

  const expired = await setup("terminal-expired-binding");
  const expiryEvidenceBody = {
    schemaVersion: "apn.x402.unused-expiry-evidence.v1",
    network: "eip155:8453",
    chainId: "8453",
    token: expired.operation.token,
    validBefore: expired.operation.authorization.validBefore,
    finalizedHead: { number: "12500", hash: blockHash, timestamp: expired.operation.authorization.validBefore, observedAt: expired.operation.updatedAt },
    authorizationState: { value: false, blockNumber: "12500", blockHash, blockTag: "finalized", observedAt: expired.operation.updatedAt },
    absence: { localSettlement: false, httpSettlement: false, authorizationUsed: false, transactionReceipt: false },
    rpcOriginHash: sha256("https://rpc.example"),
  };
  const expiryEvidence = { ...expiryEvidenceBody, evidenceHash: domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(expiryEvidenceBody)) };
  const expiredScanBody = {
    schemaVersion: "apn.x402.authorization-used-scan.v1",
    searchStartBlock: expired.operation.preparedBlock.number,
    nextFromBlock: "12501",
    targetSafeHead: { number: "12500", hash: blockHash, observedAt: expired.operation.updatedAt },
    lastCompletedChunk: {
      fromBlock: expired.operation.preparedBlock.number,
      toBlock: "12500",
      toBlockHash: blockHash,
    },
    candidates: [],
    status: "complete",
    updatedAt: expired.operation.updatedAt,
  } as const;
  const expiredScan = {
    ...expiredScanBody,
    evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(expiredScanBody)),
  };
  const expiredTransition = {
    at: expired.operation.updatedAt, state: "failed_expired_unused" as const, terminal: true,
    reason: "x402_failed_expired_unused" as const, proofClass: "x402_expired_unused_finalized" as const,
  };
  const expiredTransitions = appendX402Transition(appendX402Transition(appendX402Transition(
    expired.operation.transitions, materialPending,
  ), authorized), expiredTransition);
  const expiredOperation = resealOperation({
    ...expired.operation,
    signatureHash: "1".repeat(64), paymentPayloadHash: "2".repeat(64), paymentHeaderHash: "3".repeat(64),
    authorizationUsedScan: expiredScan,
    unusedExpiryEvidence: expiryEvidence,
    receiptLink: { receiptIntegrityHash: "a".repeat(64) },
    state: "failed_expired_unused", finalityClass: "terminal", terminal: true,
    reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized", nextActions: ["receipt.get"], transitions: expiredTransitions,
  });
  assert.doesNotThrow(() => validateX402Operation(expiredOperation));
  const expiryMutation = (patch: (value: Record<string, unknown>) => void): X402OperationRecord => {
    const value = JSON.parse(JSON.stringify(expiryEvidence)) as Record<string, unknown>;
    delete value.evidenceHash;
    patch(value);
    return resealOperation({
      ...expiredOperation,
      unusedExpiryEvidence: { ...value, evidenceHash: domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(value)) },
    });
  };
  assert.throws(() => validateX402Operation(expiryMutation((value) => { value.validBefore = "1787702461"; })), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateX402Operation(expiryMutation((value) => { (value.authorizationState as Record<string, unknown>).blockNumber = "12499"; })), { code: "APN_STATE_CORRUPT" });

  const missingAfterCommit = await setup("terminal-status-missing");
  const receipt = receiptFor(missingAfterCommit.operation);
  await missingAfterCommit.store.writeX402Receipt(missingAfterCommit.operation.profileHash, receipt as never);
  const terminal = terminalFor(missingAfterCommit.operation, String(receipt.integrityHash));
  await missingAfterCommit.store.writeX402Operation(terminal);
  const restartedStatus = await makeCore({ root: missingAfterCommit.root }).execute({ command: "operation.status", operationId: terminal.operationId });
  assert.equal(restartedStatus.ok, true, "terminal previous-link verification survives restart");
  assert.equal(
    (await missingAfterCommit.store.loadX402Receipt(missingAfterCommit.operation.profileHash, terminal.operationId))?.previousLinkHash,
    terminal.transitions.at(-1)?.previousHash,
  );
  await unlink(join(
    missingAfterCommit.root,
    "x402-receipts",
    missingAfterCommit.operation.profileHash,
    `${missingAfterCommit.operation.operationId}.json`,
  ));
  const status = await makeCore({ root: missingAfterCommit.root }).execute({ command: "operation.status", operationId: terminal.operationId });
  assert.equal(status.error?.code, "APN_STATE_CORRUPT");
});

test("payment identifier required true or false freezes exact declaration/value and protected wire tamper fails closed", async (t) => {
  for (const required of [false, true]) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
    const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), http: challenge(mixedChallenge(required)) }).execute({
      ...PREPARE_REQUEST,
      idempotencyKey: `payment-id-${required ? "required" : "optional"}`,
    });
    const publicOperation = operationRecord(prepared);
    const operationId = String(publicOperation.operationId);
    const state = await readOperation(temporary.root, "default", operationId);
    assert.equal(state.paymentIdentifier?.value, `apn_${operationId}`);
    assert.deepEqual(JSON.parse(state.paymentIdentifier?.declarationCanonicalJson ?? "null"), paymentIdentifierDeclaration(required));
    assert.deepEqual(materializePaymentIdentifier(state.paymentIdentifier), {
      info: { required, id: `apn_${operationId}` },
      schema: paymentIdentifierDeclaration(required).schema,
    });

    if (!required) {
      const path = join(temporary.root, "x402-operations", state.profileHash, `${operationId}.json`);
      const tampered = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const selected = tampered.selectedOffer as Record<string, unknown>;
      selected.declaredCanonicalJson = canonicalJson({
        ...(JSON.parse(String(selected.declaredCanonicalJson)) as Record<string, unknown>),
        extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
      });
      await writeFile(path, JSON.stringify(tampered), { mode: 0o600 });
      const status = await makeCore({ root: temporary.root }).execute({ command: "operation.status", operationId });
      assert.equal(status.ok, false);
      assert.equal(status.error?.code, "APN_STATE_CORRUPT");
    }
  }
});

test("x402 list and global scans bind each record to its profile directory and exact filename", async (t) => {
  const renamedState = await temporaryState();
  t.after(renamedState.cleanup);
  await ensureWallet(makeCore({ root: renamedState.root, native: new TestNative() }));
  const prepared = await makeCore({ root: renamedState.root, rpc: new TestRpc(), http: challenge() }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "path-bind-rename",
  });
  const operationId = String(operationRecord(prepared).operationId);
  const store = new StateStore(renamedState.root);
  const profileHash = store.profileHash("default");
  const directory = join(renamedState.root, "x402-operations", profileHash);
  await rename(join(directory, `${operationId}.json`), join(directory, `${"e".repeat(64)}.json`));
  await assert.rejects(store.listX402Operations(profileHash), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(store.listAllX402Operations(), { code: "APN_STATE_CORRUPT" });

  const movedState = await temporaryState();
  t.after(movedState.cleanup);
  await ensureWallet(makeCore({ root: movedState.root, native: new TestNative() }));
  const movedPrepared = await makeCore({ root: movedState.root, rpc: new TestRpc(), http: challenge() }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "path-bind-move",
  });
  const movedId = String(operationRecord(movedPrepared).operationId);
  const movedStore = new StateStore(movedState.root);
  const sourceProfile = movedStore.profileHash("default");
  const targetProfile = movedStore.profileHash("other");
  const targetDirectory = join(movedState.root, "x402-operations", targetProfile);
  await mkdir(targetDirectory, { mode: 0o700 });
  await rename(
    join(movedState.root, "x402-operations", sourceProfile, `${movedId}.json`),
    join(targetDirectory, `${movedId}.json`),
  );
  await assert.rejects(movedStore.listX402Operations(targetProfile), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(movedStore.listAllX402Operations(), { code: "APN_STATE_CORRUPT" });
});

test("protected x402 state rejects unsafe identifiers, non-canonical bytes, impossible time, and invalid chronology", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  const prepared = await makeCore({ root: temporary.root, rpc: new TestRpc(), http: challenge() }).execute({
    ...PREPARE_REQUEST,
    idempotencyKey: "protected-byte-contract",
  });
  const operationId = String(operationRecord(prepared).operationId);
  const store = new StateStore(temporary.root);
  const profileHash = store.profileHash("default");
  const operation = await readOperation(temporary.root, "default", operationId);

  assert.throws(
    () => validateX402Operation(resealOperation({
      ...operation,
      selectedOffer: { ...operation.selectedOffer, index: "16" },
    })),
    { code: "APN_STATE_CORRUPT" },
  );
  assert.throws(
    () => validateX402Operation(resealOperation({
      ...operation,
      preparedBlock: { ...operation.preparedBlock, observedAt: "2026-02-30T00:00:00.000Z" },
    })),
    { code: "APN_STATE_CORRUPT" },
  );
  const retrograde = {
    at: "2026-08-25T23:59:59.000Z",
    state: "authorization_material_pending" as const,
    terminal: false,
    reason: "x402_authorization_material_pending" as const,
    proofClass: "x402_authorization_recovery" as const,
  };
  assert.throws(
    () => validateX402Operation(resealOperation({
      ...operation,
      state: retrograde.state,
      finalityClass: "pre_effect",
      reason: retrograde.reason,
      proofClass: retrograde.proofClass,
      nextActions: ["operation.resume", "operation.status"],
      updatedAt: retrograde.at,
      transitions: appendX402Transition(operation.transitions, retrograde),
    })),
    { code: "APN_STATE_CORRUPT" },
  );

  await assert.rejects(store.loadX402Operation("../outside", operationId), { code: "APN_STATE_SECURITY" });
  await assert.rejects(store.loadX402Operation(profileHash, "../../outside"), { code: "APN_STATE_SECURITY" });
  await assert.rejects(store.loadX402Result(profileHash, "not-a-hash"), { code: "APN_STATE_SECURITY" });
  await assert.rejects(store.loadX402Receipt("not-a-hash", operationId), { code: "APN_STATE_SECURITY" });

  const operationPath = join(temporary.root, "x402-operations", profileHash, `${operationId}.json`);
  const canonicalBytes = await readFile(operationPath);
  const parsed = JSON.parse(canonicalBytes.toString("utf8")) as Record<string, unknown>;
  await writeFile(operationPath, `${JSON.stringify(parsed, null, 2)}\n`);
  await assert.rejects(store.loadX402Operation(profileHash, operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(operationPath, canonicalBytes);
  const duplicateKey = canonicalBytes.toString("utf8").trim().replace(/^\{/u, '{"kind":"x402_fetch",');
  await writeFile(operationPath, `${duplicateKey}\n`);
  await assert.rejects(store.loadX402Operation(profileHash, operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(operationPath, canonicalBytes);
  await writeFile(operationPath, Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(store.loadX402Operation(profileHash, operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(operationPath, canonicalBytes);
  assert.equal((await store.loadX402Operation(profileHash, operationId))?.operationId, operationId);
});

test("generic operation status canonicalizes identifiers before any state-tree lookup", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  for (const operationId of ["", "a".repeat(63), "A".repeat(64), `../${"a".repeat(61)}`, `${"a".repeat(64)}/../wallet`]) {
    const result = await makeCore({ root: temporary.root }).execute({ command: "operation.status", operationId });
    assert.equal(result.error?.code, "APN_INVALID_INPUT", operationId);
  }
  await assert.rejects(access(temporary.root), /ENOENT/u, "invalid IDs must not initialize or traverse the state root");
});

test("CLI owns additive x402 prepare syntax and permits the profile policy to supply the ceiling", () => {
  assert.deepEqual(parseArgv([
    "x402", "fetch", "prepare",
    "--profile", "default",
    "--url", X402_URL,
    "--max-amount-atomic", "10000000",
    "--idempotency-key", "x402-payment-001",
    "--rpc-url", "https://rpc.example",
  ]), {
    request: PREPARE_REQUEST,
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(parseArgv([
    "x402", "fetch", "prepare",
    "--profile", "default",
    "--url", X402_URL,
    "--idempotency-key", "x402-payment-001",
    "--rpc-url", "https://rpc.example",
  ]), {
    request: {
      command: "x402.fetch.prepare",
      profile: "default",
      url: X402_URL,
      idempotencyKey: "x402-payment-001",
    },
    rpcUrl: "https://rpc.example",
  });
});
