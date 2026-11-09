import assert from "node:assert/strict";
import test from "node:test";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { StateStore } from "../../src/state.js";
import { SOLANA_USDC_MINT } from "../../src/swap/jupiter-solana/catalog.js";
import { JupiterV1OwnerAdmission } from "../../src/swap/jupiter-solana/v1-admission.js";
import { JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN as JUPITER_PIN } from "../../src/swap/jupiter-solana/v1-pins.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { createSwapQuote, type SwapQuoteInput } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, sealGuardedSwapApproval } from "../../src/swap/runtime.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { newUniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x5555555555555555555555555555555555555555";
const STRAY = "0x6666666666666666666666666666666666666666";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const H = (c: string) => c.repeat(64);
const NOW = new Date("2026-09-18T00:01:00.000Z");
const pinned = (error: any) => error?.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_recipient_not_admitted";
type Pins = { readonly source?: readonly string[]; readonly destination?: readonly string[] };
const pins = (value: readonly string[] | undefined) => value === undefined ? {} : { recipients: [...value] };

const pin: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "owner.sdk", constructorVersion: "1.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: [], quoteSchemaVersion: "1.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation", validationPolicyVersion: "1.0.0" };
const quoteInput: SwapQuoteInput = { profile: "pinned-swap", account: ACCOUNT, recipient: RECIPIENT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };

/** The guarded runtime every Uniswap ETH, Orca, SunSwap and Jupiter lane runs, with a driver that counts sends. */
function guardedSwap(root: string, recipients: Pins) {
  const inventory = loadAllowlistInventory(), overlay: AllowlistPolicyOverlayInput = { overlayVersion: "pinned-swap.1", profile: "pinned-swap",
    account: ACCOUNT, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin, ...pins(recipients.source) },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", mechanism: pin,
        ...pins(recipients.destination) },
    ] };
  const policy = compileAllowlistPolicyOverlay(overlay).registry, quote = createSwapQuote(structuredClone(quoteInput));
  const material = { quote, approvalCapAtomic: "0", gasOrEnergy: { gasLimit: "100000", maxFeePerGas: "2" }, execution: { unsigned: true } };
  const usage = new AssetUsageLedger(root), clock = { now: () => NOW };
  let runtime!: GuardedSwapRuntime<unknown>, sends = 0;
  runtime = new GuardedSwapRuntime({ chain: "eip155:1", clock, usage, operations: new SwapOperationRepository(root),
    builder: { async quote() { return { quoteHash: quote.quoteHash }; }, async load(hash) { return hash === quote.quoteHash ? material : null; } },
    policy: async () => policy, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "pinned-swap.1", pins: [pin] }),
    approvals: new GuardedSwapApprovalRepository(root), ownerAdmission: { async assert() { return undefined; } },
    foregroundApproval: { async approve(intent) { return sealGuardedSwapApproval(intent, clock.now(), H("f")); } },
    execution: { async execute(input) { sends++; const marked = await runtime.service.markSubmitting(input.operation, input.now);
      return await runtime.service.recordPossibleSend(marked, "unknown_finality", input.now); },
    async observe(input) { return input.operation; }, async proveUnlanded() { return null; } },
    rpc: {}, effectStore: {}, signer: {}, sender: {}, observer: {}, caps: { gasLimit: "100000" } });
  const spent = async () => (await usage.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "native", identifier: null } }, NOW)).amountAtomic;
  return { runtime, quote, sends: () => sends, spent };
}

test("guarded swap: a pin on either row that lacks the recipient refuses at prepare, with no hold or send", async (t) => {
  for (const recipients of [{ source: [OTHER] }, { destination: [OTHER] }, { source: [OTHER, RECIPIENT], destination: [OTHER] }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = guardedSwap(temporary.root, recipients);
    await assert.rejects(s.runtime.prepare({ profile: "pinned-swap", quoteHash: s.quote.quoteHash, idempotencyKey: "pinned-swap-0001" }, NOW),
      pinned, JSON.stringify(recipients));
    assert.equal(s.sends(), 0); assert.equal(await s.spent(), "0");
  }
});

test("guarded swap: pins listing the recipient admit prepare, both consent checks, the reservation and the one send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = guardedSwap(temporary.root, { source: [OTHER, RECIPIENT], destination: [RECIPIENT] });
  const prepared = await s.runtime.prepare({ profile: "pinned-swap", quoteHash: s.quote.quoteHash, idempotencyKey: "pinned-swap-0002" }, NOW);
  assert.equal((await s.runtime.approve(prepared.operationId, NOW)).state, "reserved");
  assert.equal((await s.runtime.execute(prepared.operationId, NOW)).state, "unknown_finality");
  assert.equal(s.sends(), 1); assert.equal(await s.spent(), "100");
});

