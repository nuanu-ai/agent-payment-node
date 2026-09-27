import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import type { ChainAccount } from "../../src/direct-rail-ports.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { requireSwapProtocol, requireUnambiguousSwapProtocol } from "../../src/swap/protocol-registry.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { admitOrcaStableOwner, assertOrcaStableQuoteAdmission, recheckOrcaStableOwner,
  type OrcaStableAdmissionPorts } from "../../src/swap/orca-solana/stable-admission.js";
import { ORCA_KEYLESS_MECHANISM_PIN, ORCA_SOLANA_CHAIN, USDC_MINT, WHIRLPOOL_PROGRAM } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL } from "../../src/swap/orca-solana/stable-readonly.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_MECHANISM_DIGEST, ORCA_STABLE_MECHANISM_PIN } from "../../src/swap/orca-solana/stable-mechanism.js";
import { temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const OWNER = "8YLKo5NJz4g3w29Ggvgf7iyvdqTzgn6RzTzaBW58aB23";
const PROFILE = "stable-test";
const rails = { direct: false, gasless: false, x402: false, bridge: false, swap: true } as const;
const caps = { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "1500000" };

function active(options: { missingUsdt?: boolean; usdtPin?: typeof ORCA_STABLE_MECHANISM_PIN; revision?: number } = {}): ActiveAssetPolicy {
  const row = (mint: string, symbol: string, mechanism: typeof ORCA_STABLE_MECHANISM_PIN) => ({
    kind: "token" as const, identifier: mint, symbol, decimals: 6, rails, caps, mechanismPins: { swap: mechanism },
  });
  const body: UnsignedAssetPolicyRegistry = { schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "stable-owner.1",
    publishedAt: "2026-09-27T00:00:00.000Z", effectiveDate: "2026-09-27",
    effectiveAt: "2026-09-27T00:00:00.000Z", expiresAt: "2026-09-28T00:00:00.000Z",
    chains: [{ chain: ORCA_SOLANA_CHAIN, family: "solana", name: "Solana", assets: [
      row(USDC_MINT, "USDC", ORCA_STABLE_MECHANISM_PIN),
      ...(options.missingUsdt ? [] : [row(SOLANA_USDT, "USDT", options.usdtPin ?? ORCA_STABLE_MECHANISM_PIN)]),
    ] }] };
  const registry = sealAssetPolicyRegistry(body);
  return { profile: PROFILE, registry, digest: registry.policyDigest, revision: options.revision ?? 7,
    accounts: { solana: OWNER }, activationDigest: "a".repeat(64), activatedAt: "2026-09-27T00:00:00.000Z" };
}
const account: ChainAccount = { schemaVersion: "apn.chain-account.v1", profile: PROFILE, profileHash: "b".repeat(64),
  rail: "solana", network: "mainnet", provider: "local", custody: "local_software", address: OWNER,
  createdAt: "2026-09-27T00:00:00.000Z", identityHash: "c".repeat(64) };
function ports(policy: ActiveAssetPolicy | null, usage = "0"): OrcaStableAdmissionPorts {
  return { activePolicy: async () => policy, localAccount: async () => account, dailyUsage: async () => usage };
}
const request = { profile: PROFILE, owner: OWNER, policyRevision: 7, amountInAtomic: "1000000",
  minimumOutputAtomic: "990000", now: NOW };

test("stable Orca selection is exact while legacy family/chain lookup refuses ambiguity", () => {
  assert.notEqual(ORCA_STABLE_MECHANISM_DIGEST, swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN));
  assert.equal(requireSwapProtocol(ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_MECHANISM_DIGEST).pin, ORCA_STABLE_MECHANISM_PIN);
  assert.equal(requireSwapProtocol(ORCA_PROTOCOL_REGISTRY, swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN)).pin,
    ORCA_KEYLESS_MECHANISM_PIN);
  assert.throws(() => requireUnambiguousSwapProtocol(ORCA_PROTOCOL_REGISTRY, ORCA_SOLANA_CHAIN, "orca_solana"),
    { code: "APN_OPERATION_BLOCKED" });
});

test("stable admission binds both canonical mints, exact revision, owner and quote", async () => {
  const admitted = await admitOrcaStableOwner(ports(active()), request);
  assert.equal(admitted.mechanismDigest, ORCA_STABLE_MECHANISM_DIGEST);
  assert.equal(admitted.signable, false); assert.equal(admitted.executable, false);
  const quote = { chain: ORCA_SOLANA_CHAIN, pool: ORCA_STABLE_POOL, program: WHIRLPOOL_PROGRAM,
    sourceMint: USDC_MINT, destinationMint: SOLANA_USDT, amountInAtomic: "1000000", minimumOutputAtomic: "990000" };
  assert.doesNotThrow(() => assertOrcaStableQuoteAdmission(admitted, quote));
  assert.throws(() => assertOrcaStableQuoteAdmission(admitted, { ...quote, pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => assertOrcaStableQuoteAdmission(admitted, { ...quote, minimumOutputAtomic: "980000" }),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.doesNotReject(recheckOrcaStableOwner(ports(active()), admitted, NOW));
  await assert.rejects(recheckOrcaStableOwner(ports(active({ revision: 8 })), admitted, NOW),
    { code: "APN_OPERATION_BLOCKED" });
});

test("stable admission refuses absent USDT, legacy pin, stale revision, owner drift and daily cap", async () => {
  for (const [port, req] of [
    [ports(active({ missingUsdt: true })), request],
    [ports(active({ usdtPin: ORCA_KEYLESS_MECHANISM_PIN })), request],
    [ports(active({ revision: 8 })), request],
    [ports(active()), { ...request, owner: "11111111111111111111111111111111" }],
    [ports(active(), "600000"), request],
  ] as const) await assert.rejects(admitOrcaStableOwner(port, req));
});

test("untrusted stable preview cannot enter the approval operation repository", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const repo = new SwapOperationRepository(temporary.root);
  const service = new GuardedSwapService(repo, new AssetUsageLedger(temporary.root));
  const preview = { schemaVersion: "apn.orca-stable-unsigned-preview.v1", trust: "untrusted_offline_snapshot",
    signable: false, executable: false, owner: OWNER, amountInAtomic: "1000000" };
  await assert.rejects(service.prepare({ quote: preview as never, assetPolicy: active().registry,
    protocolRegistry: ORCA_PROTOCOL_REGISTRY, idempotencyKey: "stable-preview-refusal", approvalCapAtomic: "1000000", now: NOW }));
});
