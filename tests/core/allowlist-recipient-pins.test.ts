import assert from "node:assert/strict";
import test from "node:test";
import { compileAllowlistPolicyOverlayV2, evaluateAssetPolicy, sealAssetPolicyRegistry, type AssetPolicyRegistry } from "../../src/core.js";
import { validateAllowlistAdmission } from "../../src/allowlist-policy-overlay.js";
import { allowlistAdmissions, allowlistDecisionLines } from "../../src/allowlist-policy-activation.js";
import { assertRecipientAdmitted, canonicalRecipient, recipientAdmitted } from "../../src/allowlist-recipient-pins.js";
import { DirectAllowlistGate, type DirectAllowlistSubject } from "../../src/direct-allowlist-gate.js";
import { ApnError } from "../../src/errors.js";
import { EVM_OWNER, SOLANA, SOLANA_OWNER, TRON, TRON_OWNER, USDC, overlayV2 } from "./allowlist-policy-fixtures.js";
import { activateDirectPolicy, EVM_USDC, WIDE_CAPS } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { createPermit2ProductionReadPort } from "../../src/x402-permit2/read-port.js";
import { X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
/** EIP-55 test vector: the checksum spelling is canonical, the lowercase one is not. */
const MIXED = "0x52908400098527886E0F7030069857D2E4169EE7";
const BASE_USDC = EVM_USDC[8453];
const RELAY_BNB = { provider: "relay", reference: "ethereum-usdc-bnb-native-v1" };
const RELAY_BASE = { provider: "relay", reference: "ethereum-usdc-base-eth-v1" };
const X402 = { provider: "x402-test", reference: "exact-eip3009" };
const NOW = new Date("2026-09-18T02:00:00.000Z");
const at = { dailyUsageAtomic: "0", asOfDate: "2026-09-18", asOf: NOW.toISOString() };

function reason(expected: string) {
  return (error: unknown) => error instanceof ApnError && error.details?.reason === expected;
}

function pinnedPolicy() {
  return overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [
    { chain: "eip155:1", kind: "token", identifier: USDC, rail: "direct", ...WIDE_CAPS, recipients: [A, MIXED] },
    { chain: "eip155:1", kind: "token", identifier: USDC, rail: "bridge", dailyLimitAtomic: "2500000", mechanisms: [
      { ...RELAY_BNB, maximumPerTransferAtomic: "2500000", recipients: [B, SOLANA_OWNER] },
      { ...RELAY_BASE, maximumPerTransferAtomic: "300000" },
    ] },
    { chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "x402", maximumPerTransferAtomic: "1000",
      dailyLimitAtomic: "2000", mechanism: X402, recipients: [A] },
  ] } as never);
}

