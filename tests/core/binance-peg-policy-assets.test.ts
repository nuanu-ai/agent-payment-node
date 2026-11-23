/**
 * QA 0.5.111: the only cheap USDT Permit2 seller (ScraplingData /v1/ping) asks for BNB Smart Chain USDT
 * 0x55d398…7955, and `apn allowlist resolve` refused it with unknown_token_deployment: the frozen 2026-09-17 dataset
 * refuses Binance-Peg USDT and USDC as not issuer-issued. The owner admitted both on 2026-11-23. They resolve as a
 * reviewed supplement; the frozen dataset and its digests stay as they were, so owner policies activated earlier keep
 * their binding.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWLIST_DATASET_SHA256, loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { loadActiveAssetPolicyRegistry } from "../../src/allowlist-active-policy.js";
import { BINANCE_PEG_POLICY_ASSETS, binancePegPolicyAsset } from "../../src/binance-peg-policy-assets.js";
import { runCli } from "../../src/cli.js";
import { requireListedDirectAsset } from "../../src/direct-allowlist-gate.js";
import { directEvmListRows } from "../../src/evm-direct-networks.js";
import { x402AssetLabel } from "../../src/x402-token-unit.js";
import { admittedPermit2Assets } from "../../src/x402-permit2/admission.js";
import { X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const USDT = "0x55d398326f99059fF775485246999027B3197955", USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";

test("the frozen dataset is unchanged and still lists only native BNB on eip155:56", () => {
  const inventory = loadAllowlistInventory();
  assert.equal(inventory.dataset.sha256, ALLOWLIST_DATASET_SHA256);
  assert.deepEqual(inventory.assets.filter((row) => row.chain === "eip155:56").map((row) => row.kind), ["native"]);
  assert.deepEqual(BINANCE_PEG_POLICY_ASSETS.map((row) => [row.chain, row.identifier, row.symbol, row.decimals]),
    [["eip155:56", USDT, "USDT", 18], ["eip155:56", USDC, "USDC", 18]]);
});

test("allowlist resolve names both Binance-Peg tokens; other spellings and tokens keep the frozen refusals", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const resolve = (identifier: string) => runCli(["allowlist", "resolve", "--chain", "eip155:56", "--kind", "token", "--identifier", identifier],
    {}, { stateRoot: temporary.root });
  for (const [identifier, symbol] of [[USDT, "USDT"], [USDC, "USDC"]] as const) {
    const out = await resolve(identifier);
    assert.equal(out.ok, true, JSON.stringify(out));
    const asset = (out.data as { asset: { identifier: string; symbol: string; decimals: number; evidence: Record<string, string> } }).asset;
    assert.deepEqual([asset.identifier, asset.symbol, asset.decimals], [identifier, symbol, 18]);
    assert.match(asset.evidence.issuer!, /^Binance /u);
  }
  assert.deepEqual([(await resolve(USDT.toLowerCase())).error?.details?.reason], ["invalid_token_identifier"], "only the checksummed spelling, as for frozen rows");
  assert.deepEqual([(await resolve("0x1111111111111111111111111111111111111111")).error?.details?.reason], ["unknown_token_deployment"]);
  assert.equal(binancePegPolicyAsset("eip155:1", "token", USDT), undefined, "the same address on another chain is not this token");
  assert.equal(binancePegPolicyAsset("eip155:56", "native", undefined), undefined);
});

test("direct rows and x402 labels name them with 18 decimals", () => {
  assert.deepEqual(directEvmListRows(56).filter((row) => row.kind === "token").map((row) => [row.identifier, row.symbol, row.decimals]),
    [[USDT, "USDT", 18], [USDC, "USDC", 18]]);
  assert.equal(requireListedDirectAsset("eip155:56", { kind: "token", identifier: USDT }).symbol, "USDT");
  assert.equal(x402AssetLabel(56, USDT), `USDT (${USDT}, 18 decimals) on eip155:56`);
});

test("an owner policy admits BNB USDT for Permit2 and the Permit2 lane pays it with the policy row's 18 decimals", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date("2026-11-23T08:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: ACCOUNT }, now, admissions: [
    { chain: "eip155:56", kind: "token", identifier: USDT, rail: "x402", maximumPerTransferAtomic: "10000000000000000",
      dailyLimitAtomic: "50000000000000000", mechanism: X402_PERMIT2_MECHANISM } as never,
    { chain: "eip155:56", kind: "token", identifier: USDC, rail: "direct", maximumPerTransferAtomic: "1000000000000000000",
      dailyLimitAtomic: "2000000000000000000" } as never,
  ] });
  const active = await loadActiveAssetPolicyRegistry(temporary.root, "owner", now);
  assert.ok(active);
  const rows = active.registry.chains.find((chain) => chain.chain === "eip155:56")!.assets;
  assert.deepEqual(rows.map((row) => [row.identifier, row.symbol, row.decimals, row.rails.x402, row.rails.direct]),
    [[USDT, "USDT", 18, true, false], [USDC, "USDC", 18, false, true]]);
  const asset = admittedPermit2Assets(active)("eip155:56", USDT.toLowerCase() as never, { assetTransferMethod: "permit2", name: "Tether USD" });
  assert.deepEqual([asset?.token, asset?.symbol, asset?.decimals, asset?.chainId, asset?.tokenDomain], [USDT, "USDT", 18, 56, null]);
  assert.equal(admittedPermit2Assets(active)("eip155:56", USDC as never, {}), undefined, "USDC is admitted for direct only, not for Permit2");
});
