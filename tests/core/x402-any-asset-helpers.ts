import * as coreRuntime from "../../src/core.js";
import { testRuntime } from "./installed-runtime.js";
import * as policyRuntime from "../../src/encrypted-profile-policy.js";
import * as nativeRuntime from "../../src/local-wallet-native.js";
import type { Address, Hex } from "../../src/model.js";
import type { NativePort, NativeRequest, X402AuthorizationState, X402BlockReference, X402PrepareEvidence } from "../../src/ports.js";
import type { X402Permit2PrepareEvidence } from "../../src/x402-permit2-rpc.js";
import type { ProfilePolicyApprovalIntent } from "../../src/policy-approval.js";
import { StateStore } from "../../src/state.js";
import { x402Asset, type X402Asset } from "../../src/x402-network.js";
import { tokenDomainSeparator } from "../../src/x402-policy.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { EvmApproval, EvmWrappingSecret } from "./evm-helpers.js";
import { TestClock } from "./helpers.js";
import { QueuedHttp, RecoveryRpc, authorizationUsedLog, challengeObservation, transferLog } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_REQUIREMENTS, X402_TRANSACTION, canonicalPaymentRequiredHeader } from "./x402-vectors.js";

const { ApnCore } = await testRuntime(coreRuntime, "core.js");
const { EncryptedProfilePolicy } = await testRuntime(policyRuntime, "encrypted-profile-policy.js");
const { LocalWalletNative } = await testRuntime(nativeRuntime, "local-wallet-native.js");

export const ASSET_LIMITS = { maxBalanceUsdcAtomic: "100000000", maxX402AmountAtomic: "10000000" };