test("owner recipient pins compile into the sealed v2 registry, show on status and the activation screen, and admit exactly", () => {
  const { overlay, registry } = compileAllowlistPolicyOverlayV2(pinnedPolicy());
  assert.deepEqual(compileAllowlistPolicyOverlayV2(structuredClone(pinnedPolicy())).registry, registry);
  const ethUsdc = registry.chains.find((chain) => chain.chain === "eip155:1")!.assets[0]!;
  assert.deepEqual(ethUsdc.recipients, { direct: [A, MIXED] });
  assert.deepEqual(ethUsdc.mechanismOptions?.bridge?.map((option) => option.recipients), [[B, SOLANA_OWNER], undefined]);
  assert.deepEqual(registry.chains.find((chain) => chain.chain === "eip155:8453")!.assets[0]!.recipients, { x402: [A] });
  // Absent pins add no key, so a policy without them seals exactly as before this option existed.
  const unpinned = compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [
    { chain: "eip155:1", kind: "token", identifier: USDC, rail: "direct", ...WIDE_CAPS }] } as never)).registry;
  assert.equal(JSON.stringify(unpinned).includes("recipients"), false);

  const views = allowlistAdmissions(registry);
  assert.deepEqual(views.find((view) => view.rail === "direct")?.recipients, [A, MIXED]);
  assert.deepEqual(views.find((view) => view.rail === "x402")?.recipients, [A]);
  assert.equal(views.find((view) => view.rail === "bridge")?.recipients, undefined);
  const lines = allowlistDecisionLines({ action: "activate", profile: "pins", accounts: { evm: EVM_OWNER }, currentActiveRevision: null,
    fingerprint: "f".repeat(64), code: "x", record: { schemaVersion: "apn.allowlist-policy-record.v2", revision: 1,
      status: "staged_unadmitted", preparedAt: NOW.toISOString(), overlay, registry, recordDigest: "e".repeat(64) } } as never, NOW.toISOString());
  assert.ok(lines.includes(`   Recipients pinned (2): ${A}, ${MIXED}`));
  assert.ok(lines.includes(`   Recipients pinned (1): ${A}`));
  assert.ok(lines.some((line) => line.includes(`reference ${RELAY_BNB.reference};`) && line.endsWith(`; recipients pinned (2): ${B}, ${SOLANA_OWNER}`)));
  assert.ok(lines.some((line) => line.includes(`reference ${RELAY_BASE.reference};`) && !line.includes("recipients")));

  const direct = evaluateAssetPolicy(registry, { chain: "eip155:1", asset: { kind: "token", identifier: USDC }, rail: "direct", amountAtomic: "1", ...at });
  assertRecipientAdmitted({ admission: direct, recipient: A });
  assertRecipientAdmitted({ admission: direct, recipient: MIXED.toLowerCase() });
  assert.throws(() => assertRecipientAdmitted({ admission: direct, recipient: B }), reason("allowlist_recipient_not_admitted"));
  assert.throws(() => assertRecipientAdmitted({ admission: direct, recipient: "not-an-address" }), reason("allowlist_recipient_not_admitted"));
  const bridge = (mechanism: typeof RELAY_BNB) => evaluateAssetPolicy(registry, { chain: "eip155:1",
    asset: { kind: "token", identifier: USDC }, rail: "bridge", mechanism, amountAtomic: "1", ...at });
  assertRecipientAdmitted({ admission: bridge(RELAY_BNB), mechanism: RELAY_BNB, recipient: B });
  assertRecipientAdmitted({ admission: bridge(RELAY_BNB), mechanism: RELAY_BNB, recipient: SOLANA_OWNER });
  assert.throws(() => assertRecipientAdmitted({ admission: bridge(RELAY_BNB), mechanism: RELAY_BNB, recipient: A }),
    reason("allowlist_recipient_not_admitted"));
  assert.equal(recipientAdmitted({ admission: bridge(RELAY_BASE), mechanism: RELAY_BASE, recipient: A }), true);
  assert.throws(() => assertRecipientAdmitted({ admission: bridge(RELAY_BNB), recipient: B }), reason("allowlist_recipient_mechanism_required"));
  const x402 = evaluateAssetPolicy(registry, { chain: "eip155:8453", asset: { kind: "token", identifier: BASE_USDC }, rail: "x402",
    amountAtomic: "1", ...at });
  assertRecipientAdmitted({ admission: x402, recipient: A });
  assert.throws(() => assertRecipientAdmitted({ admission: x402, recipient: B }), reason("allowlist_recipient_not_admitted"));
});

