import { concat, getAddress, padHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { usdtSponsorHash } from "../../src/gasless-usdt/sponsor-hash.js";
import { attestUsdtSponsor } from "../../src/gasless-usdt/sponsor-auth.js";
import { mintUsdtSponsorPermit } from "../../src/gasless-usdt/sponsor-permit.js";
import type { UsdtPreparePort, UsdtPolicyPrepareRequest } from "../../src/gasless-usdt/policy-prepare.js";
import type { UsdtSponsorPort } from "../../src/gasless-usdt/engine.js";
import type { UsdtUserOperation } from "../../src/gasless-usdt/userop.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
export const V2_KEY = `0x${"01".repeat(32)}` as const;
export const V2_OWNER = privateKeyToAccount(V2_KEY).address;
export const V2_RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
export const V2_NOW = new Date(1_800_000_000_000);
const sponsorKey = privateKeyToAccount(`0x${"11".repeat(32)}`);
const word = (v: bigint, size = 32): Hex => padHex(`0x${v.toString(16)}`, { size });
export class V2Wrapping implements WrappingSecretPort {
  loads = 0; onLoad: (() => Promise<void>) | undefined;
  async load() { this.loads++; await this.onLoad?.(); return Buffer.alloc(32, 17); }
  async create() { return Buffer.alloc(32, 17); }
}
export function v2Fixture(delegation: "empty" | "expected" = "empty", mode = "02") {
  let milliseconds = V2_NOW.getTime(), quoteCount = 0, priceCount = 0;
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "owner.1",
    publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: USDT_GASLESS.token,
      symbol: "USDT", decimals: 6, rails: { direct: true, gasless: true, x402: false, bridge: false, swap: false },
      railCaps: { direct: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" }, gasless: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
      mechanismPins: { gasless: USDT_GASLESS.mechanism } }] }] } satisfies UnsignedAssetPolicyRegistry);
  const f = { signedRate: 2_989_469_350n, signedPostOp: 19500n, initialRate: 9_000_000_000n,
    member: true, parity: true, snapshots: 0, reads: [] as unknown[][], secretWindowDelay: 0,
    current: { profile: "owner", registry, digest: registry.policyDigest, revision: 1, activationDigest: "a".repeat(64),
      accounts: { evm: V2_OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" } as ActiveAssetPolicy | null,
    usage: "0", offered: [] as UsdtUserOperation[], now: () => new Date(milliseconds), advance: (ms: number) => { milliseconds += ms; },
    snapshot: { chainId: 1n, blockNumber: 26_002_950n, blockHash: `0x${"12".repeat(32)}` as Hex,
      account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation },
      pins: { token: USDT_GASLESS.tokenCodeHash, entryPoint: USDT_GASLESS.entryPointCodeHash, delegate: USDT_GASLESS.delegateCodeHash,
        paymaster: USDT_GASLESS.paymasterCodeHash, paymasterEntryPoint: USDT_GASLESS.entryPoint } },
  };
  let authOp: UsdtUserOperation;
  const transport: GaslessTransport = { request: async (_url, _method, body) => {
    const batch = JSON.parse(body!) as { id: string; method: string; params: unknown[] }[]; f.reads.push(batch);
    return { status: 200, body: JSON.stringify(batch.map((r, i) => ({ jsonrpc: "2.0", id: r.id,
      result: i === 0 ? word(f.member ? 1n : 0n) : f.parity ? usdtSponsorHash(authOp) : `0x${"00".repeat(32)}` }))) };
  } };
  const prepare: UsdtPreparePort = { now: f.now, activePolicy: async () => f.current, dailyUsage: async () => f.usage,
    safeSnapshot: async () => { f.snapshots++; return f.snapshot; },
    sponsorAuth: async (op, snapshot) => { authOp = op; return await attestUsdtSponsor({ op, snapshot, expectedBlockHash: snapshot.blockHash,
      transport, rpcUrl: "https://rpc.test/", clock: { now: f.now } }); },
    sponsorPermit: async (bound, identity, snapshot) => { authOp = bound.binding.unsignedOperation;
      return await mintUsdtSponsorPermit({ bound, identity, snapshot, transport, rpcUrl: "https://rpc.test/", clock: { now: f.now } }); },
  };
  const tier = (fee: bigint) => ({ maxFeePerGas: `0x${fee.toString(16)}`, maxPriorityFeePerGas: "0x7270e00" });
  const sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData"> = {
    tokenQuote: async () => ({ quotes: [{ paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token,
      postOpGas: "0x4c2c", exchangeRate: `0x${(quoteCount++ === 0 ? f.initialRate : 3_000_000_000n).toString(16)}`,
      exchangeRateNativeToUsd: quoteCount === 1 ? "0xa0000000" : "0xa0000001", balanceSlot: "0x2", allowanceSlot: "0x5" }] }),
    gasPrice: async () => { const fast = tier(priceCount++ === 0 ? 305256480n : 297978797n); return { slow: tier(290000000n), standard: fast, fast }; },
    paymasterData: async op => {
      f.offered.push(op);
      const data = concat([`0x${mode}00`, word(BigInt(V2_NOW.getTime() / 1000) + 300n, 6), word(0n, 6), USDT_GASLESS.token,
        word(f.signedPostOp, 16), word(f.signedRate), word(80000n, 16), USDT_GASLESS.treasury, `0x${"00".repeat(64)}1b`]);
      const signature = await sponsorKey.signMessage({ message: { raw: usdtSponsorHash({ ...op, paymasterData: data, signature: "0x" }) } });
      return { paymaster: USDT_GASLESS.paymaster, paymasterData: `${data.slice(0, -130)}${signature.slice(2)}` };
    },
  };
  const request: UsdtPolicyPrepareRequest = { profile: "owner", chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
    sponsorUrl: USDT_GASLESS.bundlerUrl, sender: V2_OWNER, recipient: V2_RECIPIENT, grossAtomic: 1_000_000n, maxFeeAtomic: 999999n, minReceivedAtomic: 1n };
  return { ...f, prepare, sponsor, request, transport, state: f };
}
