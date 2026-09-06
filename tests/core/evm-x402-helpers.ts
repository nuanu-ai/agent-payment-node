import * as coreRuntime from "../../src/core.js";
import { testRuntime } from "./installed-runtime.js";
import * as policyRuntime from "../../src/encrypted-profile-policy.js";
import type { EvmChainId } from "../../src/evm-asset.js";
import * as nativeRuntime from "../../src/local-wallet-native.js";
import type { NativePort, NativeRequest } from "../../src/ports.js";
import type { ProfilePolicyApprovalIntent } from "../../src/policy-approval.js";
import { StateStore } from "../../src/state.js";
import { x402Network } from "../../src/x402-network.js";
import { tokenDomainSeparator } from "../../src/x402-policy.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { EvmApproval, EvmWrappingSecret } from "./evm-helpers.js";
import { TestClock } from "./helpers.js";
import { QueuedHttp, RecoveryRpc, authorizationUsedLog, challengeObservation, paidObservation, transferLog } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_REQUIREMENTS, X402_TRANSACTION, canonicalPaymentRequiredHeader, canonicalPaymentResponseHeader, paymentIdentifierDeclaration } from "./x402-vectors.js";

const { ApnCore } = await testRuntime(coreRuntime, "core.js");
const { EncryptedProfilePolicy } = await testRuntime(policyRuntime, "encrypted-profile-policy.js");
const { LocalWalletNative } = await testRuntime(nativeRuntime, "local-wallet-native.js");

export const NETWORK_LIMITS = { maxBalanceUsdcAtomic: "100000000", maxX402AmountAtomic: "10000000" };

export function networkChallenge(chainId: EvmChainId = 1, paymentIdentifier = false) {
  const selected = x402Network(chainId);
  return challengeObservation({ header: canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED, ...(paymentIdentifier ? { extensions: { "payment-identifier": paymentIdentifierDeclaration(false) } } : {}), accepts: [{ ...X402_REQUIREMENTS, network: selected.network, asset: selected.token, maxTimeoutSeconds: 300 }],
  }) });
}

export function networkPaid(operation: X402OperationRecord) {
  const now = new Date().toISOString();
  return paidObservation({ startedAt: now, observedAt: now, paymentResponseHeader: canonicalPaymentResponseHeader({
    success: true, transaction: X402_TRANSACTION, network: operation.network, payer: operation.wallet, amount: operation.amountAtomic,
  }) });
}

export function networkSettlement(rpc: RecoveryRpc, operation: X402OperationRecord, token = operation.token): void {
  rpc.authorizationStateValue = true;
  const identity = { transactionHash: X402_TRANSACTION as `0x${string}`, blockNumber: rpc.safeHead.number, blockHash: rpc.safeHead.hash };
  rpc.x402Receipt = {
    ...identity, status: "success", rpcOrigin: rpc.rpcOrigin, observedAt: rpc.safeHead.observedAt,
    logs: [
      { ...authorizationUsedLog({ ...identity, authorizer: operation.wallet, nonce: operation.authorization.nonce }), address: token },
      { ...transferLog({ ...identity, from: operation.wallet, to: operation.payee, value: operation.amountAtomic }), address: token },
    ],
  };
}

export function networkFixture(root: string, chainId: EvmChainId = 1, wrapNative?: (native: NativePort) => NativePort) {
  const state = new StateStore(root), clock = new TestClock(), rpc = new RecoveryRpc(), wrapping = new EvmWrappingSecret();
  clock.value = new Date(); rpc.chainId = chainId;
  const now = clock.now().toISOString(), timestamp = Math.floor(clock.now().getTime() / 1000).toString();
  rpc.safeHead = { ...rpc.safeHead, observedAt: now, timestamp };
  rpc.finalizedHead = { ...rpc.finalizedHead, observedAt: now, timestamp: (BigInt(timestamp) - 1n).toString() };
  rpc.x402Evidence = { ...rpc.x402Evidence, observedAt: now, domainSeparator: tokenDomainSeparator("USD Coin", "2", chainId), block: { ...rpc.x402Evidence.block, timestamp } };
  const originalEvidence = rpc.getX402PrepareEvidence.bind(rpc);
  rpc.getX402PrepareEvidence = async (address) => ({ ...await originalEvidence(address), address });
  const policyApprovals: ProfilePolicyApprovalIntent[] = [];
  const policy = new EncryptedProfilePolicy(state, wrapping, { approve: async (intent) => { policyApprovals.push(intent); } }, clock);
  const local = new LocalWalletNative(state, wrapping, new EvmApproval());
  const nativeCalls: NativeRequest[] = [];
  const wrapped = wrapNative?.(local) ?? local;
  const native: NativePort = { request: async (request) => { nativeCalls.push(request); return await wrapped.request(request); } };
  const http = new QueuedHttp([networkChallenge(chainId)]);
  const core = new ApnCore({ state, clock, rpc, native, http, policy });
  return { state, clock, rpc, wrapping, policy, policyApprovals, native, nativeCalls, http, core };
}

export async function initializeNetworkFixture(fixture: ReturnType<typeof networkFixture>, chainId: EvmChainId = 1) {
  await fixture.core.wallet.ensure("default");
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId, ...NETWORK_LIMITS });
}
