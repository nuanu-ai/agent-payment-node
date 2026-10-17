import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { allowlistProfileHash, compileAllowlistPolicyOverlay } from "../../src/allowlist-policy-overlay.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { canonicalJson, domainHash, hashObject, sha256 } from "../../src/canonical.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { usdtExecutionIntent } from "../../src/gasless-usdt/execution-journal.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { CircleV2ApprovalExecutor, type CircleApprovalRpc } from "../../src/lifi/circle-v2-approval-executor.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { OneClickSourceJournal } from "../../src/lifi/near-oneclick-source-journal.js";
import { NonEvmSourceJournalRepository } from "../../src/lifi/non-evm-source-journal.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { createSwapQuote } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../../src/swap/runtime.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";
import { temporaryState } from "./helpers.js";
import { v2Fixture } from "./gasless-usdt-v2-fixture.js";

/**
 * Records of the nine families phase 4b WP2 registered, each written by that family's own code (Stargate: as its
 * prepare wrote it, tests/fixtures/operation-commands). The generic commands read them through the real CLI path, which
 * builds the family's own runtime; no fixture needs a network read for the answers the registry table expects.
 */
export interface FamilyRecord { readonly root: string; readonly id: string }
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64);
const unreached = (name: string) => async () => { throw new Error(`${name} must not be reached`); };

/** The generic commands read and never unwrap a key: any secret request fails the test. */
export class NoSecret implements WrappingSecretPort {
  async load(): Promise<Buffer> { throw new Error("a generic operation command must not load the wrapping secret"); }
  async create(): Promise<Buffer> { throw new Error("a generic operation command must not create the wrapping secret"); }
}

async function root(t: TestContext): Promise<string> {
  const temporary = await temporaryState(); t.after(temporary.cleanup); await new StateStore(temporary.root).initialize(); return temporary.root;
}

/** A guarded Uniswap swap on Ethereum, prepared and never marked (its prepare reads no RPC). */
async function swap(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), now = new Date(Math.floor(Date.now() / 1000) * 1000), at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
    chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
    routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: [], quoteSchemaVersion: "1.0.0",
    transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
  const inventory = loadAllowlistInventory(), policy = compileAllowlistPolicyOverlay({ overlayVersion: "generic.1", profile: "default",
    account: ACCOUNT.address, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: at(-60_000), expiresAt: at(300_000), admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin },
      { chain: "eip155:1", kind: "token", identifier: UNISWAP_USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin }] }).registry;
  const quote = createSwapQuote({ profile: "default", account: ACCOUNT.address, recipient: ACCOUNT.address,
    sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: UNISWAP_USDC },
    inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100, effectiveAt: at(-60_000), expiresAt: at(300_000),
    providerResponseHash: H("a"), routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"),
      success: true, blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } });
  const material = { quote, approvalCapAtomic: "0", gasOrEnergy: { gasLimit: "100000", maxFeePerGas: "2" }, execution: {} };
  const runtime = new GuardedSwapRuntime({ chain: "eip155:1", builder: { quote: unreached("quote"), load: async () => material },
    policy: async () => policy, clock: { now: () => now }, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "generic.1", pins: [pin] }),
    usage: new AssetUsageLedger(state), operations: new SwapOperationRepository(state), approvals: new GuardedSwapApprovalRepository(state),
    ownerAdmission: { assert: unreached("owner") }, foregroundApproval: { approve: unreached("approval") },
    execution: { execute: unreached("execute"), observe: unreached("observe"), proveUnlanded: unreached("prove") },
    rpc: {}, effectStore: {}, signer: {}, sender: {}, observer: {}, caps: { gasLimit: "100000" } } as never);
  const prepared = await runtime.prepare({ profile: "default", quoteHash: quote.quoteHash, idempotencyKey: "generic-commands-swap" }, now);
  return { root: state, id: prepared.operationId };
}

