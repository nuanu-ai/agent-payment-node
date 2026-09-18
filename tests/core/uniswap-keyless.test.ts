import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { bindArgv } from "../../src/command-binder.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { decodeUniswapRouterCalldata } from "../../src/swap/uniswap-router.js";
import { UNISWAP_ROUTER, UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { validateSwapMechanismPin } from "../../src/swap/pin.js";
import { KeylessUniswapQuoteBuilder } from "../../src/swap/uniswap-v3/builder.js";
import { encodeUniswapV3ExactInput } from "../../src/swap/uniswap-v3/encoder.js";
import { SavedUniswapQuoteStore, validateUniswapKeylessMaterial } from "../../src/swap/uniswap-v3/material.js";
import { spotOutput } from "../../src/swap/uniswap-v3/onchain.js";
import { UNISWAP_V3_CODE_PINS, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, UNISWAP_V3_PAIRS,
  USDC_IMPLEMENTATION_PIN, USDC_IMPLEMENTATION_SLOT, ETHEREUM_USDT, verifyCodePins, verifyUsdtNotDeprecated } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";
import { ACCOUNT, AMOUNT_IN, H, KeylessRpc, PROFILE, QUOTED_OUT, SQRT_PRICE_X96, USDT_SQRT_PRICE_X96 } from "./uniswap-keyless-helpers.js";

const NOW = new Date("2026-09-18T05:00:00.000Z"), DEADLINE = Math.floor(NOW.getTime() / 1000) + 900, pair = UNISWAP_V3_PAIRS[0]!;
const request = { profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT, outputToken: UNISWAP_USDC, amountAtomic: AMOUNT_IN, slippageBps: 50, ownerSlippageCapBps: 100,
  deadline: DEADLINE, maxGasLimit: "300000", maxFeePerGas: "30000000000", maxPriorityFeePerGas: "1000000000" };
const noPins = async () => [];

test("keyless pins are canonical, verified hashes are fixed, and the mechanism is a distinct sdk pin with no Trading API", () => {
  assert.equal(validateSwapMechanismPin(UNISWAP_V3_KEYLESS_MECHANISM_PIN).constructorKind, "sdk");
  assert.equal(JSON.stringify(UNISWAP_V3_KEYLESS_MECHANISM_PIN).includes("trade-api"), false);
  assert.equal(UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.records.length, 1);
  assert.deepEqual(UNISWAP_V3_CODE_PINS.map((pin) => pin.role), ["universal_router_2_2_0", "quoter_v2", "v3_factory", "weth9", "usdc_proxy",
    "pool_usdc_weth_500", "usdt", "pool_weth_usdt_3000"]);
  assert.deepEqual(UNISWAP_V3_PAIRS[1], { outputToken: ETHEREUM_USDT, outputSymbol: "USDT", outputDecimals: 6,
    pool: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36", fee: 3000, wethIsToken0: true });
  for (const pin of [...UNISWAP_V3_CODE_PINS, USDC_IMPLEMENTATION_PIN]) assert.match(pin.codeHash, /^0x[a-f0-9]{64}$/u);
  assert.deepEqual(pair, { outputToken: UNISWAP_USDC, outputSymbol: "USDC", outputDecimals: 6, pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    fee: 500, wethIsToken0: false });
});

test("code-pin verification fails closed on changed code, missing code, and a swapped proxy implementation", async () => {
  const code = "0x6001600155" as Hex, pins = [{ role: "fake", address: "0x1111111111111111111111111111111111111111", codeHash: keccak256(code) }];
  const implementationCode = "0x600260025500" as Hex;
  const implementation = { proxy: "0x2222222222222222222222222222222222222222", slot: USDC_IMPLEMENTATION_SLOT,
    pin: { role: "impl", address: "0x3333333333333333333333333333333333333333", codeHash: keccak256(implementationCode) } };
  const rpc = (patch: { code?: Hex; word?: string } = {}) => async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getStorageAt") return patch.word ?? `0x${"0".repeat(24)}${"3".repeat(40)}`;
    if (method === "eth_getCode") return params[0] === implementation.pin.address ? implementationCode : patch.code ?? code;
    throw new Error(method);
  };
  assert.equal((await verifyCodePins(rpc(), "0x64", pins, implementation)).length, 2);
  for (const patch of [{ code: "0x6001600156" as Hex }, { code: "0x" as Hex }, { word: `0x${"0".repeat(24)}${"4".repeat(40)}` }]) {
    await assert.rejects(verifyCodePins(rpc(patch), "0x64", pins, implementation),
      (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "uniswap_code_pin_drift");
  }
});

test("the local encoder is the exact inverse of the strict Universal Router decoder", () => {
  const encoded = encodeUniswapV3ExactInput({ recipient: ACCOUNT, inputAmountAtomic: AMOUNT_IN, minimumOutputAtomic: "2456738", deadline: DEADLINE, pair });
  const decoded = decodeUniswapRouterCalldata(encoded.data, { recipient: ACCOUNT, inputAmountAtomic: AMOUNT_IN, minimumOutputAtomic: "2456738", deadline: DEADLINE });
  assert.deepEqual(decoded, encoded.route); assert.equal(decoded.command, "V3_SWAP_EXACT_IN"); assert.equal(decoded.minimumOutputAtomic, "2456738");
  assert.ok(encoded.data.startsWith("0x3593564c")); assert.ok(encoded.data.includes("0b00"));
  assert.throws(() => decodeUniswapRouterCalldata(encoded.data, { recipient: ACCOUNT, inputAmountAtomic: AMOUNT_IN, minimumOutputAtomic: "2456739", deadline: DEADLINE }),
    { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => encodeUniswapV3ExactInput({ recipient: ACCOUNT.toLowerCase(), inputAmountAtomic: AMOUNT_IN, minimumOutputAtomic: "1", deadline: DEADLINE, pair }),
    { code: "APN_INVALID_INPUT" });
});

test("spot price comes from slot0 and matches the live 2026-09-18 pool reading", () => {
  assert.equal(spotOutput(10n ** 18n, SQRT_PRICE_X96, false), 2_470_318_453n);
  const afterFee = BigInt(AMOUNT_IN) * 999_500n / 1_000_000n;
  assert.equal(spotOutput(afterFee, SQRT_PRICE_X96, false), QUOTED_OUT);
  assert.equal(spotOutput(10n ** 18n, 2n ** 96n, true), 10n ** 18n);
});

test("builder quotes on-chain, encodes, simulates at one block, and persists only bound material", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new KeylessRpc(), quotes = new SavedUniswapQuoteStore(temporary.root);
  const quoted: any = await new KeylessUniswapQuoteBuilder(rpc.call, quotes, noPins).quote({ ...request, now: NOW });
  assert.equal(quoted.quote.expectedOutputAtomic, QUOTED_OUT.toString()); assert.equal(quoted.quote.minimumOutputAtomic, "2456738");
  assert.equal(quoted.price.priceImpactBps, 0); assert.equal(quoted.approvalCapAtomic, "0"); assert.equal(quoted.signed, false);
  assert.equal(quoted.unsignedTransaction.to, UNISWAP_ROUTER); assert.equal(quoted.unsignedTransaction.gasLimit, "203084");
  assert.deepEqual(quoted.gas, { gasLimit: "203084", maxFeePerGas: "30000000000", maxPriorityFeePerGas: "1000000000", maximumGasCostWei: "6092520000000000" });
  assert.equal(rpc.calls.includes("eth_sendRawTransaction"), false);
  const material = await quotes.load(quoted.quoteHash);
  assert.equal(material?.quote.quoteHash, quoted.quoteHash);
  const path = join(temporary.root, "swap-quotes", `${quoted.quoteHash}.json`), stored = JSON.parse(await readFile(path, "utf8"));
  for (const tamper of [
    (m: any) => { m.execution.envelope.gasLimit = "203085"; },
    (m: any) => { m.gasOrEnergy.maxFeePerGas = "1"; },
    (m: any) => { m.execution.evidence.pool.priceImpactBps = 1; },
    (m: any) => { m.approvalCapAtomic = "1"; },
  ]) {
    const copy = structuredClone(stored); tamper(copy);
    assert.throws(() => validateUniswapKeylessMaterial(copy), { code: "APN_STATE_CORRUPT" });
  }
  stored.execution.envelope.value = "1"; await writeFile(path, JSON.stringify(stored));
  await assert.rejects(quotes.load(quoted.quoteHash), { code: "APN_STATE_CORRUPT" });
});

test("builder refuses impact above the owner cap, gas and fee caps, low balance, router revert, and wrong chain", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const cases: Array<[string, (rpc: KeylessRpc) => void, Partial<typeof request>]> = [
    ["uniswap_price_impact", (rpc) => { rpc.quoted = 2_400_000n; }, {}],
    ["uniswap_gas_cap", () => undefined, { maxGasLimit: "200000" }],
    ["uniswap_fee_cap", (rpc) => { rpc.baseFee = 29_500_000_000n; }, {}],
    ["uniswap_native_balance", (rpc) => { rpc.balance = 10n ** 15n; }, {}],
    ["uniswap_simulation", (rpc) => { rpc.routerReverts = true; }, {}],
  ];
  for (const [reason, patch, override] of cases) {
    const rpc = new KeylessRpc(); patch(rpc);
    await assert.rejects(new KeylessUniswapQuoteBuilder(rpc.call, new SavedUniswapQuoteStore(temporary.root), noPins).quote({ ...request, ...override, now: NOW }),
      (error: any) => error.details?.reason === reason, reason);
  }
  const wrongChain = new KeylessRpc(); wrongChain.chainId = "0x2105";
  await assert.rejects(new KeylessUniswapQuoteBuilder(wrongChain.call, new SavedUniswapQuoteStore(temporary.root), noPins).quote({ ...request, now: NOW }),
    { code: "APN_CHAIN_MISMATCH" });
  await assert.rejects(new KeylessUniswapQuoteBuilder(new KeylessRpc().call, new SavedUniswapQuoteStore(temporary.root), noPins)
    .quote({ ...request, slippageBps: 101, now: NOW }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(new KeylessUniswapQuoteBuilder(new KeylessRpc().call, new SavedUniswapQuoteStore(temporary.root), noPins)
    .quote({ ...request, deadline: DEADLINE + 1_000, now: NOW }), { code: "APN_INVALID_INPUT" });
});

test("confirmed revert is terminal in the shared ledger and releases the principal from daily usage", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { keylessPolicy } = await import("./uniswap-keyless-helpers.js");
  const policy = await keylessPolicy(NOW, new Date(DEADLINE * 1000)), ledger = new AssetUsageLedger(temporary.root);
  const identity = { account: ACCOUNT, chain: "eip155:1", asset: { kind: "native" as const, identifier: null } };
  const lease = await ledger.reserve({ ...identity, registry: policy, rail: "swap", amountAtomic: AMOUNT_IN, idempotencyKey: "revert-lease-0001", now: NOW });
  await assert.rejects(ledger.transition({ ...identity, reservationId: lease.reservationId, policyDigest: lease.policyDigest,
    state: "failed_confirmed_revert", now: NOW, outcomeDigest: H("a") }), { code: "APN_OPERATION_BLOCKED" });
  await ledger.transition({ ...identity, reservationId: lease.reservationId, policyDigest: lease.policyDigest, state: "unknown_finality", now: NOW });
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, AMOUNT_IN);
  const released = await ledger.transition({ ...identity, reservationId: lease.reservationId, policyDigest: lease.policyDigest,
    state: "failed_confirmed_revert", now: NOW, outcomeDigest: H("a") });
  assert.equal(released.state, "failed_confirmed_revert"); assert.equal(released.effectAt, null);
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, "0");
  await assert.rejects(ledger.transition({ ...identity, reservationId: lease.reservationId, policyDigest: lease.policyDigest,
    state: "finalized", now: NOW, outcomeDigest: H("b") }), { code: "APN_OPERATION_BLOCKED" });
});

test("createApnCore builds the keyless runtime per swap.uniswap command and refuses preparation without owner admission", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const quote = createApnCore(bindArgv(["swap", "ethereum", "uniswap", "status", "--operation", H("c")]), { stateRoot: temporary.root });
  assert.ok(quote.context.uniswapRuntime); assert.equal(quote.context.uniswap, undefined);
  const prepare = await createApnCore(bindArgv(["swap", "ethereum", "uniswap", "prepare", "--profile", PROFILE, "--quote", H("a"),
    "--idempotency-key", "keyless-core-0001"]), { stateRoot: temporary.root }).execute({ command: "swap.uniswap.prepare", profile: PROFILE,
    quoteHash: H("a"), idempotencyKey: "keyless-core-0001" });
  assert.equal(prepare.ok, false); assert.equal(prepare.error?.code, "APN_OPERATION_NOT_FOUND");
  const inventory = await createApnCore(bindArgv(["swap", "ethereum", "uniswap", "inventory"]), { stateRoot: temporary.root })
    .execute({ command: "swap.uniswap.inventory" });
  assert.equal((inventory.data as any).execution, "foreground_cli_after_owner_admission");
  assert.equal((inventory.data as any).keyless.mechanismPin.constructorKind, "sdk");
  const approve = await createApnCore(bindArgv(["swap", "ethereum", "uniswap", "execute", "--operation", H("c")]), { stateRoot: temporary.root })
    .execute({ command: "swap.uniswap.execute", operationId: H("c") });
  assert.equal(approve.error?.code, "APN_OPERATION_NOT_FOUND");
});