/** Real token identities from the public x402 discovery catalog (2026-10-20); everything chain-side here is synthetic. */
export interface AssetCase {
  readonly label: string; readonly chainId: number; readonly token: Address;
  readonly name: string; readonly version: string; readonly decimals: number;
}
export const ASSET_CASES: readonly AssetCase[] = [
  { label: "Polygon USDC", chainId: 137, token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", name: "USD Coin", version: "2", decimals: 6 },
  { label: "Monad USDC", chainId: 143, token: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", name: "USDC", version: "2", decimals: 6 },
  { label: "World Chain USDC", chainId: 480, token: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", name: "USDC", version: "2", decimals: 6 },
  { label: "Base MXNB", chainId: 8453, token: "0xF197FFC28c23E0309B5559e7a166f2c6164C80aA", name: "MXNB", version: "2", decimals: 6 },
  { label: "BNB World Liberty USD1", chainId: 56, token: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", name: "World Liberty Financial USD", version: "1", decimals: 18 },
];

/** Recovery RPC bound to one token: records the token it was bound to and the nonce prepare probed. */
export class AssetRpc extends RecoveryRpc {
  readonly boundTokens: string[] = [];
  readonly probedNonces: (Hex | undefined)[] = [];
  tokenFacts: X402PrepareEvidence["tokenFacts"];
  /** Permit2 offers: allowance to Permit2, the token's permit facts when asked, and the Permit2 nonce bit. */
  permit2 = { allowanceAtomic: "50000000", permit: { domainSeparator: `0x${"0".repeat(64)}` as Hex, nonce: "9" }, used: false, permitReads: 0 };
  async getX402Permit2PrepareEvidence(address: Address, nonce: Hex, permitNeeded: (allowanceAtomic: string) => boolean): Promise<X402Permit2PrepareEvidence> {
    this.x402PrepareCalls += 1; this.probedNonces.push(nonce);
    const needed = permitNeeded(this.permit2.allowanceAtomic);
    if (needed) this.permit2.permitReads += 1;
    return { address, usdcAtomic: this.x402Evidence.usdcAtomic, allowanceAtomic: this.permit2.allowanceAtomic, rpcOriginHash: this.x402Evidence.rpcOriginHash,
      observedAt: this.x402Evidence.observedAt, queriedTag: this.x402Evidence.queriedTag, block: { ...this.x402Evidence.block },
      tokenFacts: { decimals: this.tokenFacts?.decimals ?? 6, nonceUnused: true }, ...(needed ? { permit: { ...this.permit2.permit } } : {}) };
  }
  async getX402Permit2NonceState(owner: Address, nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState> {
    const state = await this.getX402AuthorizationState(owner, nonce, block);
    this.x402Calls.push(`permit2:${"tag" in block ? block.tag : block.number}`);
    return { ...state, value: this.permit2.used };
  }
  override forX402Network(chainId: number, token?: Address): RecoveryRpc {
    this.boundTokens.push(String(token));
    return super.forX402Network(chainId as never);
  }
  override async getX402PrepareEvidence(address: Address, nonce?: Hex): Promise<X402PrepareEvidence> {
    this.probedNonces.push(nonce);
    const evidence = await super.getX402PrepareEvidence(address);
    return { ...evidence, address, ...(this.tokenFacts === undefined ? {} : { tokenFacts: this.tokenFacts }) };
  }
}

export function assetOf(spec: AssetCase): X402Asset { return x402Asset(spec.chainId, spec.token); }

export function assetChallenge(spec: AssetCase, extra: Record<string, unknown> = {}) {
  return challengeObservation({ header: canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    accepts: [{ ...X402_REQUIREMENTS, network: `eip155:${spec.chainId}`, asset: spec.token, maxTimeoutSeconds: 300,
      extra: { name: spec.name, version: spec.version, ...extra } }],
  } as never) });
}

export function assetFixture(root: string, spec: AssetCase, options: { readonly rpc?: boolean } = {}) {
  const asset = assetOf(spec);
  const state = new StateStore(root), clock = new TestClock(), rpc = new AssetRpc(), wrapping = new EvmWrappingSecret();
  clock.value = new Date(); rpc.chainId = spec.chainId;
  const now = clock.now().toISOString(), timestamp = Math.floor(clock.now().getTime() / 1000).toString();
  rpc.safeHead = { ...rpc.safeHead, observedAt: now, timestamp };
  rpc.finalizedHead = { ...rpc.finalizedHead, observedAt: now, timestamp: (BigInt(timestamp) - 1n).toString() };
  // Prepare reads at the asset's proof tag; the evidence block is that head.
  const head = asset.proofTag === "safe" ? rpc.safeHead : rpc.finalizedHead;
  rpc.x402Evidence = { ...rpc.x402Evidence, observedAt: now, queriedTag: asset.proofTag,
    domainSeparator: tokenDomainSeparator(spec.name, spec.version, asset),
    block: { number: head.number, hash: head.hash, timestamp: head.timestamp } };
  rpc.tokenFacts = { decimals: spec.decimals, nonceUnused: true };
  const policyApprovals: ProfilePolicyApprovalIntent[] = [];
  const policy = new EncryptedProfilePolicy(state, wrapping, { approve: async (intent) => { policyApprovals.push(intent); } }, clock);
  const local = new LocalWalletNative(state, wrapping, new EvmApproval());
  const nativeCalls: NativeRequest[] = [];
  const native: NativePort = { request: async (request) => { nativeCalls.push(request); return await local.request(request); } };
  const http = new QueuedHttp([assetChallenge(spec)]);
  const core = new ApnCore({ state, clock, ...(options.rpc === false ? {} : { rpc }), native, http, policy });
  return { asset, state, clock, rpc, wrapping, policy, policyApprovals, native, nativeCalls, http, core };
}

export async function admitAsset(fixture: ReturnType<typeof assetFixture>, spec: AssetCase): Promise<void> {
  await fixture.core.wallet.ensure("default");
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId: spec.chainId, asset: spec.token, ...ASSET_LIMITS });
}

/** The token's nonce reads used at the record's proof tag, with a receipt of this token's exact logs. */
export function assetSettlement(rpc: AssetRpc, operation: X402OperationRecord): void {
  rpc.authorizationStateValue = true;
  const head = operation.tokenFacts?.proofTag === "finalized" ? rpc.finalizedHead : rpc.safeHead;
  const identity = { transactionHash: X402_TRANSACTION as `0x${string}`, blockNumber: head.number, blockHash: head.hash };
  rpc.x402Receipt = {
    ...identity, status: "success", rpcOrigin: rpc.rpcOrigin, observedAt: head.observedAt,
    logs: [
      { ...authorizationUsedLog({ ...identity, authorizer: operation.wallet, nonce: operation.authorization.nonce }), address: operation.token },
      { ...transferLog({ ...identity, from: operation.wallet, to: operation.payee, value: operation.amountAtomic }), address: operation.token },
    ],
  };
}
