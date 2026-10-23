/**
 * QA 0.5.67/0.5.68. RELAY-PREPARE-REFUSAL-CONTEXT-067-002: a Relay quote outliving the owner's policy, an approval or a
 * deposit fee above the caller's ceiling, all answered one "identity, deadline, or fee ceiling changed" with no details.
 * Each is now its own reason with the compared public values; the guards are unchanged and nothing is persisted.
 * BRIDGE-TTY-WRONG-FEE-NETWORK-068-002: the bridge consent's fee line named Base for every source chain; it now names
 * the source network and what its fee model caps.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { publicBridgeOperation } from "../../src/lifi/receipt.js";
import { TtyBridgeApproval } from "../../src/lifi/tty.js";
import { approvalCode } from "../../src/approval-code.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { validateRelayQuote } from "../../src/relay/quote.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", instant = new Date(1790800000 * 1000);
const input = { profile: "default", recipient: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7", amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
  maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "qa0568-relay-0001" };
function relay(state: StateStore, expiresAt: string) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt, chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } } }] }] });
  const policy = { profile: "default", registry, digest: registry.policyDigest, revision: 4, accounts: { evm: payer },
    activationDigest: "a".repeat(64), activatedAt: "2026-09-30T00:00:00.000Z" };
  return new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, { activePolicy: async () => policy,
    publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async (intent) => await validateRelayQuote(JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8")), intent) });
}

test("each Relay quote refusal names its own reason and compared values; nothing is prepared, and a fitting quote still is", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const refusal = async (service: RelayUnsignedPrepareService, overrides: Partial<typeof input>) => {
    try { await service.prepare({ ...input, ...overrides }); } catch (error) { return error as { code: string; message: string; details: Record<string, unknown> }; }
    assert.fail("the quote was prepared");
  };
  const outlives = await refusal(relay(state, "2026-10-01T12:00:00.000Z"), {});
  assert.equal(outlives.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(outlives.details, { reason: "relay_quote_outlives_policy", quote_deadline: "2026-10-01T22:16:42.000Z",
    policy_expires_at: "2026-10-01T12:00:00.000Z", policy_revision: 4, nextActions: ["apn allowlist policy status --profile default"] });
  const service = relay(state, "2026-10-02T00:00:00.000Z");
  for (const [leg, field] of [["approval", "maxApprovalNetworkFeeWei"], ["deposit", "maxDepositNetworkFeeWei"]] as const) {
    const fee = await refusal(service, { [field]: "1" });
    assert.equal(fee.details.reason, `relay_${leg}_fee_above_ceiling`); assert.equal(fee.details.fee_ceiling_wei, "1");
    assert.match(String(fee.details.quoted_fee_wei), /^[1-9][0-9]*$/u); assert.match(fee.message, new RegExp(leg, "u"));
  }
  // No refusal left an operation or a claim behind: the same key prepares the fitting quote.
  const prepared = await service.prepare(input) as { operation_id?: string; operationId?: string };
  assert.match(String(prepared.operation_id ?? prepared.operationId), /^[a-f0-9]{64}$/u);
});

for (const [pair, line] of [
  ["eth-base", "Ethereum (eip155:1) native fee is checked before sending; gas limit x maxFeePerGas caps it on-chain."],
  ["base-arb", "Base (eip155:8453) total native fee is checked before sending; its L1 data and operator fees have no transaction-level on-chain cap."],
  ["arb-eth", "Arbitrum One (eip155:42161) total native fee is checked before sending; its L1 component is charged as gas, so gas limit x maxFeePerGas caps it on-chain."],
] as const) test(`the ${pair} bridge consent explains the source network's own fee`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The consent checks its expiry on the wall clock, so the route is prepared now.
  const s = await lifiFixture(temporary.root, pair, { now: new Date() }), { id, operation } = await s.prepare();
  let printed = "";
  const tty = new TtyBridgeApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 123, write: async (text) => { printed += text; },
    read: async function* () { yield Buffer.from("REJECT\n"); }, close: async () => {} }) });
  assert.equal(await tty.confirm({ operationId: id, fingerprint: operation.fingerprint, exactPhrase: approvalCode("bridge", operation.fingerprint),
    summary: publicBridgeOperation(operation) }), false);
  const feeLines = printed.split("\n").filter((text) => /native fee is checked before sending/u.test(text));
  assert.deepEqual(feeLines.map((text) => text.trim()), [line]);
  assert.equal(s.source.submissions.length, 0);
});