test("ETH to USDT quotes the deepest pinned pool with WETH as token0, and a deprecated USDT fails closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  assert.equal(spotOutput(10n ** 18n, USDT_SQRT_PRICE_X96, true), 2_475_838_041n);
  const rpc = new KeylessRpc(); rpc.quoted = 2_468_410n;
  const quotes = new SavedUniswapQuoteStore(temporary.root);
  const quoted: any = await new KeylessUniswapQuoteBuilder(rpc.call, quotes, noPins).quote({ ...request, outputToken: ETHEREUM_USDT, now: NOW });
  assert.equal(quoted.quote.destinationAsset.identifier, ETHEREUM_USDT); assert.equal(quoted.price.pool, "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36");
  assert.equal(quoted.price.feeTier, 3000); assert.equal(quoted.price.priceImpactBps, 0); assert.equal(quoted.price.outputSymbol, "USDT");
  assert.equal(quoted.quote.minimumOutputAtomic, "2456068");
  assert.equal((await quotes.load(quoted.quoteHash))?.execution.evidence.pool.fee, 3000);
  await assert.rejects(new KeylessUniswapQuoteBuilder(rpc.call, quotes, noPins).quote({ ...request,
    outputToken: "0x6B175474E89094C44Da98b954EedeAC495271d0F", now: NOW }), (error: any) => error.details?.reason === "uniswap_pair_unpinned");
  await verifyUsdtNotDeprecated(rpc.call, "0x64"); rpc.usdtDeprecated = true;
  await assert.rejects(verifyUsdtNotDeprecated(rpc.call, "0x64"), (error: any) => error.details?.reason === "uniswap_code_pin_drift");
});
