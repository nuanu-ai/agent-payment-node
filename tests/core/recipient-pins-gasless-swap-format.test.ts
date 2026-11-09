import assert from "node:assert/strict";
import test from "node:test";
import { compileAllowlistPolicyOverlayV2, evaluateAssetPolicy, sealAssetPolicyRegistry, type AssetPolicyRegistry } from "../../src/core.js";
import { validateAllowlistAdmission } from "../../src/allowlist-policy-overlay.js";
import { allowlistAdmissions } from "../../src/allowlist-policy-activation.js";
import { assertRecipientAdmitted } from "../../src/allowlist-recipient-pins.js";
import { COINBASE_GASLESS_MECHANISM } from "../../src/coinbase-gasless-policy.js";
import { ApnError } from "../../src/errors.js";
import { localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { EVM_OWNER, SOLANA_OWNER, TRON_OWNER, USDC, overlayV2, uniswapPin } from "./allowlist-policy-fixtures.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const MIXED = "0x52908400098527886E0F7030069857D2E4169EE7";
const ARBITRUM = "eip155:42161", ARBITRUM_USDC = gaslessDeployment(42161).token;
const BASE_USDC = gaslessDeployment(8453).token;
const NOW = "2026-09-18T02:00:00.000Z";
const at = { dailyUsageAtomic: "0", asOfDate: NOW.slice(0, 10), asOf: NOW };
const caps = { maximumPerTransferAtomic: "1000", dailyLimitAtomic: "2000" };
const reason = (expected: string) => (error: unknown) => error instanceof ApnError && error.details?.reason === expected;

const gasless = (extra: Record<string, unknown>) => ({ chain: ARBITRUM, kind: "token", identifier: ARBITRUM_USDC, rail: "gasless", ...caps,
  mechanism: localGaslessMechanism(42161), ...extra });
const coinbase = (extra: Record<string, unknown>) => ({ chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "gasless", ...caps,
  mechanism: COINBASE_GASLESS_MECHANISM, ...extra });
const swap = (extra: Record<string, unknown>, identifier?: string) => ({ chain: "eip155:1", kind: identifier === undefined ? "native" : "token",
  ...(identifier === undefined ? {} : { identifier }), rail: "swap", ...caps, mechanism: uniswapPin(), ...extra });
const ROUTES = [uniswapPin(), uniswapPin({ routerProgramIdentity: C })];

test("gasless and swap admissions take a recipient list: it compiles, shows on the screen and admits exactly", () => {
  const { registry } = compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [
    gasless({ recipients: [A, MIXED] }) as never,
    coinbase({ recipients: [B] }) as never,
    swap({ recipients: [A] }) as never,
    { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", ...caps, mechanisms: ROUTES, recipients: [B, A] } as never,
  ] }));
  const row = (chain: string) => registry.chains.find((entry) => entry.chain === chain)!.assets;
  assert.deepEqual(row(ARBITRUM)[0]!.recipients, { gasless: [A, MIXED] });
  assert.equal(row(ARBITRUM)[0]!.gaslessRecipient, undefined);
  assert.deepEqual(row("eip155:8453")[0]!.recipients, { gasless: [B] });
  assert.deepEqual(row("eip155:1").map((asset) => asset.recipients), [{ swap: [A] }, { swap: [B, A] }]);
  const views = allowlistAdmissions(registry);
  // Chains in code-unit order: eip155:42161 before eip155:8453.
  assert.deepEqual(views.filter((view) => view.rail === "gasless").map((view) => view.recipients), [[A, MIXED], [B]]);
  assert.deepEqual(views.filter((view) => view.rail === "swap").map((view) => view.recipients), [[A], [B, A]]);

  const local = evaluateAssetPolicy(registry, { chain: ARBITRUM, asset: { kind: "token", identifier: ARBITRUM_USDC }, rail: "gasless",
    amountAtomic: "1", ...at });
  assertRecipientAdmitted({ admission: local, recipient: MIXED.toLowerCase() });
  assert.throws(() => assertRecipientAdmitted({ admission: local, recipient: B }), reason("allowlist_recipient_not_admitted"));
  const native = evaluateAssetPolicy(registry, { chain: "eip155:1", asset: { kind: "native", identifier: null }, rail: "swap",
    amountAtomic: "1", ...at });
  assertRecipientAdmitted({ admission: native, recipient: A });
  assert.throws(() => assertRecipientAdmitted({ admission: native, recipient: B }), reason("allowlist_recipient_not_admitted"));
  // The single gasless pin keeps its meaning and its own check; the list form governs only rows that carry it.
  const single = validateAllowlistAdmission({ ...coinbase({ recipient: A }) });
  assert.equal(single.recipient, A); assert.equal(single.recipients, undefined);
});

