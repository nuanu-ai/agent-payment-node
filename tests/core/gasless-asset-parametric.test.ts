import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits, getAddress } from "viem";
import { approvalCode } from "../../src/approval-code.js";
import { hashObject } from "../../src/canonical.js";
import { gaslessCapabilities } from "../../src/gasless/catalog.js";
import { validateGaslessIntent } from "../../src/gasless/intent-validation.js";
import type { GaslessIntent } from "../../src/gasless/model.js";
import { publicGaslessOperation } from "../../src/gasless/receipt.js";
import { GASLESS_DEPLOYMENTS, gaslessAsset, gaslessIntentAsset } from "../../src/gasless/registry.js";
import { TtyGaslessApproval } from "../../src/gasless/tty.js";
import { gaslessDecimal } from "../../src/gasless/validation.js";
import { gaslessEnvelopeBinding } from "../../src/gasless/wire.js";
import { bundledGaslessFixture } from "./gasless-fixtures/bundler-transport.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const FOREIGN_TOKEN = getAddress("0x1111111111111111111111111111111111111111");

test("an operator amount is scaled by the admitting row's decimals, never by a baked six-decimal scale", () => {
  assert.equal(gaslessDecimal("1.5", 6), "1500000");
  assert.equal(gaslessDecimal("0.000001", 6), "1");
  assert.equal(gaslessDecimal("1.5", 18), "1500000000000000000");
  assert.equal(gaslessDecimal("0.000000000000000001", 18), "1");
  assert.equal(gaslessDecimal("2.5", 8), "250000000");
  assert.equal(gaslessDecimal("7", 0), "7");
  // The fraction width follows the scale in both directions.
  for (const [value, decimals] of [["1.0000001", 6], ["1.5", 0], ["1.0000000000000000001", 18]] as const) {
    assert.throws(() => gaslessDecimal(value, decimals),
      { code: "APN_INVALID_INPUT", message: "Gasless validation failed: gasless_decimal_amount." });
  }
});

test("an unusable decimal scale is refused rather than silently defaulted", () => {
  for (const decimals of [-1, 37, 1.5, Number.NaN]) {
    assert.throws(() => gaslessDecimal("1", decimals),
      { code: "APN_INVALID_INPUT", message: "Gasless validation failed: gasless_decimal_scale." });
  }
});

test("every admitted row carries its asset as data, and the row's pins are that asset's pins", () => {
  assert.equal(GASLESS_DEPLOYMENTS.length, 7);
  for (const row of GASLESS_DEPLOYMENTS) {
    assert.equal(row.assets.length, 1, `${row.chainId}: one admitted asset`);
    const asset = gaslessAsset(row.chainId, row.token);
    assert.equal(asset, row.assets[0]);
    assert.equal(asset.decimals, 6);
    assert.equal(asset.symbol, "USDC");
    assert.equal(asset.domain.version, "2");
    assert.deepEqual(asset.domain, row.tokenDomain);
    assert.equal(asset.paymaster, row.paymaster);
    // Action-time assertion: the row's decimals are the `decimals()` word `verifyProtocolAt` compares on chain.
    const decimalsRead = row.reads.filter((r) => r.kind === "call" && r.address === row.token && r.data === "0x313ce567");
    assert.equal(decimalsRead.length, 1);
    assert.equal(BigInt(decimalsRead[0]!.expected), BigInt(asset.decimals));
    // Action-time assertion: the sponsoring paymaster's own `token()` must return this asset.
    const paymasterToken = row.reads.filter((r) => r.kind === "call" && r.address === asset.paymaster && r.data === "0xfc0c546a");
    assert.equal(paymasterToken.length, 1);
    assert.equal(getAddress(`0x${paymasterToken[0]!.expected.slice(-40)}`), asset.token);
    // The balance-layout claim names the implementation whose code hash the same action verifies.
    assert.equal(asset.balanceLayout?.implementationHash, asset.implementationHash);
    assert.equal(asset.balanceLayout?.mappingSlotAtomic, "9");
    assert.ok(row.code.some((c) => c.address === asset.implementation && c.codeHash === asset.implementationHash));
  }
  assert.equal(new Set(GASLESS_DEPLOYMENTS.map((r) => r.assets[0]!.domain.name)).size, 2);
});