async function uniswapToken(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  const route = createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: ACCOUNT.address,
    amountIn: "1000000", amountOutMinimum: "990000", deadline: Math.floor(Date.now() / 1000) + 600 });
  const operation = await new UniswapTokenJournal(state).save(newUniswapTokenOperation({ operationId: H("a"), profile: "token-swap",
    account: ACCOUNT.address, route, approvalCapAtomic: "1000000", allowanceAtPrepare: "0", approvalGas: gas, swapGas: gas, cleanupGas: gas,
    maximumNativeDebitWei: "600000", policyDigest: domainHash("p", "p"), mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: new Date() }));
  return { root: state, id: operation.operationId };
}

/** A prepared Stargate journal exactly as `prepareStargateV2*` wrote it (golden). */
async function stargate(t: TestContext, name: "stargate-native" | "stargate-token"): Promise<FamilyRecord> {
  const state = await root(t), text = await readFile(join("tests", "fixtures", "operation-commands", `${name}.json`), "utf8");
  const id = (JSON.parse(text) as { operationId: string }).operationId, directory = join(state, name === "stargate-native" ? "stargate-v2-native" : "stargate-v2-token");
  await mkdir(directory, { mode: 0o700 }); await writeFile(join(directory, `${id}.json`), text, { mode: 0o600 });
  return { root: state, id };
}

/** A gasless USDT execution that closed before any effect, beside its bound preparation. */
async function gaslessUsdt(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), f = v2Fixture("expected"), profileHash = allowlistProfileHash("owner");
  const bound = await new UsdtBoundOperationRepository(state).create(profileHash, await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor },
    f.request), "generic-commands-usdt", f.now());
  const at = f.now().toISOString(), body = { schemaVersion: "apn.gasless-usdt-execution.v1", ...usdtExecutionIntent(bound), reservationId: H("e"),
    state: "failed_before_effect", userOperationHash: null, createdAt: at, updatedAt: at };
  await mkdir(join(state, "gasless-usdt-executions"), { mode: 0o700 });
  await writeFile(join(state, "gasless-usdt-executions", `${bound.operationId}.json`), `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`,
    { mode: 0o600 });
  return { root: state, id: bound.operationId };
}

/** A gasless USDT preparation that never executed (not indexed: it holds nothing). */
export async function unexecutedUsdt(t: TestContext): Promise<FamilyRecord & { readonly profileHash: string }> {
  const state = await root(t), f = v2Fixture("expected"), profileHash = allowlistProfileHash("owner");
  const bound = await new UsdtBoundOperationRepository(state).create(profileHash, await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor },
    f.request), "generic-commands-unexecuted", f.now());
  return { root: state, id: bound.operationId, profileHash };
}

