import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdt, type UsdtPolicyPrepareRequest, type UsdtPreparePort } from "../../src/gasless-usdt/policy-prepare.js";
import type { UsdtSponsorPort } from "../../src/gasless-usdt/engine.js";
import type { UsdtUserOperation } from "../../src/gasless-usdt/userop.js";

const OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
const NOW = new Date((0x6aacecdb - 300) * 1000);
const QUOTE = { quotes: [{ paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token, postOpGas: "0x4c2c",
  exchangeRate: "0xa38ca6e3", exchangeRateNativeToUsd: "0x948f68af", balanceSlot: "0x2", allowanceSlot: "0x5" }] };
const PRICE = { slow: { maxFeePerGas: "0x10ef719d", maxPriorityFeePerGas: "0xbb0de7a" },
  standard: { maxFeePerGas: "0x11c8374b", maxPriorityFeePerGas: "0xc468333" },
  fast: { maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec" } };
const SIGNED = { paymaster: USDT_GASLESS.paymaster, paymasterData: "0x020000006aacecdb000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000004c2c00000000000000000000000000000000000000000000000000000000a380509a000000000000000000000000000138804337ff05c84b9a80ea0a78dbe7b8e102f66d4c08972391719016554aea7ecb13e50f38e455f67da2908c40238d37d162d3f3dc686067c76c198b6239400746330724b6191afa40a35538022086b0288210f55e1c1c" };
const request = (): UsdtPolicyPrepareRequest => ({ profile: "owner", chain: "eip155:1", token: USDT_GASLESS.token,
  sponsorUrl: USDT_GASLESS.bundlerUrl, sender: OWNER, recipient: RECIPIENT, grossAtomic: 1_000_000n,
  maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n });
function active(options: { per?: string; daily?: string; mechanism?: { provider: string; reference: string }; owner?: typeof OWNER } = {}): ActiveAssetPolicy {
  const unsigned: UnsignedAssetPolicyRegistry = { schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "owner.1",
    publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: USDT_GASLESS.token,
      symbol: "USDT", decimals: 6, rails: { direct: false, gasless: true, x402: false, bridge: false, swap: false },
      railCaps: { gasless: { maximumPerTransferAtomic: options.per ?? "1000000", dailyLimitAtomic: options.daily ?? "2000000" } },
      mechanismPins: { gasless: options.mechanism ?? USDT_GASLESS.mechanism } }] }] };
  const registry = sealAssetPolicyRegistry(unsigned);
  return { profile: "owner", registry, digest: registry.policyDigest, revision: 1, activationDigest: "a".repeat(64),
    accounts: { evm: options.owner ?? OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" };
}
function fixture() {
  let current: ActiveAssetPolicy | null = active(), usage = "0", quote = QUOTE, price = PRICE;
  const offered: UsdtUserOperation[] = [];
  const prepare: UsdtPreparePort = { now: () => NOW, activePolicy: async () => current, dailyUsage: async () => usage,
    safeSnapshot: async () => ({ chainId: 1n, blockNumber: 26_002_950n, blockHash: `0x${"12".repeat(32)}`,
      account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation: "empty" } }) };
  const sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData"> = { tokenQuote: async () => quote,
    gasPrice: async () => price, paymasterData: async op => { offered.push(op); return SIGNED; } };
  return { ports: { prepare, sponsor }, offered, setPolicy: (value: ActiveAssetPolicy | null) => { current = value; },
    setUsage: (value: string) => { usage = value; }, setQuote: (value: typeof QUOTE) => { quote = value; },
    setPrice: (value: typeof PRICE) => { price = value; } };
}

test("policy prepare freezes owner, safe block, exact approval sequence and sponsored unsigned operation", async () => {
  const f = fixture();
  const result = await preparePolicyBoundUsdt(f.ports, request());
  assert.equal(result.policyDigest, active().digest);
  assert.equal(result.safeBlockNumber, "26002950");
  assert.match(result.bindingHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.plan.feeCapAtomic, 500_000n);
  assert.equal(result.plan.netAtomic, 500_000n);
  assert.equal(result.unsignedOperation.callData, result.callData);
  assert.equal(f.offered.length, 1);
  assert.equal(f.offered[0]?.callData, result.callData);
  assert.equal(f.offered[0]?.nonce, "0x7");
  const batch = decodeFunctionData({ abi: parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]), data: result.callData });
  assert.equal(batch.functionName, "executeBatch");
  const calls = batch.args![0];
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.target), [USDT_GASLESS.token, USDT_GASLESS.token, USDT_GASLESS.token]);
  assert.deepEqual(calls.map(call => call.value), [0n, 0n, 0n]);
  const abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
  assert.deepEqual(calls.map(call => decodeFunctionData({ abi, data: call.data }).args),
    [[USDT_GASLESS.paymaster, 0n], [USDT_GASLESS.paymaster, 500_000n], [RECIPIENT, 500_000n]]);
});

test("policy prepare refuses missing policy, wrong owner or mechanism, and both owner caps before sponsor reads", async () => {
  for (const policy of [null, active({ owner: RECIPIENT }), active({ mechanism: { ...USDT_GASLESS.mechanism, provider: "other" } }),
    active({ per: "999999" }), active({ daily: "1000000" })]) {
    const f = fixture(); f.setPolicy(policy);
    if (policy !== null && policy.registry.chains[0]!.assets[0]!.railCaps?.gasless?.dailyLimitAtomic === "1000000") f.setUsage("1");
    await assert.rejects(() => preparePolicyBoundUsdt(f.ports, request()));
    assert.equal(f.offered.length, 0);
  }
});

test("policy prepare rejects wrong route and quote drift, and rechecks revoked policy after sponsor data", async () => {
  const route = fixture();
  await assert.rejects(() => preparePolicyBoundUsdt(route.ports, { ...request(), sponsorUrl: "https://other.invalid" }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(route.offered.length, 0);
  const drift = fixture();
  let quoteReads = 0;
  drift.ports.sponsor.tokenQuote = async () => ++quoteReads === 1 ? QUOTE : { quotes: [{ ...QUOTE.quotes[0], exchangeRate: "0xa38ca6e4" }] };
  await assert.rejects(() => preparePolicyBoundUsdt(drift.ports, request()), /quote_drift/u);
  const revoked = fixture();
  revoked.ports.sponsor.paymasterData = async op => { revoked.offered.push(op); revoked.setPolicy(null); return SIGNED; };
  await assert.rejects(() => preparePolicyBoundUsdt(revoked.ports, request()), { code: "APN_ALLOWLIST_REFUSED" });
});
