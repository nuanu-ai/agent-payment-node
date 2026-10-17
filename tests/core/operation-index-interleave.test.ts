import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { compileAllowlistPolicyOverlay } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { CircleV2ApprovalExecutor, loadCircleApproval, type CircleApprovalRpc } from "../../src/lifi/circle-v2-approval-executor.js";
import { CircleV2SourceService } from "../../src/lifi/circle-v2-source-service.js";
import { OneClickSourceService } from "../../src/lifi/near-oneclick-source-service.js";
import { prepareStargateV2NativeEth, FileStargateNativeJournal } from "../../src/stargate-v2/native-execution.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { createSwapQuote } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../../src/swap/runtime.js";
import { preparedSwapOperationId } from "../../src/swap/service.js";
import { UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { InstalledUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime.js";
import { canonicalJson, domainHash, hashObject, sha256 } from "../../src/canonical.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
import { oneClickOperationId } from "../../src/lifi/near-oneclick-source-service.js";
import { ensureDirectWallet, evmCore, EVM_REQUEST } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

/**
 * Phase 4b WP2: exclusion on one chain and account holds across families in both orders, through the real prepare code.
 * A direct EVM prepare (the facade path) parked inside its first RPC read already holds its claim, so every other family's
 * prepare is refused before its own first read; and a new family's prepare parked inside its first read (or, for the
 * Circle approval, admitted before its write) refuses the direct prepare before any RPC read.
 */
const H = (c: string) => c.repeat(64);
interface Gate { readonly reached: Promise<void>; release(error?: Error): void; readonly calls: () => number }
/** Replaces one async method: its first call parks until released (then throws the given error, or continues). */
function park<T extends object>(target: T, key: keyof T): Gate {
  const original = target[key] as unknown as (...args: unknown[]) => Promise<unknown>;
  let reached!: () => void, release!: (error?: Error) => void, calls = 0;
  const atGate = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<Error | undefined>(resolve => { release = resolve; });
  (target as Record<keyof T, unknown>)[key] = async function (this: unknown, ...args: unknown[]) {
    calls += 1;
    if (calls === 1) { reached(); const error = await gate; if (error !== undefined) throw error; }
    return await original.apply(this, args);
  };
  return { reached: atGate, release, calls: () => calls };
}
const unreached = (name: string) => async () => { throw new Error(`${name} must not be reached`); };
const describeWallet = EncryptedWalletStore.prototype.describe;
const restoreWallet = () => { EncryptedWalletStore.prototype.describe = describeWallet; };

async function directSetup(t: test.TestContext, chainId: 1 | 8453) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId;
  // Ethereum quotes carry no L1 data or operator fee.
  if (chainId === 1) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  const wallet = await ensureDirectWallet(setup), account = wallet.address;
  const prepare = async (key = "interleave-direct") => await setup.core.execute({ ...EVM_REQUEST, asset: { chainId, token: "native" as const }, idempotencyKey: key });
  const blockedBy = (operationId: string, blockingState: string) => ({ code: "APN_OPERATION_BLOCKED", message: "Another money operation for this network and account is not terminal.",
    details: { blockingOperationId: operationId, blockingState, blockingNetwork: `evm:${chainId}`, blockingAccount: account.toLowerCase() } });
  return { root: temporary.root, setup, account, directId: setup.state.operationId("default", "interleave-direct"), prepare, blockedBy };
}
type DirectSetup = Awaited<ReturnType<typeof directSetup>>;
interface Family {
  /** Starts the family's prepare; `parked` is its first external read, inside its admission. */
  start(): { readonly done: Promise<unknown>; readonly parked: Gate };
  readonly operationId: string;
}

/** Both orders, each on a fresh state root, for a family whose prepare is admitted before its first external read. */
async function bothOrders(t: test.TestContext, chainId: 1 | 8453, family: (d: DirectSetup) => Promise<Family>): Promise<void> {
  {
    // The direct prepare holds the account inside its first RPC read: the family is refused before it reads anything.
    const d = await directSetup(t, chainId), f = await family(d), read = park(d.setup.rpc.evm, "balance"), direct = d.prepare();
    await read.reached;
    const first = f.start();
    await assert.rejects(first.done, d.blockedBy(d.directId, "admitted"));
    assert.equal(first.parked.calls(), 0, "the refused family read nothing");
    read.release();
    const completed = await direct; assert.equal(completed.ok, true, JSON.stringify(completed.error));
    // The direct record holds it from then on.
    const again = f.start();
    await assert.rejects(again.done, d.blockedBy(d.directId, "awaiting_approval"));
    assert.equal(again.parked.calls(), 0);
  }
  {
    // The family holds the account inside its first read: the direct prepare is refused before any RPC read.
    const d = await directSetup(t, chainId), f = await family(d), second = f.start();
    await second.parked.reached;
    const balanceCalls = d.setup.rpc.genericBalanceCalls, refused = await d.prepare();
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.error?.details, d.blockedBy(f.operationId, "admitted").details);
    assert.equal(d.setup.rpc.genericBalanceCalls, balanceCalls, "the refused direct prepare read nothing");
    second.parked.release(new Error("read failed"));
    await assert.rejects(second.done, /read failed/u);
    // The failed prepare wrote no record, so its claim is gone at once.
    assert.equal((await d.prepare()).ok, true);
  }
}