test("misplaced or malformed recipient pins are refused at staging and in a sealed registry", () => {
  const row = (rail: string, extra: Record<string, unknown>, chain = "eip155:1") => ({ chain, kind: "token", identifier: USDC, rail,
    maximumPerTransferAtomic: "1", dailyLimitAtomic: "1", ...extra });
  const swapPin = { provider: "uniswap", reference: "pin" };
  for (const [value, expected] of [
    [row("gasless", { mechanism: X402, recipients: [A] }), "recipients_not_applicable"],
    [row("swap", { mechanisms: [swapPin, swapPin], recipients: [A] }), undefined],
    [{ chain: "eip155:1", kind: "token", identifier: USDC, rail: "bridge", dailyLimitAtomic: "2", recipients: [A], mechanisms: [
      { ...RELAY_BNB, maximumPerTransferAtomic: "1" }, { ...RELAY_BASE, maximumPerTransferAtomic: "1" }] }, "recipients_not_applicable"],
    [row("direct", { recipients: [] }), "invalid_recipients"],
    [row("direct", { recipients: Array.from({ length: 17 }, (_, i) => `0x${String(i + 10).padStart(40, "1")}`) }), "invalid_recipients"],
    [row("direct", { recipients: [A, A] }), "invalid_recipients"],
    [row("direct", { recipients: [MIXED.toLowerCase()] }), "invalid_recipients"],
    [row("direct", { recipients: ["0x0000000000000000000000000000000000000000"] }), "invalid_recipients"],
    [row("direct", { recipients: [SOLANA_OWNER] }), "invalid_recipients"],
    [row("direct", { recipients: A }), "invalid_recipients"],
    [row("x402", { mechanism: X402, recipients: ["*"] }), "invalid_recipients"],
    [{ chain: "eip155:1", kind: "token", identifier: USDC, rail: "bridge", dailyLimitAtomic: "2", mechanisms: [
      { ...RELAY_BNB, maximumPerTransferAtomic: "1", recipients: [MIXED.toLowerCase()] }, { ...RELAY_BASE, maximumPerTransferAtomic: "1" }] }, "invalid_recipients"],
  ] as const) {
    assert.throws(() => validateAllowlistAdmission(value), (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT" &&
      (expected === undefined || error.details?.reason === expected), JSON.stringify(value));
  }
  assert.deepEqual(validateAllowlistAdmission(row("direct", { recipients: [TRON_OWNER] }, TRON)).recipients, [TRON_OWNER]);
  assert.deepEqual(validateAllowlistAdmission(row("direct", { recipients: [SOLANA_OWNER] }, SOLANA)).recipients, [SOLANA_OWNER]);
  // A bridge recipient lives on the destination chain, so a single-pin bridge row takes any family.
  assert.deepEqual(validateAllowlistAdmission(row("bridge", { mechanism: RELAY_BNB, recipients: [SOLANA_OWNER, TRON_OWNER, A] })).recipients,
    [SOLANA_OWNER, TRON_OWNER, A]);
  assert.equal(canonicalRecipient(TRON_OWNER)?.family, "tron");
  assert.equal(canonicalRecipient("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"), null);
  assert.equal(canonicalRecipient("11111111111111111111111111111111"), null);

  const { registry } = compileAllowlistPolicyOverlayV2(pinnedPolicy());
  const { policyDigest: _digest, ...body } = registry;
  const reseal = (mutate: (copy: AssetPolicyRegistry) => void) => {
    const copy = structuredClone(body) as AssetPolicyRegistry; mutate(copy);
    return () => sealAssetPolicyRegistry(copy);
  };
  const usdc = (copy: AssetPolicyRegistry) => copy.chains.find((chain) => chain.chain === "eip155:1")!.assets[0]! as unknown as
    { recipients?: unknown; mechanismOptions?: { bridge?: { recipients?: unknown }[] } };
  for (const mutate of [
    (copy: AssetPolicyRegistry) => { usdc(copy).recipients = { swap: [A] }; },
    (copy: AssetPolicyRegistry) => { usdc(copy).recipients = { x402: [A] }; },
    (copy: AssetPolicyRegistry) => { usdc(copy).recipients = { bridge: [A] }; },
    (copy: AssetPolicyRegistry) => { usdc(copy).recipients = {}; },
    (copy: AssetPolicyRegistry) => { usdc(copy).mechanismOptions!.bridge![1]!.recipients = []; },
  ]) assert.throws(reseal(mutate), { code: "APN_INVALID_INPUT" });
  assert.doesNotThrow(reseal(() => undefined));
});

test("a mixed-case asset symbol is an ordinary registry row, with no merchant mechanism exception", () => {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "symbols.1",
    publishedAt: NOW.toISOString(), effectiveDate: "2026-09-18", chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum",
      assets: [{ kind: "token", identifier: USDC, symbol: "USDm", decimals: 6,
        rails: { direct: true, gasless: false, x402: false, bridge: false, swap: false }, railCaps: { direct: WIDE_CAPS } }] }] });
  assert.equal(registry.chains[0]!.assets[0]!.symbol, "USDm");
  assert.throws(() => sealAssetPolicyRegistry({ ...structuredClone(registry), policyDigest: undefined, chains: [{ ...registry.chains[0]!,
    assets: [{ ...registry.chains[0]!.assets[0]!, symbol: "-usd" }] }] } as never), { code: "APN_INVALID_INPUT" });
});

