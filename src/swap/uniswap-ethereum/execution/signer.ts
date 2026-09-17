import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../../encrypted-wallet-store.js";
import { ApnError } from "../../../errors.js";
import type { WrappingSecretPort } from "../../../macos-keychain.js";
import type { StateStore } from "../../../state.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import { validateUniswapExecutionBinding, verifySignedUniswapTransaction } from "./binding.js";
import { newUniswapExecutionEffect } from "./effect-store.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionEffect,
  UniswapExecutionSignerPort, UniswapOwnerAdmission } from "./types.js";

/** Opens APN's encrypted local EVM wallet only inside the bounded signing call. */
export class LocalUniswapEthereumSigner implements UniswapExecutionSignerPort {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly effects: UniswapEffectStorePort) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
  }

  async sign(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding,
    admission: UniswapOwnerAdmission, now: Date): Promise<UniswapExecutionEffect> {
    const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation), at = instant(now);
    if (operation.state !== "submitting" || operation.submissionMarker === null || at >= operation.quote.expiresAt ||
        admission.profile !== operation.quote.profile || admission.profileHash !== operation.ownerProfileHash || admission.account !== operation.quote.account ||
        admission.walletBindingHash !== binding.walletBindingHash || admission.walletCreatedAt !== binding.walletCreatedAt ||
        admission.admissionHash !== binding.ownerAdmissionHash) blocked("Uniswap signing gate or owner admission changed.", "uniswap_signing_gate");
    return await this.state.withLocks([`uniswap-sign:${operation.operationId}`], async () => {
      const existing = await this.effects.load(operation, binding); if (existing !== null) return existing;
      const wallet = await this.wallets.describe(operation.quote.profile);
      if (wallet === null) blocked("The admitted encrypted EVM wallet is unavailable.", "uniswap_wallet_missing");
      try {
        if (wallet.identity.profile !== admission.profile || wallet.identity.address !== admission.account ||
            wallet.identity.bindingHash !== admission.walletBindingHash || wallet.identity.createdAt !== admission.walletCreatedAt) {
          throw new ApnError("APN_WALLET_MISMATCH", "Encrypted EVM wallet no longer matches Uniswap owner admission.");
        }
        const nonce = BigInt(binding.nonce); if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) blocked("Uniswap nonce exceeds signer bounds.", "uniswap_nonce_bound");
        const account = privateKeyToAccount(wallet.secret.privateKey), e = binding.envelope;
        if (getAddress(account.address) !== binding.account) throw new ApnError("APN_WALLET_MISMATCH", "Uniswap signer address changed.");
        const raw = e.gasPrice !== undefined
          ? await account.signTransaction({ type: "legacy", chainId: 1, to: e.to, data: e.data, value: BigInt(e.value),
            nonce: Number(nonce), gas: BigInt(e.gasLimit), gasPrice: BigInt(e.gasPrice) })
          : await account.signTransaction({ type: "eip1559", chainId: 1, to: e.to, data: e.data, value: BigInt(e.value),
            nonce: Number(nonce), gas: BigInt(e.gasLimit), maxFeePerGas: BigInt(e.maxFeePerGas!),
            maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGas!), accessList: [] });
        const transactionHash = await verifySignedUniswapTransaction(raw, binding, operation);
        return await this.effects.seal(operation, binding, newUniswapExecutionEffect({ operationId: operation.operationId,
          profileHash: operation.ownerProfileHash, bindingHash: binding.bindingHash, envelopeHash: binding.envelopeHash,
          submissionMarkerHash: binding.submissionMarkerHash, rawTransaction: raw as Hex, transactionHash,
          phase: "sealed", sendAttempts: 0, sealedAt: at, updatedAt: at }));
      } finally { this.wallets.clear(wallet.secret); }
    });
  }
}

function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ApnError("APN_INVALID_INPUT", "Uniswap signing time is invalid."); return value.toISOString(); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
