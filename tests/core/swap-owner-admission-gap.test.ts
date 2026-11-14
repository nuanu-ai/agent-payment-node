import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { encodeFunctionResult, parseAbi } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { compileAllowlistPolicyOverlayV2 } from "../../src/allowlist-policy-v2.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { StateStore } from "../../src/state.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, type SwapMechanismPin } from "../../src/swap/pin.js";
import { createSwapQuote, type SwapQuoteInput } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { createOrcaKeylessRuntime, orcaRuntimeSelector } from "../../src/swap/orca-solana/runtime-factory.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT } from "../../src/swap/orca-solana/pins.js";
import { KeylessUniswapQuoteBuilder } from "../../src/swap/uniswap-v3/builder.js";
import { SavedUniswapQuoteStore } from "../../src/swap/uniswap-v3/material.js";
import { createUniswapKeylessRuntime, REFUSING_SWAP_APPROVAL } from "../../src/swap/uniswap-v3/runtime-factory.js";
import { ETHEREUM_USDT, ETHEREUM_WBTC, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_WBTC_WETH_3000,
  UNISWAP_WBTC_CODE_PINS } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { orcaOwner, PROFILE as ORCA_PROFILE } from "./orca-solana-helpers.js";
import { FakeOrcaTokenRpc, POOL as ORCA_USDC_USDT, USDC_IN } from "./orca-usdc-usdt-helpers.js";
import { ACCOUNT as KEYLESS_ACCOUNT, KeylessRpc, MemoryWrapping, PROFILE as KEYLESS_PROFILE, keylessPolicy } from "./uniswap-keyless-helpers.js";

// QA F05: an active owner policy that does not admit one of the two swap assets refused APN_OPERATION_BLOCKED without
// details.reason, while no policy at all refused with the documented swap_owner_admission_required.

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TRON = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", TRON_OWNER = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV";
const H = (c: string) => c.repeat(64), inventory = loadAllowlistInventory(), PROFILE = "gap-swap", NOW = new Date("2026-09-18T00:01:00.000Z");
const lane: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "apn.sdk", constructorVersion: "2.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"],
  quoteSchemaVersion: "2.0.0", transactionSchemaVersion: "2.0.0", validationPolicyIdentity: "apn.validation", validationPolicyVersion: "2.0.0" };
const otherPool: SwapMechanismPin = { ...lane, auxiliaryContractProgramIdentities: ["0x3333333333333333333333333333333333333333"] };
const quote: SwapQuoteInput = { profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };
const native = (extra: object = {}) => ({ chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100",
  mechanism: lane, ...extra });
const usdc = (extra: object = {}) => ({ chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100",
  dailyLimitAtomic: "100", mechanism: lane, ...extra });

function policy(admissions: readonly object[]) {
  return compileAllowlistPolicyOverlay({ overlayVersion: "gap-swap.1", profile: PROFILE, account: ACCOUNT, datasetVersion: inventory.dataset.version,
    datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256, effectiveAt: "2026-09-18T00:00:00.000Z",
    expiresAt: "2026-09-19T00:00:00.000Z", admissions } as unknown as AllowlistPolicyOverlayInput).registry;
}
async function prepare(root: string, assetPolicy: unknown, key: string) {
  const service = new GuardedSwapService(new SwapOperationRepository(root), new AssetUsageLedger(root));
  const { schemaVersion: _s, profileHash: _p, quoteHash: _q, ...input } = createSwapQuote(structuredClone(quote));
  return await service.prepare({ quote: input, assetPolicy, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "gap.1", pins: [lane] }),
    idempotencyKey: key, approvalCapAtomic: "0", now: NOW });
}
/** The documented refusal, naming the asset, what the policy lacks and two runnable owner commands. */
function admissionGap(side: string, chain: string, asset: string, gap: string, profile: string, inventoryCommand: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApnError, String(error)); assert.equal(error.code, "APN_OPERATION_BLOCKED");
    assert.deepEqual(error.details, { reason: "swap_owner_admission_required", side, chain, asset, admissionGap: gap,
      nextActions: [`apn allowlist policy status --profile ${profile}`, inventoryCommand] });
    for (const command of error.details!.nextActions as readonly string[]) assert.ok(bindArgv(command.split(" ").slice(1)).request.command, command);
    return true;
  };
}