test("malformed gasless and swap recipient lists are refused at staging", () => {
  const seventeen = Array.from({ length: 17 }, (_, i) => `0x${String(i + 10).padStart(40, "1")}`);
  for (const [value, expected] of [
    [gasless({ recipient: A, recipients: [A] }), "recipient_pin_conflict"],
    [{ ...gasless({ recipients: [A] }), chain: "eip155:8453", identifier: BASE_USDC, mechanism: localGaslessMechanism(8453), recipient: B },
      "recipient_pin_conflict"],
    [gasless({ recipients: [SOLANA_OWNER] }), "invalid_recipients"],
    [swap({ recipients: [TRON_OWNER] }), "invalid_recipients"],
    [gasless({ recipients: [A, A] }), "invalid_recipients"],
    [swap({ recipients: [B, B] }), "invalid_recipients"],
    [gasless({ recipients: seventeen }), "invalid_recipients"],
    [swap({ recipients: seventeen }), "invalid_recipients"],
    [gasless({ recipients: [] }), "invalid_recipients"],
    [swap({ recipients: [MIXED.toLowerCase()] }), "invalid_recipients"],
    [gasless({ recipients: ["0x0000000000000000000000000000000000000000"] }), "invalid_recipients"],
    [{ chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", ...caps, mechanisms: ROUTES, recipients: [A, A] }, "invalid_recipients"],
    [{ chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", ...caps, mechanisms: ROUTES, recipient: A }, "recipient_not_applicable"],
    [coinbase({}), "recipient_required"],
    [coinbase({ recipients: [SOLANA_OWNER] }), "invalid_recipients"],
  ] as const) {
    assert.throws(() => validateAllowlistAdmission(value), (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT" &&
      error.details?.reason === expected, `${expected}: ${JSON.stringify(value)}`);
  }
  assert.deepEqual(validateAllowlistAdmission(gasless({ recipients: seventeen.slice(0, 16) })).recipients, seventeen.slice(0, 16));
});

test("a sealed registry refuses a gasless list beside the single pin, a list on an unadmitted rail and an unpinned Coinbase row", () => {
  const { registry } = compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [
    coinbase({ recipients: [B] }) as never, swap({ recipients: [A] }) as never] }));
  const { policyDigest: _digest, ...body } = registry;
  const reseal = (mutate: (copy: AssetPolicyRegistry) => void) => {
    const copy = structuredClone(body) as AssetPolicyRegistry; mutate(copy);
    return () => sealAssetPolicyRegistry(copy);
  };
  const asset = (copy: AssetPolicyRegistry, chain: string) => copy.chains.find((entry) => entry.chain === chain)!.assets[0]! as unknown as
    { recipients?: unknown; gaslessRecipient?: string };
  for (const mutate of [
    (copy: AssetPolicyRegistry) => { asset(copy, "eip155:8453").gaslessRecipient = A; },
    (copy: AssetPolicyRegistry) => { delete asset(copy, "eip155:8453").recipients; },
    (copy: AssetPolicyRegistry) => { asset(copy, "eip155:8453").recipients = { swap: [A] }; },
    (copy: AssetPolicyRegistry) => { asset(copy, "eip155:1").recipients = { gasless: [A] }; },
    (copy: AssetPolicyRegistry) => { asset(copy, "eip155:1").recipients = { swap: [SOLANA_OWNER] }; },
  ]) assert.throws(reseal(mutate), { code: "APN_INVALID_INPUT" });
  assert.doesNotThrow(reseal(() => undefined));
  // The single pin alone still seals, as every policy written before the list form did.
  assert.doesNotThrow(reseal((copy) => { delete asset(copy, "eip155:8453").recipients; asset(copy, "eip155:8453").gaslessRecipient = A; }));
});