test("Uniswap token swap: both rows' pins bind the recipient at quote, prepare, reservation and before each signature", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const activate = async (recipients: Pins) => (await activateDirectPolicy(temporary.root, "token-swap", { accounts: { evm: ACCOUNT }, now: NOW,
    admissions: [[UNISWAP_USDC, recipients.source], [ETHEREUM_USDT, recipients.destination]].map(([identifier, list]) => ({ chain: "eip155:1",
      kind: "token" as const, identifier: identifier as string, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1500000",
      mechanism: UNISWAP_TOKEN_MECHANISM_PIN, ...pins(list as readonly string[] | undefined) })) })).policyDigest;
  const ledger = new AssetUsageLedger(temporary.root), usage = new UniswapTokenUsage(new StateStore(temporary.root), { now: () => NOW }, ledger);
  const request = { command: "swap.uniswap-token.quote" as const, profile: "token-swap", account: ACCOUNT, recipient: RECIPIENT,
    sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000", approvalCapAtomic: "1000000",
    deadline: 1_900_000_000, maxApprovalGasLimit: "100000", maxSwapGasLimit: "100000", maxCleanupGasLimit: "100000", maxFeePerGas: "2",
    maxPriorityFeePerGas: "1", maxNativeDebitWei: "600000" };
  const operation = (policyDigest: string, id: string, recipient = RECIPIENT) => {
    const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
    return newUniswapTokenOperation({ operationId: id.repeat(64), profile: "token-swap", account: ACCOUNT,
      route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient, amountIn: "1000000",
        amountOutMinimum: "990000", deadline: 1_900_000_000 }), approvalCapAtomic: "1000000", allowanceAtPrepare: "0", approvalGas: gas,
      swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000", policyDigest,
      mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: NOW });
  };
  await activate({ source: [OTHER] });
  await assert.rejects(usage.admitQuote(request, NOW), pinned);
  await activate({ destination: [OTHER] });
  await assert.rejects(usage.admitQuote(request, NOW), pinned);

  const digest = await activate({ source: [RECIPIENT, OTHER], destination: [RECIPIENT] });
  assert.equal(await usage.admitQuote(request, NOW), digest);
  const op = operation(digest, "a"), stray = operation(digest, "b", STRAY);
  await usage.confirmMaterial({ profile: "token-swap", account: ACCOUNT, route: op.route, policyDigest: digest } as never);
  await assert.rejects(usage.confirmMaterial({ profile: "token-swap", account: ACCOUNT, route: stray.route, policyDigest: digest } as never), pinned);
  await assert.rejects(usage.reserve(stray), pinned);
  await usage.reserve(op); await usage.confirmReserved(op);
  await assert.rejects(usage.confirmReserved({ ...op, route: stray.route }), pinned);
  assert.equal((await ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic,
    "1000000");
});

test("Jupiter pays only the owned payer, and a swap row pin without the payer refuses its owner admission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const profile = "jupiter-pins", payer = "675kPX9MHTjS2zt1qfr1NYHuzeLsM4vQKhBXmaQ5aqUJ", other = "So11111111111111111111111111111111111111112";
  const store = new ChainAccountStore(temporary.root, { async load() { return Buffer.alloc(32, 77); }, async create() { return Buffer.alloc(32, 77); } });
  await store.ensureLocal({ profile, rail: "solana", create: async () => ({ address: payer, seed: Buffer.alloc(32, 9) }) });
  const registry = (recipients: readonly string[]) => {
    const now = new Date(), row = { direct: false, gasless: false, x402: false, bridge: false, swap: true };
    return sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "jupiter-pins.1", publishedAt: now.toISOString(),
      effectiveDate: now.toISOString().slice(0, 10), effectiveAt: new Date(now.getTime() - 1000).toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(), chains: [{ chain: JUPITER_PIN.chain, family: "solana", name: "Solana", assets: [
        { kind: "native", identifier: null, symbol: "SOL", decimals: 9, rails: row, caps: { maximumPerTransferAtomic: "6000000", dailyLimitAtomic: "6000000" },
          mechanismPins: { swap: JUPITER_PIN }, recipients: { swap: [...recipients] } },
        { kind: "token", identifier: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6, rails: row,
          caps: { maximumPerTransferAtomic: "500000", dailyLimitAtomic: "500000" }, mechanismPins: { swap: JUPITER_PIN } }] }] });
  };
  let current = registry([other]);
  const admission = new JupiterV1OwnerAdmission(store, async () => ({ profile, registry: current, digest: current.policyDigest, revision: 1,
    accounts: { solana: payer }, activationDigest: "a".repeat(64), activatedAt: current.effectiveAt! }), new AssetUsageLedger(temporary.root), () => new Date());
  await assert.rejects(admission.resolveRoute(profile, "1000000", "115960", payer), pinned);
  current = registry([other, payer]);
  assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).owner.policyDigest, current.policyDigest);
});