test("every missing admission of one swap asset refuses with swap_owner_admission_required and names the gap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const inventoryCommand = "apn swap ethereum uniswap inventory";
  await assert.rejects(prepare(temporary.root, policy([native()]), "gap-swap-0001"),
    admissionGap("destination", "eip155:1", USDC, "asset_not_listed", PROFILE, inventoryCommand));
  const usdcDirect = { chain: "eip155:1", kind: "token", identifier: USDC, rail: "direct", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100" };
  await assert.rejects(prepare(temporary.root, policy([native(), usdcDirect]), "gap-swap-0002"),
    admissionGap("destination", "eip155:1", USDC, "swap_rail_not_admitted", PROFILE, inventoryCommand));
  await assert.rejects(prepare(temporary.root, policy([usdc()]), "gap-swap-0003"),
    admissionGap("source", "eip155:1", "native", "asset_not_listed", PROFILE, inventoryCommand));
  const tronOnly = compileAllowlistPolicyOverlayV2({ overlayVersion: "gap-tron.1", profile: PROFILE, accounts: { tron: TRON_OWNER },
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z", admissions: [
      { chain: TRON, kind: "native", rail: "direct", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100" }] }).registry;
  await assert.rejects(prepare(temporary.root, tronOnly, "gap-swap-0004"),
    admissionGap("source", "eip155:1", "native", "network_not_listed", PROFILE, inventoryCommand));
  // The route refusal keeps its first sentence and now names the asset as well.
  await assert.rejects(prepare(temporary.root, policy([native(), usdc({ mechanism: otherPool })]), "gap-swap-0005"),
    (error: unknown) => admissionGap("destination", "eip155:1", USDC, "swap_route_not_admitted", PROFILE, inventoryCommand)(error) &&
      /^Destination asset lacks the same exact swap mechanism admission\. /u.test((error as Error).message));
  await assert.rejects(prepare(temporary.root, policy([native({ mechanism: otherPool }), usdc()]), "gap-swap-0006"),
    (error: unknown) => admissionGap("source", "eip155:1", "native", "swap_route_not_admitted", PROFILE, inventoryCommand)(error) &&
      /^Source asset lacks the exact swap mechanism admission\. /u.test((error as Error).message));
  // Nothing was written by any refusal.
  await assert.rejects(lstat(temporary.root), { code: "ENOENT" });
});

test("a refusal that is not a missing admission keeps its exact earlier shape", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await assert.rejects(prepare(temporary.root, policy([native({ maximumPerTransferAtomic: "99" }), usdc()]), "gap-swap-0007"), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" && error.message === "The transfer exceeds the asset policy per-transfer cap." &&
      error.details === undefined);
  const admitted = await prepare(temporary.root, policy([native(), usdc()]), "gap-swap-0008");
  assert.equal(admitted.state, "awaiting_approval");
});

const POOL_ABI = parseAbi(["function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)", "function liquidity() view returns(uint128)"]);
/** The keyless reader with the WBTC/WETH pool, as the WBTC lane tests serve it. */
function wbtcRpc() {
  const base = new KeylessRpc(); base.quoted = 1209n;
  return async (method: string, params: readonly unknown[]) => {
    const tx = params[0] as { readonly to?: string; readonly data?: string };
    if (method === "eth_call" && tx.to === UNISWAP_V3_WBTC_WETH_3000) return String(tx.data).startsWith("0x3850c7bd")
      ? encodeFunctionResult({ abi: POOL_ABI, functionName: "slot0", result: [45493679810323368769151825411638984n, 265000, 1, 2, 2, 0, true] })
      : encodeFunctionResult({ abi: POOL_ABI, functionName: "liquidity", result: 1000000000000000000n });
    return await base.call(method, params);
  };
}
async function mcpCall(options: Parameters<typeof createMcpServer>[0], name: string, args: Record<string, unknown>): Promise<OutputEnvelope> {
  const server = createMcpServer(options), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-swap-admission-gap", version: "1.0.0" }); await client.connect(clientTransport);
  try {
    const content = (await client.callTool({ name, arguments: args })).content[0];
    assert.equal(content?.type, "text"); return JSON.parse((content as { text: string }).text) as OutputEnvelope;
  } finally { await client.close(); await server.close(); }
}
function assertEnvelope(envelope: OutputEnvelope, side: string, chain: string, asset: string, profile: string, inventoryCommand: string) {
  assert.equal(envelope.ok, false); assert.equal(envelope.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(envelope.error?.details?.reason, "swap_owner_admission_required");
  assert.deepEqual([envelope.error?.details?.side, envelope.error?.details?.chain, envelope.error?.details?.asset, envelope.error?.details?.admissionGap],
    [side, chain, asset, "asset_not_listed"]);
  assert.deepEqual(envelope.next_actions, [`apn allowlist policy status --profile ${profile}`, inventoryCommand]);
}

test("Uniswap ETH to USDT and ETH to WBTC without the output token's admission refuse with the reason on CLI and MCP", async (t) => {
  const deadline = Math.floor(NOW.getTime() / 1000) + 900;
  for (const [outputToken, amountAtomic, call] of [[ETHEREUM_USDT, "1000000000000000", null], [ETHEREUM_WBTC, "400000000000000", wbtcRpc()]] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const state = new StateStore(temporary.root); await state.initialize();
    // The active policy admits native ETH and USDC only, as an owner who admitted the USDC route would have it.
    const active = await keylessPolicy(NOW, new Date(deadline * 1000)), clock = { now: () => NOW }, rpc = new KeylessRpc();
    rpc.quoted = 2_468_410n;
    const runtime = createUniswapKeylessRuntime({ state, wrapping: new MemoryWrapping(), clock, policy: async (profile) => profile === KEYLESS_PROFILE ? active : null,
      foreground: REFUSING_SWAP_APPROVAL, call: rpc.call, verifyPins: async () => [], verifySendPins: async () => [] });
    const quoted = await new KeylessUniswapQuoteBuilder(call ?? rpc.call, new SavedUniswapQuoteStore(temporary.root),
      async () => call === null ? [] : UNISWAP_WBTC_CODE_PINS).quote({ profile: KEYLESS_PROFILE, account: KEYLESS_ACCOUNT, recipient: KEYLESS_ACCOUNT,
      outputToken, amountAtomic, slippageBps: 50, ownerSlippageCapBps: 100, deadline, maxGasLimit: "300000", maxFeePerGas: "30000000000",
      maxPriorityFeePerGas: "1000000000", now: NOW }) as { quoteHash: string };
    const cli = await new ApnCore({ state, clock, uniswapRuntime: runtime }).execute({ command: "swap.uniswap.prepare", profile: KEYLESS_PROFILE,
      quoteHash: quoted.quoteHash, idempotencyKey: `gap-uniswap-${outputToken.slice(2, 10)}-cli` });
    assertEnvelope(cli, "destination", "eip155:1", outputToken, KEYLESS_PROFILE, "apn swap ethereum uniswap inventory");
    const mcp = await mcpCall({ stateRoot: temporary.root, clock, uniswapRuntime: runtime }, "apn_swap_ethereum_uniswap_prepare",
      { profile: KEYLESS_PROFILE, quote: quoted.quoteHash, idempotency_key: `gap-uniswap-${outputToken.slice(2, 10)}-mcp` });
    assertEnvelope(mcp, "destination", "eip155:1", outputToken, KEYLESS_PROFILE, "apn swap ethereum uniswap inventory");
    assert.equal(rpc.sends.length, 0);
  }
});

test("Orca USDC to USDT without one asset's admission refuses with the reason on CLI and MCP", async (t) => {
  for (const [admitted, side, missing] of [[USDC_MINT, "destination", SOLANA_USDT], [SOLANA_USDT, "source", USDC_MINT]] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const clockMs = Date.now(), clock = { now: () => new Date(clockMs) }, owner = await orcaOwner(temporary.root), rpc = await FakeOrcaTokenRpc.create(owner.address);
    const active = compileAllowlistPolicyOverlay({ overlayVersion: "orca-gap.1", profile: ORCA_PROFILE, account: owner.address,
      datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
      effectiveAt: new Date(clockMs - 60_000).toISOString(), expiresAt: new Date(clockMs + 7_200_000).toISOString(), admissions: [
        { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: admitted, rail: "swap", maximumPerTransferAtomic: "5000000", dailyLimitAtomic: "5000000",
          mechanism: ORCA_USDC_USDT.mechanismPin }] } as unknown as AllowlistPolicyOverlayInput).registry;
    const runtime = createOrcaKeylessRuntime({ state: owner.state, clock, rpc, accounts: owner.accounts, verifyPins: async () => [],
      foreground: REFUSING_SWAP_APPROVAL, pool: ORCA_USDC_USDT, policy: async (profile) => profile === ORCA_PROFILE ? active : null });
    const quoted = await runtime.quote({ profile: ORCA_PROFILE, account: owner.address, amountAtomic: USDC_IN.toString(), slippageBps: 50,
      ownerSlippageCapBps: 100, computeUnitLimit: 250_000, computeUnitPriceMicroLamports: "0" }, clock.now()) as { quoteHash: string };
    const orcaRuntime = orcaRuntimeSelector(() => runtime);
    const cli = await new ApnCore({ state: new StateStore(temporary.root), clock, orcaRuntime }).execute({ command: "swap.orca.prepare",
      profile: ORCA_PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: `gap-orca-${side}-cli` });
    assertEnvelope(cli, side, ORCA_SOLANA_CHAIN, missing, ORCA_PROFILE, "apn swap solana orca inventory");
    const mcp = await mcpCall({ stateRoot: temporary.root, clock, orcaRuntime }, "apn_swap_solana_orca_prepare",
      { profile: ORCA_PROFILE, quote: quoted.quoteHash, idempotency_key: `gap-orca-${side}-mcp` });
    assertEnvelope(mcp, side, ORCA_SOLANA_CHAIN, missing, ORCA_PROFILE, "apn swap solana orca inventory");
    assert.equal(rpc.sends.length, 0);
  }
});

test("the Uniswap token lane names the missing token or route at quote with the same reason", async (t) => {
  const NOW_TOKEN = new Date("2026-09-22T00:00:00.000Z"), request = { command: "swap.uniswap-token.quote" as const, profile: "token-swap",
    account: ACCOUNT, recipient: ACCOUNT, sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000",
    approvalCapAtomic: "1000000", deadline: 1_900_000_000, maxApprovalGasLimit: "100000", maxSwapGasLimit: "100000", maxCleanupGasLimit: "100000",
    maxFeePerGas: "2", maxPriorityFeePerGas: "1", maxNativeDebitWei: "600000" };
  const row = (identifier: string, mechanism: SwapMechanismPin) => ({ chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const,
    maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1000000", mechanism });
  for (const [admissions, gap] of [[[row(UNISWAP_USDC, UNISWAP_TOKEN_MECHANISM_PIN)], "asset_not_listed"],
    [[row(UNISWAP_USDC, UNISWAP_TOKEN_MECHANISM_PIN), row(ETHEREUM_USDT, UNISWAP_V3_KEYLESS_MECHANISM_PIN)], "swap_route_not_admitted"]] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    await activateDirectPolicy(temporary.root, "token-swap", { accounts: { evm: ACCOUNT }, admissions, now: NOW_TOKEN });
    const usage = new UniswapTokenUsage(new StateStore(temporary.root), { now: () => NOW_TOKEN }, new AssetUsageLedger(temporary.root));
    await assert.rejects(usage.admitQuote(request, NOW_TOKEN),
      admissionGap("destination", "eip155:1", ETHEREUM_USDT, gap, "token-swap", "apn swap ethereum uniswap-token inventory"));
  }
});