test("direct EVM and Stargate native exclude each other on Ethereum in both orders, before either reads", async (t) => {
  await bothOrders(t, 1, async (d) => {
    const request = { profile: "default", owner: d.account, recipient: d.account, amountAtomic: "1000000000000000",
      maxNativeDebitAtomic: "10000000000000000", idempotencyKey: "stargate-native-0001" };
    const operationId = hashObject({ family: "stargate_v2_native", profileHash: hashObject({ profile: "default" }),
      idempotencyHash: hashObject({ idempotencyKey: request.idempotencyKey }) });
    return { operationId, start: () => {
      const ports = { signer: { kind: "imported_evm_signer", address: d.account, signTransaction: unreached("signer") }, sourceCall: unreached("sourceCall") };
      const parked = park(ports, "sourceCall");
      return { parked, done: prepareStargateV2NativeEth(request, ports as never, new FileStargateNativeJournal(d.root, d.setup.state)) };
    } };
  });
});

test("direct EVM and a Uniswap token swap exclude each other on Ethereum in both orders, before either reads", async (t) => {
  await bothOrders(t, 1, async (d) => {
    const quoteHash = H("a"), key = "uniswap-token-0001";
    const material = { profile: "default", account: d.account, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN),
      route: { deadline: Math.floor(Date.now() / 1000) + 600 } };
    const operationId = domainHash("apn.uniswap-token-operation-id.v1", canonicalJson({ profile: "default", quoteHash, idempotencyKey: key }));
    return { operationId, start: () => {
      const ports = { now: () => new Date(), confirm: unreached("confirm") }, parked = park(ports, "confirm");
      const runtime = new InstalledUniswapTokenRuntime({} as never, { load: async () => material } as never, new UniswapTokenJournal(d.root), ports as never);
      return { parked, done: runtime.prepare({ command: "swap.uniswap-token.prepare", profile: "default", quoteHash, idempotencyKey: key }) };
    } };
  });
});

test("direct EVM and a NEAR 1Click Base source exclude each other in both orders, before the wallet, quote or any read", async (t) => {
  await bothOrders(t, 8453, async (d) => {
    const service = new OneClickSourceService(d.setup.state, d.setup.wrapping, { APN_BASE_RPC_URL: "https://base.example.org" });
    const input = { lane: "base-usdc-to-tron-usdt", profile: "default", expectedPayer: d.account, recipient: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      amountAtomic: "1000000", minOutputAtomic: "990000", maxQuotedLossAtomic: "10000", maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
      maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", idempotencyKey: "oneclick-base-0001" };
    const operationId = oneClickOperationId(oneClickLane(input.lane), d.setup.state.profileHash("default"), input.idempotencyKey);
    // The wallet read is the first step inside the admission; the quote and every RPC read come after it.
    return { operationId, start: () => {
      const parked = park(EncryptedWalletStore.prototype, "describe");
      return { parked, done: service.submit(input).finally(restoreWallet) };
    } };
  });
});

test("direct EVM and a CCTP Base source burn exclude each other in both orders, before the wallet, quote or any read", async (t) => {
  await bothOrders(t, 8453, async (d) => {
    const service = new CircleV2SourceService(d.setup.state, d.setup.wrapping, { APN_BASE_RPC_URL: "https://base.example.org" });
    const input = { profile: "default", expectedPayer: d.account, amountAtomic: "1000000", maxSourceFeeAtomic: "1000", idempotencyKey: "cctp-source-0001",
      recipientOwner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", recipientSetup: "existing_ata", maxAllowanceAtomic: "1000000",
      maxGasLimitAtomic: "300000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "1000000000000000" };
    const operationId = sha256(`circle-v2-base-source\0${d.setup.state.profileHash("default")}\0${input.idempotencyKey}`);
    return { operationId, start: () => {
      const parked = park(EncryptedWalletStore.prototype, "describe");
      return { parked, done: service.submit(input as never).finally(restoreWallet) };
    } };
  });
});

/** A guarded Uniswap swap on Ethereum for the direct wallet, with every effect port refusing (prepare reads none). */
function guardedSwap(d: DirectSetup) {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000), at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
    chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
    routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: [], quoteSchemaVersion: "1.0.0",
    transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
  const inventory = loadAllowlistInventory(), policy = compileAllowlistPolicyOverlay({ overlayVersion: "interleave.1", profile: "default", account: d.account,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: at(-60_000), expiresAt: at(300_000), admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin }] }).registry;
  const quote = createSwapQuote({ profile: "default", account: d.account, recipient: d.account,
    sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
    inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100, effectiveAt: at(-60_000), expiresAt: at(300_000),
    providerResponseHash: H("a"), routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"),
      success: true, blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } });
  const material = { quote, approvalCapAtomic: "0", gasOrEnergy: { gasLimit: "100000", maxFeePerGas: "2" }, execution: {} };
  const runtime = new GuardedSwapRuntime({ chain: "eip155:1", builder: { quote: unreached("quote"), load: async () => material },
    policy: async () => policy, clock: { now: () => now }, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "interleave.1", pins: [pin] }),
    usage: new AssetUsageLedger(d.root), operations: new SwapOperationRepository(d.root), approvals: new GuardedSwapApprovalRepository(d.root),
    ownerAdmission: { assert: unreached("owner") }, foregroundApproval: { approve: unreached("approval") },
    execution: { execute: unreached("execute"), observe: unreached("observe"), proveUnlanded: unreached("prove") },
    rpc: {}, effectStore: {}, signer: {}, sender: {}, observer: {}, caps: { gasLimit: "100000" } });
  return async (key: string) => await runtime.prepare({ profile: "default", quoteHash: quote.quoteHash, idempotencyKey: key }, now);
}

