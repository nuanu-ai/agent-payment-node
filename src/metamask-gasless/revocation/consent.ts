import { approvalCode } from "../../approval-code.js";
import { hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { directEvmNetwork } from "../../evm-direct-networks.js";
import { exactChainConsent, TTY_APPROVAL_DEADLINE_MS, type TtyTransferApprovalOptions } from "../../tty-approval.js";
import type { MetaMaskDisableCall } from "./call.js";
import type { MetaMaskRevocationChain } from "./chain.js";

/** Everything the owner confirms; the code binds the screen to the exact call and its gas fields. */
export interface MetaMaskRevocationSummary {
  readonly operationId: string;
  readonly chainId: number;
  readonly call: MetaMaskDisableCall;
  readonly chain: MetaMaskRevocationChain;
  readonly fingerprint: string;
  readonly exactPhrase: string;
}
export interface MetaMaskRevocationApprovalPort { confirm(summary: MetaMaskRevocationSummary): Promise<boolean> }

export function metaMaskRevocationSummary(operationId: string, chainId: number, call: MetaMaskDisableCall,
  chain: MetaMaskRevocationChain): MetaMaskRevocationSummary {
  const fingerprint = hashObject({ purpose: "apn.metamask-gasless.disable-consent.v1", operationId, chainId, callHash: call.callHash,
    nonceAtomic: chain.nonceAtomic, gasLimitAtomic: chain.gasLimitAtomic, maxFeePerGasAtomic: chain.maxFeePerGasAtomic,
    maxPriorityFeePerGasAtomic: chain.maxPriorityFeePerGasAtomic, maximumNativeCostWei: chain.maximumNativeCostWei });
  return { operationId, chainId, call, chain, fingerprint, exactPhrase: approvalCode("delegation-disable", operationId, fingerprint) };
}

export class TtyMetaMaskRevocationApproval implements MetaMaskRevocationApprovalPort {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async confirm(s: MetaMaskRevocationSummary): Promise<boolean> {
    const network = directEvmNetwork(s.chainId as Parameters<typeof directEvmNetwork>[0]), c = s.chain;
    const lines = ["Agent Payment Node — disable one MetaMask delegation (no payment)",
      `Operation: ${s.operationId}`, `Chain: eip155:${s.chainId}; network: ${network.name}`,
      `Server wallet (delegator, signs and pays gas): ${s.call.from}`, `DelegationManager: ${s.call.to}`,
      `Delegation hash: ${s.call.delegationHash}`, `Call: disableDelegation(that delegation); value 0`,
      "Effect: no relayer can redeem this delegation afterwards, unless this same wallet later calls enableDelegation.",
      "It moves no USDC. If the delegation is redeemed before this call lands, the payment stands and resume proves it.",
      `Nonce: ${c.nonceAtomic}; gas limit: ${c.gasLimitAtomic}; max fee per gas: ${c.maxFeePerGasAtomic} wei; priority fee: ${c.maxPriorityFeePerGasAtomic} wei`,
      ...(c.l1FeeUpperWei === "0" && c.operatorFeeUpperWei === "0" ? [] :
        [`L1 data fee upper bound: ${c.l1FeeUpperWei} wei; operator fee upper bound: ${c.operatorFeeUpperWei} wei (not enforced by the transaction)`]),
      `Maximum ${network.nativeSymbol} gas cost: ${c.maximumNativeCostWei} wei; wallet balance: ${c.nativeBalanceWei} wei`,
      "The MetaMask Agent Wallet signs and sends it; MetaMask may ask you to confirm it by MFA.",
      `Read at block ${c.latest.numberAtomic}; finality block ${c.finality.numberAtomic} shows the delegation unredeemed and not disabled.`,
      `Fingerprint: ${s.fingerprint}`];
    const expiresAt = new Date(Date.now() + TTY_APPROVAL_DEADLINE_MS).toISOString();
    try { await exactChainConsent(lines, s.exactPhrase, expiresAt, this.options); return true; }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode === "APN_APPROVAL_REFUSED") return false;
      throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Confirm the delegation disable in a foreground terminal.",
        { reason: "mm_revoke_approval", nextActions: [`apn gasless transfer revoke --operation ${s.operationId}`] });
    }
  }
}
