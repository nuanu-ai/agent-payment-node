import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_USDT } from "../../src/chain-policy.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { assetAdmitsSwapMechanism, swapRouteDigest, swapRouteOf } from "../../src/swap/route-admission.js";
import { ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_PROTOCOL_REGISTRY, USDC_MINT } from "../../src/swap/orca-solana/pins.js";
import { isOrcaKeylessMechanismDigest, ORCA_POOLS, orcaPoolOfMechanism, orcaPoolRoute } from "../../src/swap/orca-solana/pools.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN, ORCA_STABLE_MECHANISM_PIN, ORCA_STABLE_MECHANISM_PIN_SLOT_440170207 } from "../../src/swap/orca-solana/stable-mechanism.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "../../src/swap/orca-solana/stable-readonly.js";

/** SWAP-10 hard requirement: an owner policy written for the former stable lane keeps admitting USDC to USDT. */
test("the usdc-usdt pool route equals the former stable guarded route exactly, so existing owner admissions keep working", () => {
  const pool = ORCA_POOLS["usdc-usdt"];
  assert.deepEqual(orcaPoolRoute(pool), swapRouteOf(ORCA_STABLE_GUARDED_MECHANISM_PIN));
  assert.equal(swapRouteDigest(pool.mechanismPin), swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN));
  // Every generation of the stable lane (preview, guarded, historical slots) shares that route.
  for (const pin of [ORCA_STABLE_MECHANISM_PIN, ORCA_STABLE_MECHANISM_PIN_SLOT_440170207]) {
    assert.equal(swapRouteDigest(pool.mechanismPin), swapRouteDigest(pin));
  }
  // The lane itself is a new mechanism: an old stable record never resolves to the keyless runtime.
  assert.notEqual(swapMechanismDigest(pool.mechanismPin), swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN));
  assert.equal(isOrcaKeylessMechanismDigest(swapMechanismDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN)), false);
  assert.deepEqual([pool.pool, pool.vaultA, pool.vaultB, pool.mintA, pool.mintB],
    [ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B, USDC_MINT, SOLANA_USDT]);
});

test("a policy row that names the stable guarded pin admits the usdc-usdt lane and not the SOL/USDC lane", () => {
  const row = (mechanism: unknown) => ({ rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true },
    mechanismPins: { swap: mechanism } }) as unknown as Parameters<typeof assetAdmitsSwapMechanism>[0];
  assert.equal(assetAdmitsSwapMechanism(row(ORCA_STABLE_GUARDED_MECHANISM_PIN), ORCA_POOLS["usdc-usdt"].mechanismPin), true);
  assert.equal(assetAdmitsSwapMechanism(row(swapRouteOf(ORCA_STABLE_GUARDED_MECHANISM_PIN)), ORCA_POOLS["usdc-usdt"].mechanismPin), true);
  assert.equal(assetAdmitsSwapMechanism(row(ORCA_STABLE_GUARDED_MECHANISM_PIN), ORCA_POOLS["sol-usdc"].mechanismPin), false);
  assert.equal(assetAdmitsSwapMechanism(row(ORCA_KEYLESS_MECHANISM_PIN), ORCA_POOLS["usdc-usdt"].mechanismPin), false);
});

test("the sol-usdc pool keeps the shipped keyless identity and registry byte for byte", () => {
  const pool = ORCA_POOLS["sol-usdc"];
  assert.equal(pool.mechanismPin, ORCA_KEYLESS_MECHANISM_PIN);
  assert.equal(pool.protocolRegistry.registryDigest, ORCA_KEYLESS_PROTOCOL_REGISTRY.registryDigest);
  assert.equal(orcaPoolOfMechanism(swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN))?.id, "sol-usdc");
  assert.equal(orcaPoolOfMechanism(swapMechanismDigest(ORCA_POOLS["usdc-usdt"].mechanismPin))?.id, "usdc-usdt");
  assert.notEqual(pool.protocolRegistry.registryDigest, ORCA_POOLS["usdc-usdt"].protocolRegistry.registryDigest);
});
