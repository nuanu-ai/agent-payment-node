import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { UNISWAP_CHAIN, UNISWAP_MECHANISM_PIN, UNISWAP_ROUTER, UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { decodeUniswapRouterCalldata } from "../../src/swap/uniswap-router.js";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { temporaryState } from "./helpers.js";
import { EncryptedUniswapExecutionEffectStore, LocalUniswapEthereumSigner, UniswapBalanceEvidenceStore,
  UniswapEthereumReceiptObserver, UniswapSingleSendAdapter, createUniswapApprovalRequest, createUniswapExecutionBinding,
  newUniswapExecutionEffect, validateEffect, validateFreshness, verifySignedUniswapTransaction,
  type UniswapExecutionBinding, type UniswapExecutionEffect, type UniswapExecutionFreshness,
  type UniswapOwnerAdmission } from "../../src/swap/uniswap-ethereum/execution/index.js";

const KEY = `0x${"0".repeat(63)}1` as const, ACCOUNT = privateKeyToAccount(KEY).address;
const RECIPIENT = "0x2222222222222222222222222222222222222222", WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const H = (c: string) => c.repeat(64), deadline = 1_790_000_600, inputAmount = "1000000000000000", expectedOutput = "2000000", minimumOutput = "1980000";
const now = new Date((deadline - 300) * 1000), executeAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

function calldata(minimum = minimumOutput) {
  const path = `0x${WETH.slice(2)}000bb8${UNISWAP_USDC.slice(2)}` as `0x${string}`;
  const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], ["0x0000000000000000000000000000000000000002", BigInt(inputAmount)]);
  const swap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
    { type: "uint256[]" }], [RECIPIENT, BigInt(inputAmount), BigInt(minimum), path, false, []]);
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: ["0x0b00", [wrap, swap], BigInt(deadline)] });
}
function envelope() { return { from: ACCOUNT, to: UNISWAP_ROUTER, data: calldata(), value: inputAmount, gasLimit: "150000", chainId: 1,
  maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" } as const; }
function fresh(patch: Partial<UniswapExecutionFreshness> = {}): UniswapExecutionFreshness { return { chainId: 1, account: ACCOUNT,
  nonce: "7", gasLimit: "150000", maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000",
  simulationBlockNumber: "100", simulationBlockHash: `0x${H("d")}`, headBlockNumber: "101", headBlockHash: `0x${H("e")}`,
  checkedAt: now.toISOString(), ...patch }; }

class MemoryWrapping implements WrappingSecretPort {
  readonly value = Buffer.alloc(32, 7);
  async load() { return Buffer.from(this.value); }
  async create() { return Buffer.from(this.value); }
}

async function fixture(root: string) {
  const state = new StateStore(root); await state.initialize(); const wrapping = new MemoryWrapping();
  const walletStore = new EncryptedWalletStore(state, wrapping); const identity = await walletStore.importNew("uniswap-exec", KEY, ACCOUNT);
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "uniswap-exec.1", profile: "uniswap-exec",
    account: ACCOUNT, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(deadline * 1000).toISOString(), admissions: [
      { chain: UNISWAP_CHAIN, kind: "native", rail: "swap", maximumPerTransferAtomic: inputAmount, dailyLimitAtomic: inputAmount, mechanism: UNISWAP_MECHANISM_PIN },
      { chain: UNISWAP_CHAIN, kind: "token", identifier: UNISWAP_USDC, rail: "swap", maximumPerTransferAtomic: expectedOutput,
        dailyLimitAtomic: expectedOutput, mechanism: UNISWAP_MECHANISM_PIN },
    ] };
  const compiled = compileAllowlistPolicyOverlay(overlay).registry;
  const policy = sealAssetPolicyRegistry({ schemaVersion: compiled.schemaVersion, registryVersion: compiled.registryVersion,
    publishedAt: compiled.publishedAt, effectiveDate: compiled.effectiveDate,
    ...(compiled.effectiveAt === undefined ? {} : { effectiveAt: compiled.effectiveAt }),
    ...(compiled.expiresAt === undefined ? {} : { expiresAt: compiled.expiresAt }),
    chains: compiled.chains.map(chain => ({ ...chain, assets: chain.assets.map(asset =>
      ({ ...asset, rails: { ...asset.rails, direct: true } })) })) });
  const protocols = compileSwapProtocolRegistry({ registryVersion: "uniswap-exec.1", pins: [UNISWAP_MECHANISM_PIN] });
  const e = envelope(), route = decodeUniswapRouterCalldata(e.data, { recipient: RECIPIENT, inputAmountAtomic: inputAmount,
    minimumOutputAtomic: minimumOutput, deadline });
  const quote = { profile: "uniswap-exec", account: ACCOUNT, recipient: RECIPIENT,
    sourceAsset: { chain: UNISWAP_CHAIN, kind: "native", identifier: null }, destinationAsset: { chain: UNISWAP_CHAIN, kind: "token", identifier: UNISWAP_USDC },
    inputAmountAtomic: inputAmount, expectedOutputAtomic: expectedOutput, minimumOutputAtomic: minimumOutput, slippageBps: 100,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(deadline * 1000).toISOString(), providerResponseHash: H("a"),
    routeHash: route.routeHash, unsignedTransactionPayloadHash: sha256(canonicalJson(e)), simulation: { requestHash: H("b"), resultHash: H("c"), success: true,
      blockNumber: "100", blockHash: `0x${H("d")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } } as const;
  const operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root), core = new GuardedSwapService(operations, usage);
  const operation = await core.prepare({ quote, assetPolicy: policy, protocolRegistry: protocols, idempotencyKey: "uniswap-execution-0001",
    approvalCapAtomic: "0", now });
  const admission: UniswapOwnerAdmission = { profile: identity.profile, profileHash: operation.ownerProfileHash, account: identity.address,
    walletBindingHash: identity.bindingHash, walletCreatedAt: identity.createdAt,
    admissionHash: domainHash("test.uniswap-admission.v1", canonicalJson({ identity, operationId: operation.operationId })) };
  return { state, wrapping, policy, protocols, operations, usage, core, operation, admission, e };
}

async function marked(f: Awaited<ReturnType<typeof fixture>>) {
  const reserved = await f.core.reserve(f.operation, f.policy, now);
  const operation = await f.core.markSubmitting(reserved, now), approval = createUniswapApprovalRequest(f.operation, f.e, fresh(), now);
  const binding = createUniswapExecutionBinding({ operation, envelope: f.e, freshness: fresh(), admission: f.admission, approvalHash: approval.approvalHash });
  return { operation, binding };
}

test("exact binding rejects envelope, nonce, gas, fee, deadline and signed sender drift", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  for (const drift of [{ gasLimit: "150001" }, { maxFeePerGas: "2000000001" }, { maxPriorityFeePerGas: "100000001" },
    { checkedAt: new Date(deadline * 1000).toISOString() }]) assert.throws(() => validateFreshness(f.operation, f.e, fresh(drift), now), { code: "APN_OPERATION_BLOCKED" });
  const exact = await privateKeyToAccount(KEY).signTransaction({ type: "eip1559", chainId: 1, to: f.e.to, data: f.e.data, value: BigInt(f.e.value),
    nonce: 7, gas: 150000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  assert.match(await verifySignedUniswapTransaction(exact, m.binding, m.operation), /^0x[a-f0-9]{64}$/u);
  for (const patch of [{ nonce: 8 }, { gas: 150001n }, { maxFeePerGas: 2000000001n }]) {
    const raw = await privateKeyToAccount(KEY).signTransaction({ type: "eip1559", chainId: 1, to: f.e.to, data: f.e.data, value: BigInt(f.e.value),
      nonce: 7, gas: 150000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [], ...patch });
    await assert.rejects(verifySignedUniswapTransaction(raw, m.binding, m.operation), { code: "APN_OPERATION_BLOCKED" });
  }
  const other = privateKeyToAccount(`0x${"0".repeat(62)}02` as const), wrongSender = await other.signTransaction({ type: "eip1559", chainId: 1,
    to: f.e.to, data: f.e.data, value: BigInt(f.e.value), nonce: 7, gas: 150000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  await assert.rejects(verifySignedUniswapTransaction(wrongSender, m.binding, m.operation), { code: "APN_OPERATION_BLOCKED" });
});

test("execution boundaries reject excess, prototype, uint, stale-head, stale-time and path-substitution input", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  assert.throws(() => createUniswapApprovalRequest(f.operation, { ...f.e, extra: true } as any, fresh(), now));
  const inherited = Object.create(f.e) as typeof f.e;
  assert.throws(() => createUniswapApprovalRequest(f.operation, inherited, fresh(), now), { code: "APN_INVALID_INPUT" });
  for (const drift of [
    { nonce: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString() },
    { headBlockNumber: "200" },
    { headBlockHash: `0x${H("A")}` },
    { checkedAt: new Date(now.getTime() - 30_001).toISOString() },
    { maxPriorityFeePerGas: "2000000001" },
  ]) assert.throws(() => validateFreshness(f.operation, f.e, fresh(drift as any), now));
  const effects = new EncryptedUniswapExecutionEffectStore(f.state, f.wrapping);
  await assert.rejects(effects.load({ ...m.operation, ownerProfileHash: H("9") } as any, m.binding), { code: "APN_STATE_CORRUPT" });
});

test("encrypted signer/effect survives restart, authenticates tamper, and never journals raw or private material", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  const effects = new EncryptedUniswapExecutionEffectStore(f.state, f.wrapping), signer = new LocalUniswapEthereumSigner(f.state, f.wrapping, effects);
  const effect = await signer.sign(m.operation, m.binding, f.admission, now); assert.equal(effect.phase, "sealed");
  await assert.rejects(validateEffect({ ...effect, unexpected: true }, m.operation, m.binding), { code: "APN_STATE_CORRUPT" });
  const inherited = Object.create(effect) as UniswapExecutionEffect;
  await assert.rejects(validateEffect(inherited, m.operation, m.binding), { code: "APN_STATE_CORRUPT" });
  const restarted = new EncryptedUniswapExecutionEffectStore(new StateStore(temporary.root), f.wrapping);
  assert.equal((await restarted.load(m.operation, m.binding))?.transactionHash, effect.transactionHash);
  const path = join(temporary.root, "uniswap-execution-effects", m.operation.ownerProfileHash, `${m.operation.operationId}.json`);
  const text = await readFile(path, "utf8"); assert.equal(text.includes(effect.rawTransaction), false); assert.equal(text.includes(KEY), false);
  const envelopeFile = JSON.parse(text); envelopeFile.cipher.ciphertext = `${envelopeFile.cipher.ciphertext.slice(0, -4)}AAAA`;
  await writeFile(path, `${JSON.stringify(envelopeFile)}\n`);
  await assert.rejects(restarted.load(m.operation, m.binding), { code: "APN_STATE_CORRUPT" });
});

test("concurrent send calls cross exactly one durable send boundary", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  const effects = new EncryptedUniswapExecutionEffectStore(f.state, f.wrapping), signer = new LocalUniswapEthereumSigner(f.state, f.wrapping, effects);
  const effect = await signer.sign(m.operation, m.binding, f.admission, now); let sends = 0;
  const sender = new UniswapSingleSendAdapter(effects, async () => { sends++; await new Promise(resolve => setImmediate(resolve)); return effect.transactionHash; });
  const outcomes = await Promise.allSettled([sender.sendOnce(m.operation, m.binding, now), sender.sendOnce(m.operation, m.binding, now)]);
  assert.equal(sends, 1); assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === "rejected").length, 1);
  assert.equal((await effects.load(m.operation, m.binding))?.phase, "send_accepted");
});

test("marker is durable before signing and sending; lost send response becomes possible-send and can never resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  assert.equal(m.operation.state, "submitting"); assert.ok(m.operation.submissionMarker);
  const effects = new EncryptedUniswapExecutionEffectStore(f.state, f.wrapping), signer = new LocalUniswapEthereumSigner(f.state, f.wrapping, effects);
  const effect = await signer.sign(m.operation, m.binding, f.admission, now); let sends = 0;
  const sender = new UniswapSingleSendAdapter(effects, async method => { assert.equal(method, "eth_sendRawTransaction"); sends++; throw new Error("lost response"); });
  assert.deepEqual(await sender.sendOnce(m.operation, m.binding, now), { kind: "possible_send", transactionHash: effect.transactionHash });
  assert.equal(sends, 1); await assert.rejects(sender.sendOnce(m.operation, m.binding, now), { code: "APN_OPERATION_BLOCKED" }); assert.equal(sends, 1);
  const loaded = await new EncryptedUniswapExecutionEffectStore(new StateStore(temporary.root), f.wrapping).load(m.operation, m.binding);
  assert.equal(loaded?.phase, "send_ambiguous"); assert.equal(loaded?.sendAttempts, 1);
});

test("observer requires marker and proves exact finalized receipt, reorg, finality, logs and balance output", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  const raw = await privateKeyToAccount(KEY).signTransaction({ type: "eip1559", chainId: 1, to: f.e.to, data: f.e.data, value: BigInt(f.e.value),
    nonce: 7, gas: 150000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  const hash = await verifySignedUniswapTransaction(raw, m.binding, m.operation), blockHash = `0x${H("e")}` as const;
  const recipientTopic = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}`, transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const options = { finalized: 110, blockHash, output: BigInt(minimumOutput), nonce: "0x7", removed: false };
  const rpc = (override: Partial<typeof options> = {}) => { const o = { ...options, ...override }; return async (method: string, params: readonly unknown[]) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionByHash") return { hash, from: ACCOUNT, to: UNISWAP_ROUTER, input: f.e.data,
      value: `0x${BigInt(inputAmount).toString(16)}`, chainId: "0x1", nonce: o.nonce, gas: "0x249f0", type: "0x2",
      maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x5f5e100", blockNumber: "0x64", blockHash };
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, from: ACCOUNT, to: UNISWAP_ROUTER,
      status: "0x1", blockNumber: "0x64", blockHash,
      logs: [{ address: UNISWAP_USDC, transactionHash: hash, blockNumber: "0x64", blockHash, removed: o.removed,
        topics: [transfer, `0x${H("0")}`, recipientTopic], data: `0x${o.output.toString(16).padStart(64, "0")}` }] };
    if (method === "eth_getBlockByNumber") { const tag = params[0]; if (tag === "safe") return { number: "0x6f", hash: `0x${H("f")}` };
      if (tag === "finalized") return { number: `0x${o.finalized.toString(16)}`, hash: `0x${H("a")}` };
      if (tag === "0x6f") return { number: "0x6f", hash: `0x${H("f")}` };
      if (tag === `0x${o.finalized.toString(16)}`) return { number: `0x${o.finalized.toString(16)}`, hash: `0x${H("a")}` };
      return { number: "0x64", hash: o.blockHash }; }
    if (method === "eth_getBalance") return params[1] === "0x63" ? "0x38d7ea4c68000" : "0x0";
    if (method === "eth_call") return params[1] === "0x63" ? `0x${"0".repeat(64)}` : `0x${o.output.toString(16).padStart(64, "0")}`;
    throw new Error(method);
  }; };
  const observer = new UniswapEthereumReceiptObserver(rpc(), () => new Date((deadline - 200) * 1000));
  assert.equal((await observer.observe(m.operation, m.binding, hash))?.finalized, true);
  assert.equal(await new UniswapEthereumReceiptObserver(rpc({ finalized: 99 })).observe(m.operation, m.binding, hash), null);
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ blockHash: `0x${H("9")}` })).observe(m.operation, m.binding, hash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ output: 1n })).observe(m.operation, m.binding, hash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ nonce: "0x8" })).observe(m.operation, m.binding, hash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ removed: true })).observe(m.operation, m.binding, hash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(observer.observe({ ...f.operation, submissionMarker: null } as any, m.binding, hash));
});