/** A NEAR 1Click Base deposit whose source transaction reverted at a safe block: its status answers from the journal. */
async function oneClick(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), deposit = "0x76b4c56085ED136a8744D52bE956396624a730E8", token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const data = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [deposit, 3000000n] });
  const journal = new OneClickSourceJournal(state), deadline = new Date(Date.now() + 120_000).toISOString();
  let record = await journal.stage({ lane: "base-usdc-to-tron-usdt", operationId: H("a"), profileHash: H("b"), payer: ACCOUNT.address,
    recipient: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", refundTo: ACCOUNT.address, depositAddress: deposit, quoteHash: H("c"),
    quoteRequestDeadline: deadline, quoteDeadline: deadline, effectiveDeadline: deadline, amountInAtomic: "3000000", minAmountOutAtomic: "1251525",
    quotedAmountOutAtomic: "1264167", sourceBlockHash: `0x${H("d")}`, sourceCall: { to: token, data, value: "0", nonce: "7", gas: "100000",
      maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000", maxNativeDebitWei: "200000000000000" } });
  record = await journal.advance(record.operationId, record.integrityHash, "signing_started");
  const raw = await ACCOUNT.signTransaction({ type: "eip1559", chainId: 8453, to: token, data, value: 0n, nonce: 7, gas: 100000n,
    maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, accessList: [] });
  record = await journal.advance(record.operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
  record = await journal.advance(record.operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
  record = await journal.advance(record.operationId, record.integrityHash, "unknown_finality");
  record = await journal.advance(record.operationId, record.integrityHash, "source_observed", { sourceReceiptStatus: "reverted", sourceReceiptHash: H("f") });
  return { root: state, id: record.operationId };
}

/** A CCTP Base to Solana source burn staged for execution (no status command of its own: the generic status shows it). */
async function circleSource(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), data = "0xc62fa55e" as const, owner = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
  const journal = await new NonEvmSourceJournalRepository(state).stageLiveCircle({ profileHash: H("a"), operationId: H("b"),
    draftIntegrityHash: H("c"), route: "base_usdc_to_solana_usdc_circle_cctp_v2", createdAt: new Date().toISOString(), maxSourceNativeDebitWei: "1000000000000000",
    sourceCall: { chainId: 8453, from: ACCOUNT.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data,
      dataSha256: sha256(Buffer.from(data.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
      maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
    admissionProof: { kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com", rpcOrigin: "https://base.example.org",
      quoteHash: H("d"), validationHash: H("d"), sourceBlockHash: `0x${H("9")}`, preparationDigest: H("8"), payer: ACCOUNT.address,
      recipientOwner: owner, recipientAta: owner, feeTotalAtomic: "20000" },
    protocolInputHash: H("1") });
  return { root: state, id: journal.operationId };
}

/** A prepared Circle Base USDC allowance (its preparation reads come from a fixed RPC). */
async function circleApproval(t: TestContext): Promise<FamilyRecord> {
  const state = await root(t), store = new StateStore(state);
  const rpc: CircleApprovalRpc = { chainId: 8453, origin: "https://base.example.org", send: unreached("send"), observe: unreached("observe"), unlanded: unreached("unlanded"),
    read: async () => ({ chainId: 8453, payer: ACCOUNT.address, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", blockNumber: "12345", blockHash: `0x${H("a")}`, latestNonceAtomic: "7",
      pendingNonceAtomic: "7", usdcBalanceAtomic: "434611", usdcAllowanceAtomic: "0", nativeBalanceWei: "200000000000000", gasLimitAtomic: "100000",
      maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", totalNativeDebitWei: "200000000000000" }) };
  const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000",
    maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
  const saved = await new CircleV2ApprovalExecutor(store, rpc, { sign: unreached("sign") } as never, limits).prepare({ profile: "approval-alias",
    payer: ACCOUNT.address, walletBindingHash: "binding", walletCreatedAt: "2026-01-01T00:00:00.000Z", approvalCapAtomic: "430000" });
  return { root: state, id: saved.id };
}

/** A MetaMask native transfer a released version wrote in this state (legacy corpus). */
export async function metaMaskNative(t: TestContext, name: string, state: string): Promise<FamilyRecord> {
  const stateRoot = await root(t), directory = join(stateRoot, "metamask-native-operations");
  await installLegacyCase(join("tests", "fixtures", "legacy-corpus", name), stateRoot);
  for (const file of await readdir(directory)) {
    if ((JSON.parse(await readFile(join(directory, file), "utf8")) as { state: string }).state === state) return { root: stateRoot, id: file.slice(0, 64) };
  }
  throw new Error(`${name} holds no ${state} native transfer`);
}

export const WP2_FAMILY_RECORDS = {
  swap, uniswap_token: uniswapToken, stargate_native: (t: TestContext) => stargate(t, "stargate-native"),
  stargate_token: (t: TestContext) => stargate(t, "stargate-token"), gasless_usdt: gaslessUsdt, oneclick_source: oneClick,
  circle_source: circleSource, circle_approval: circleApproval,
  metamask_native: (t: TestContext) => metaMaskNative(t, "45-v0543-metamask-native-driver-resolver-late", "failed_before_effect"),
} as const;
