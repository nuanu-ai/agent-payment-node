import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { loadAllowlistInventory, resolveAllowlistAsset } from "../../src/allowlist-inventory.js";
import { compileAllowlistPolicyOverlayV2 } from "../../src/allowlist-policy-v2.js";
import { requireListedDirectAsset } from "../../src/direct-allowlist-gate.js";
import { listedEvmAsset } from "../../src/evm-direct-allowlist.js";
import { directEvmListRows } from "../../src/evm-direct-networks.js";
import { DIRECT_EVM_SUPPLEMENTAL_ASSETS } from "../../src/evm-direct-supplemental-assets.js";
import { bridgeTokenRow } from "../../src/lifi/asset-registry.js";
import { overlayV2, EVM_OWNER } from "./allowlist-policy-fixtures.js";
import { EVM_REQUEST, evmCore } from "./evm-helpers.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const rows = [
  [1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH", 18],
  [8453, "0x4200000000000000000000000000000000000006", "WETH", 18],
  [42161, "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USDT0", 6],
] as const;
const refusal = (reason: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "details" in error &&
  (error as { details?: { reason?: string } }).details?.reason === reason;

test("three exact direct identities and decimals are listed without changing the frozen inventory", () => {
  const inventory = loadAllowlistInventory();
  assert.equal(DIRECT_EVM_SUPPLEMENTAL_ASSETS.length, 3);
  for (const [chainId, address, symbol, decimals] of rows) {
    const chain = `eip155:${chainId}`, identifier = getAddress(address);
    assert.equal(inventory.assets.some((asset) => asset.chain === chain && asset.identifier === identifier), false);
    assert.deepEqual(directEvmListRows(chainId).filter((asset) => asset.identifier === identifier)
      .map((asset) => [asset.symbol, asset.decimals]), [[symbol, decimals]]);
    assert.deepEqual(listedEvmAsset(chain, address.toLowerCase(), decimals),
      { selection: { chainId, token: identifier, decimals }, decimals });
    assert.equal(requireListedDirectAsset(chain, { kind: "token", identifier }).symbol, symbol);
    assert.throws(() => listedEvmAsset(chain, identifier, decimals === 18 ? 6 : 18), refusal("allowlist_decimals_mismatch"));
    assert.throws(() => resolveAllowlistAsset({ chain, kind: "token", identifier }), { code: "APN_ALLOWLIST_ASSET_NOT_FOUND" });
    for (const [otherChain] of rows) if (otherChain !== chainId) {
      assert.throws(() => listedEvmAsset(`eip155:${otherChain}`, identifier), refusal("allowlist_asset_unlisted"));
    }
  }
  assert.throws(() => listedEvmAsset("eip155:1", "0x0000000000000000000000000000000000000001"), refusal("allowlist_asset_unlisted"));
});

test("owner may compile direct-only policy rows, while x402 and bridge policy rows remain refused", () => {
  for (const [chainId, address, symbol, decimals] of rows) {
    const chain = `eip155:${chainId}`, identifier = getAddress(address);
    const admission = { chain, kind: "token" as const, identifier, rail: "direct" as const,
      maximumPerTransferAtomic: "1", dailyLimitAtomic: "2" };
    const input = overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [admission] });
    const asset = compileAllowlistPolicyOverlayV2(input).registry.chains[0]!.assets[0]!;
    assert.deepEqual([asset.identifier, asset.symbol, asset.decimals, asset.rails.direct], [identifier, symbol, decimals, true]);
    for (const rail of ["x402", "bridge"] as const) {
      assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [
        { ...admission, rail, mechanism: { provider: "test", reference: "test" } },
      ] })), { code: "APN_ALLOWLIST_ASSET_NOT_FOUND" });
    }
    assert.throws(() => bridgeTokenRow(chainId, identifier), /asset_not_on_frozen_list/u);
  }
});

test("direct prepare reaches the owner-policy gate before any RPC for supplemental assets", async (t) => {
  for (const [chainId, address] of rows) {
    const state = await temporaryState(); t.after(state.cleanup);
    const setup = evmCore(state.root); await setup.core.wallet.ensure("default");
    await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: getAddress(address) },
      idempotencyKey: `supplemental-${chainId}` }), refusal("allowlist_policy_required"));
    assert.equal(setup.rpc.genericBalanceCalls, 0);
  }
});

test("owner-admitted supplemental rows prepare with exact token decimals and no submission", async (t) => {
  for (const [chainId, address, , decimals] of rows) {
    const state = await temporaryState(); t.after(state.cleanup);
    const setup = evmCore(state.root);
    const wallet = await setup.core.wallet.ensure("default") as { address: `0x${string}` };
    const identifier = getAddress(address);
    setup.rpc.chainId = chainId; setup.rpc.decimals = decimals; setup.rpc.sender = wallet.address;
    if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
    await activateDirectPolicy(state.root, "default", { accounts: { evm: wallet.address }, admissions: [
      directAdmission(`eip155:${chainId}`, identifier),
    ], now: setup.clock.now() });
    const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: identifier },
      amount: decimals === 18 ? "0.000001" : "0.01", idempotencyKey: `supplemental-admitted-${chainId}` }) as {
        asset: { contract: string; decimals: number }; amount: { atomic: string };
      };
    assert.deepEqual([prepared.asset.contract, prepared.asset.decimals, prepared.amount.atomic],
      [identifier, decimals, decimals === 18 ? "1000000000000" : "10000"]);
    assert.equal(setup.rpc.submissions.length, 0);
  }
});