test("the direct gate refuses a recipient outside the owner's pin at prepare and reservation; an unpinned row admits any", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const root = temporary.root, now = new Date();
  const gate = new DirectAllowlistGate({ state: { root }, clock: { now: () => now } });
  await activateDirectPolicy(root, "pinned", { accounts: { evm: EVM_OWNER }, now, admissions: [
    { chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "direct", ...WIDE_CAPS, recipients: [A] } as never] });
  const subject: DirectAllowlistSubject = { profile: "pinned", operationId: "a".repeat(64), family: "evm", account: EVM_OWNER,
    chain: "eip155:8453", asset: { kind: "token", identifier: BASE_USDC }, amountAtomic: "1", recipient: B };
  await assert.rejects(gate.admit(subject), reason("allowlist_recipient_not_admitted"));
  const binding = await gate.admit({ ...subject, recipient: A.toLowerCase() });
  await assert.rejects(gate.reserve(subject, binding), reason("allowlist_recipient_not_admitted"));
  assert.equal(await gate.hasReservation(subject), false);
  assert.equal((await gate.reserve({ ...subject, recipient: A }, binding)).reservation.state, "reserved");

  await activateDirectPolicy(root, "open", { accounts: { evm: B }, now, admissions: [
    { chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "direct", ...WIDE_CAPS } as never] });
  await gate.admit({ ...subject, profile: "open", account: B, operationId: "b".repeat(64), recipient: MIXED });
});

test("the Permit2 x402 read port refuses a payee outside the owner's x402 pin before any RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const asset = X402_PERMIT2_ASSETS[0]!, payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const, instant = new Date("2026-09-23T04:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: payer }, now: instant, admissions: [{ chain: asset.chain, kind: "token",
    identifier: asset.token, rail: "x402", maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM, recipients: [A] } as never] });
  let rpcCalls = 0;
  const port = createPermit2ProductionReadPort({ profile: "owner", stateRoot: temporary.root, localAccount: async () => payer,
    usage: new AssetUsageLedger(temporary.root), now: () => instant, rpc: { batch: async () => { rpcCalls++; throw new Error("stop after admission"); } } });
  const request = { payer, asset: { ...asset, tokenDomainSeparator: null }, challengeHash: "a".repeat(64), offerHash: "b".repeat(64),
    amountAtomic: "10000", nonceBitmapWordIndex: "0", nowSeconds: Math.floor(instant.getTime() / 1000), sellerSponsorsEip2612: false };
  await assert.rejects(port.read({ ...request, payTo: B }), reason("allowlist_recipient_not_admitted"));
  assert.equal(rpcCalls, 0);
  // The pinned payee passes admission and reaches the first chain read, which this test refuses.
  await assert.rejects(port.read({ ...request, payTo: A }), (error: unknown) => !reason("allowlist_recipient_not_admitted")(error));
  assert.equal(rpcCalls, 1);
});