test("direct EVM and a guarded swap exclude each other on Ethereum in both orders; the swap record holds its account", async (t) => {
  {
    const d = await directSetup(t, 1), swap = guardedSwap(d), read = park(d.setup.rpc.evm, "balance"), direct = d.prepare();
    await read.reached;
    await assert.rejects(swap("guarded-swap-0001"), d.blockedBy(d.directId, "admitted"));
    read.release();
    const completed = await direct; assert.equal(completed.ok, true, JSON.stringify(completed.error));
    await assert.rejects(swap("guarded-swap-0001"), d.blockedBy(d.directId, "awaiting_approval"));
  }
  {
    const d = await directSetup(t, 1), swap = guardedSwap(d), prepared = await swap("guarded-swap-0001");
    assert.equal(prepared.operationId, preparedSwapOperationId("default", "guarded-swap-0001"));
    const refused = await d.prepare();
    assert.deepEqual(refused.error?.details, d.blockedBy(prepared.operationId, "awaiting_approval").details);
    assert.equal(d.setup.rpc.genericBalanceCalls, 0, "the refused direct prepare read nothing");
    // A replay of the swap key returns its record unchanged.
    assert.equal((await swap("guarded-swap-0001")).integrityHash, prepared.integrityHash);
  }
});

/** A Circle approval for the direct wallet's account under an alias profile (its own profile lock), reading through `rpc`. */
function circleApproval(d: DirectSetup) {
  const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", reads = { count: 0 };
  const rpc: CircleApprovalRpc = { chainId: 8453, origin: "https://base.example.org", send: unreached("send"), observe: unreached("observe"),
    unlanded: unreached("unlanded"), read: async () => { reads.count += 1; return { chainId: 8453, payer: d.account, token, spender, blockNumber: "12345", blockHash: `0x${H("a")}`,
      latestNonceAtomic: "7", pendingNonceAtomic: "7", usdcBalanceAtomic: "434611", usdcAllowanceAtomic: "0", nativeBalanceWei: "200000000000000",
      gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", totalNativeDebitWei: "200000000000000" }; } };
  const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
  const prepare = async () => await new CircleV2ApprovalExecutor(d.setup.state, rpc, { sign: unreached("sign") }, limits).prepare({
    profile: "approval-alias", payer: d.account, walletBindingHash: "binding", walletCreatedAt: "2026-01-01T00:00:00.000Z", approvalCapAtomic: "430000" });
  return { rpc, reads, prepare };
}

test("a Circle approval checks before its reads and is admitted before its write: the later of two prepares is refused", async (t) => {
  {
    // A direct prepare inside its first read holds the account: the approval is refused before it reads anything.
    const d = await directSetup(t, 8453), c = circleApproval(d), read = park(d.setup.rpc.evm, "balance"), direct = d.prepare();
    await read.reached;
    await assert.rejects(c.prepare(), d.blockedBy(d.directId, "admitted"));
    read.release();
    const completed = await direct; assert.equal(completed.ok, true, JSON.stringify(completed.error));
    await assert.rejects(c.prepare(), d.blockedBy(d.directId, "awaiting_approval"));
    assert.equal(c.reads.count, 0);
  }
  {
    // An approval still reading (its ID is the digest of those reads) loses to a direct prepare admitted meanwhile.
    const d = await directSetup(t, 8453), c = circleApproval(d), gate = park(c.rpc, "read"), approval = c.prepare();
    await gate.reached;
    assert.equal((await d.prepare()).ok, true);
    gate.release();
    await assert.rejects(approval, d.blockedBy(d.directId, "awaiting_approval"));
    assert.deepEqual(await readdir(join(d.root, "circle-approvals")).catch(() => []), [], "nothing was saved");
  }
  {
    // A saved approval holds the account: the direct prepare is refused before any RPC read.
    const d = await directSetup(t, 8453), c = circleApproval(d), saved = await c.prepare();
    assert.equal((await loadCircleApproval(d.root, saved.id))?.phase, "prepared");
    const refused = await d.prepare();
    assert.deepEqual(refused.error?.details, d.blockedBy(saved.id, "prepared").details);
    assert.equal(d.setup.rpc.genericBalanceCalls, 0);
  }
});