test("observer keeps balance evidence from first sight, so a status after the node pruned that state still finalizes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const f = await fixture(temporary.root), m = await marked(f);
  const raw = await privateKeyToAccount(KEY).signTransaction({ type: "eip1559", chainId: 1, to: f.e.to, data: f.e.data, value: BigInt(f.e.value),
    nonce: 7, gas: 150000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  const hash = await verifySignedUniswapTransaction(raw, m.binding, m.operation);
  const recipientTopic = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}`, transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const output = BigInt(minimumOutput);
  let stateReads = 0;
  const rpc = (o: { finalized: number; blockHash: `0x${string}`; pruned: boolean }) => async (method: string, params: readonly unknown[]) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionByHash") return { hash, from: ACCOUNT, to: UNISWAP_ROUTER, input: f.e.data,
      value: `0x${BigInt(inputAmount).toString(16)}`, chainId: "0x1", nonce: "0x7", gas: "0x249f0", type: "0x2",
      maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x5f5e100", blockNumber: "0x64", blockHash: o.blockHash };
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, from: ACCOUNT, to: UNISWAP_ROUTER, status: "0x1",
      blockNumber: "0x64", blockHash: o.blockHash, logs: [{ address: UNISWAP_USDC, transactionHash: hash, blockNumber: "0x64", blockHash: o.blockHash,
        removed: false, topics: [transfer, `0x${H("0")}`, recipientTopic], data: `0x${output.toString(16).padStart(64, "0")}` }] };
    if (method === "eth_getBlockByNumber") { const tag = params[0];
      if (tag === "safe" || tag === "finalized" || tag === `0x${o.finalized.toString(16)}`) return { number: `0x${o.finalized.toString(16)}`, hash: `0x${H("a")}` };
      return { number: "0x64", hash: o.blockHash }; }
    if (method === "eth_getBalance" || method === "eth_call") {
      stateReads++;
      if (o.pruned) throw new Error("Archive requests require a personal token");
      if (method === "eth_getBalance") return params[1] === "0x63" ? "0x38d7ea4c68000" : "0x0";
      return params[1] === "0x63" ? `0x${"0".repeat(64)}` : `0x${output.toString(16).padStart(64, "0")}`;
    }
    throw new Error(method);
  };
  const clock = () => new Date((deadline - 200) * 1000), store = new UniswapBalanceEvidenceStore(temporary.root);
  const blockE = `0x${H("e")}` as const, block9 = `0x${H("9")}` as const;
  // First sight, not yet final: balances around block 100 are read once and kept.
  assert.equal(await new UniswapEthereumReceiptObserver(rpc({ finalized: 99, blockHash: blockE, pruned: false }), clock, store)
    .observeOutcome(m.operation, m.binding, hash), null);
  const kept = await store.load(m.operation);
  assert.equal(kept?.blockHash, blockE); assert.equal(kept?.beforeNative, "1000000000000000"); assert.equal(kept?.afterOutput, minimumOutput);
  // Finality observed after the node pruned that state: no state read, the kept evidence proves the swap.
  stateReads = 0;
  const late = await new UniswapEthereumReceiptObserver(rpc({ finalized: 110, blockHash: blockE, pruned: true }), clock, store)
    .observeOutcome(m.operation, m.binding, hash);
  assert.equal(late?.outcome, "succeeded"); assert.equal(stateReads, 0);
  // Without kept evidence the failure is named instead of silently staying submitted.
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ finalized: 110, blockHash: blockE, pruned: true }), clock)
    .observeOutcome(m.operation, m.binding, hash), { code: "APN_PROVIDER_UNAVAILABLE", message: /archive-capable APN_ETHEREUM_RPC_URL/u });
  // After a reorg the kept evidence names another block, so it is read again and replaced.
  await assert.rejects(new UniswapEthereumReceiptObserver(rpc({ finalized: 110, blockHash: block9, pruned: true }), clock, store)
    .observeOutcome(m.operation, m.binding, hash), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal((await new UniswapEthereumReceiptObserver(rpc({ finalized: 110, blockHash: block9, pruned: false }), clock, store)
    .observeOutcome(m.operation, m.binding, hash))?.outcome, "succeeded");
  assert.equal((await store.load(m.operation))?.blockHash, block9);
  // Kept evidence is sealed: an edited balance is refused as corrupt state.
  const file = join(temporary.root, "uniswap-balance-evidence", m.operation.ownerProfileHash, `${m.operation.operationId}.json`);
  const edited = JSON.parse(await readFile(file, "utf8")); edited.afterOutput = "99999999"; await writeFile(file, JSON.stringify(edited));
  await assert.rejects(store.load(m.operation), { code: "APN_STATE_CORRUPT" });
});