test("a stored intent is re-validated against the registry row it names, not against a baked literal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { operation } = await s.prepare();
  const intent = operation.intent;
  assert.equal(gaslessIntentAsset(intent), gaslessAsset(8453, intent.token));
  const rebind = (patch: Partial<GaslessIntent>): GaslessIntent => {
    const body = { ...intent, ...patch };
    return { ...body, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(body)) };
  };
  const cases: readonly (readonly [string, GaslessIntent])[] = [
    ["permit-domain version", rebind({ tokenDomain: { ...intent.tokenDomain, version: "1" } })],
    ["token name", rebind({ tokenDomain: { ...intent.tokenDomain, name: "Tether USD" } })],
    ["token", rebind({ token: FOREIGN_TOKEN, tokenDomain: { ...intent.tokenDomain, verifyingContract: FOREIGN_TOKEN } })],
    ["paymaster", rebind({ paymaster: FOREIGN_TOKEN })],
  ];
  for (const [label, candidate] of cases) {
    assert.throws(() => gaslessIntentAsset(candidate), { code: candidate.token === FOREIGN_TOKEN
      ? "APN_PROVIDER_CAPABILITY_UNAVAILABLE" : "APN_PROVIDER_PROTOCOL" }, label);
    // Even with a consistent envelope hash the durable journal still refuses it.
    assert.throws(() => validateGaslessIntent(candidate),
      { code: "APN_STATE_CORRUPT", message: "Gasless validation failed: gasless_intent_binding." }, label);
  }
});

test("every public gasless surface takes its symbol and decimals from the registry row", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { operation } = await s.prepare();
  for (const network of gaslessCapabilities().networks) {
    const asset = gaslessAsset(network.chain_id, network.token);
    assert.equal(network.symbol, asset.symbol); assert.equal(network.decimals, asset.decimals);
  }
  const asset = gaslessAsset(8453, operation.intent.token);
  const receipt = publicGaslessOperation(operation);
  assert.equal(receipt.transfer.symbol, asset.symbol);
  assert.equal(receipt.transfer.decimals, asset.decimals);
  const balance = await s.core.execute({ command: "gasless.balance", profile: s.profile, chainId: 8453 });
  assert.equal(balance.ok, true, balance.error?.message);
  const read = balance.data as { symbol: string; decimals: number };
  assert.equal(read.symbol, asset.symbol); assert.equal(read.decimals, asset.decimals);
});

test("the approval screen renders the row's unit and scale, with no baked USDC or six-decimal formatting", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 8453, { now: new Date() });
  const prepared = await s.prepare("gasless-parametric-tty-0001");
  const real = publicGaslessOperation(prepared.operation);
  const summary = { ...real, transfer: { ...real.transfer, symbol: "WETH", decimals: 18 } };
  const phrase = approvalCode("gasless", prepared.operation.fingerprint);
  const screen = terminal(`${phrase}\n`);
  const approval = new TtyGaslessApproval({ isTerminal: () => true, openTerminal: async () => screen.port });
  assert.equal(await approval.confirm({ operationId: prepared.id, fingerprint: prepared.operation.fingerprint,
    exactPhrase: phrase, summary }), true);
  const shown = screen.output();
  assert.ok(shown.includes("transfer with gas paid in WETH"), shown);
  assert.ok(shown.includes(`WETH contract: ${summary.transfer.token}`), shown);
  assert.ok(shown.includes(`Total budget: ${formatUnits(BigInt(summary.transfer.gross_atomic), 18)} WETH`), shown);
  assert.ok(shown.includes(`Recipient receives: ${formatUnits(BigInt(summary.transfer.recipient_atomic), 18)} WETH`), shown);
  assert.ok(shown.includes("charge the displayed WETH fee budget"), shown);
  assert.equal(shown.includes("USDC"), false, shown);
});

test("an on-chain decimals() that disagrees with the row fails closed before any effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root); s.setLimit(100);
  await s.prepare();
  s.setFault("decimals");
  await assert.rejects(s.rpc.snapshot(s.account.address),
    { code: "APN_RPC_PROTOCOL", message: "Gasless validation failed: gasless_protocol_identity." });
  assert.equal(s.estimates.length, 0);
  assert.equal(s.rpc.bundlerOrigin, "https://bundler.example");
});

test("a mirror estimate whose balance-layout claim the chain contradicts fails closed before the bundler request", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root); s.setLimit(100);
  const { operation } = await s.prepare();
  const fees = { maxFeePerGas: operation.intent.gas.maxFeePerGas,
    maxPriorityFeePerGas: operation.intent.gas.maxPriorityFeePerGas };
  s.setFault("layout");
  await assert.rejects(s.rpc.mirrorEstimate(operation.intent, fees),
    { code: "APN_PROVIDER_PROTOCOL", message: "Gasless validation failed: gasless_balance_layout_mismatch." });
  assert.equal(s.estimates.length, 0);
  // The same intent estimates once the chain agrees with the row again, so only the claim was ever in question.
  s.setFault("");
  const estimate = await s.rpc.mirrorEstimate(operation.intent, fees);
  assert.match(estimate.responseHash, /^[a-f0-9]{64}$/u);
  assert.equal(s.estimates.length, 1);
});

function terminal(input: string) {
  let output = "", closes = 0;
  return { port: { fd: 42, write: async (text: string) => { output += text; },
    read: async function* () { yield Buffer.from(input, "ascii"); }, close: async () => { closes++; } },
  output: () => output, closes: () => closes };
}
