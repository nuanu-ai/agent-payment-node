import { ApnError } from "./errors.js";
import { requireDirectEvmReads, requireEvmFunding, evmTransaction } from "./evm-direct.js";
import type { Economics, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { validateEconomics } from "./transfer-policy.js";
import { occupiedUniswapTokenNonces } from "./swap/uniswap-v3/token-nonce-ownership.js";

/** The frozen signed envelope still lands: same nonce, gas within the signed limit, and today's base fee within the signed max fee. */
export function frozenEconomicsRemainExecutable(current: Economics, frozen: Economics): boolean {
  const freshMaximumFee = BigInt(current.maxFeePerGasAtomic);
  const freshPriorityFee = BigInt(current.maxPriorityFeePerGasAtomic);
  const freshBaseFeeTwice = freshMaximumFee - freshPriorityFee;
  if (freshBaseFeeTwice < 0n || freshBaseFeeTwice % 2n !== 0n) return false;
  const freshBaseFee = freshBaseFeeTwice / 2n;
  return current.nonceAtomic === frozen.nonceAtomic &&
    BigInt(current.gasLimitAtomic) <= BigInt(frozen.gasLimitAtomic) &&
    freshBaseFee <= BigInt(frozen.maxFeePerGasAtomic);
}

/**
 * The one pre-sign check of a frozen transfer: balance, pending nonce, estimate and the fee quote, read in two POSTs
 * (three on OP-stack networks). It runs before signing only; nothing re-reads funding once a signature exists, because the
 * chain itself enforces nonce and balance and the signed gas limit and max fee bound what the transaction may cost.
 */
export async function checkEvmTransferFunding(rpcPort: RpcPort, operation: OperationRecord, stateRoot?: string): Promise<void> {
  const binding = operation.evm;
  if (binding === undefined || operation.economics === undefined) throw new ApnError("APN_STATE_CORRUPT", "Generic operation has no frozen asset economics.");
  const asset = binding.asset, reads = requireDirectEvmReads(rpcPort, operation.chainId);
  const balance = await reads.balance(operation.walletAddress, {
    chainId: operation.chainId, token: asset.kind === "native" ? "native" : asset.address, decimals: asset.decimals,
  });
  if (balance.address !== operation.walletAddress || balance.asset.chainId !== asset.chainId ||
      balance.asset.kind !== asset.kind || balance.asset.address !== asset.address || balance.asset.decimals !== asset.decimals) {
    throw new ApnError("APN_ASSET_MISMATCH", "Current balance does not match the approved frozen asset.");
  }
  const { nonce, estimated } = await reads.nonceEstimate(operation.walletAddress,
    evmTransaction(asset, operation.walletAddress, operation.recipient, operation.amountAtomic));
  let executableNonce = BigInt(nonce); if (operation.chainId === 1 && stateRoot !== undefined) {
    const owned = new Set((await occupiedUniswapTokenNonces(stateRoot, operation.walletAddress)).map(String));
    while (owned.has(executableNonce.toString())) executableNonce += 1n;
  }
  const current = validateEconomics(executableNonce.toString(), estimated);
  if (!frozenEconomicsRemainExecutable(current, operation.economics)) {
    throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen nonce or transaction fee envelope is no longer executable before approval.");
  }
  requireEvmFunding(balance, operation.amountAtomic, await reads.feeQuote(operation.economics), binding.maxFeeWei);
}

export function evmCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>> {
  const binding = operation.evm, economics = operation.economics;
  if (binding === undefined || economics === undefined || operation.transactionData === undefined) throw new ApnError("APN_STATE_CORRUPT", "Generic signer request is incomplete.");
  return {
    profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint,
    walletAddress: operation.walletAddress, chainId: operation.chainId, evm: binding,
    transaction: {
      type: "eip1559", to: binding.transactionTo, valueAtomic: binding.valueAtomic, data: operation.transactionData,
      nonceAtomic: economics.nonceAtomic, gasLimitAtomic: economics.gasLimitAtomic,
      maxFeePerGasAtomic: economics.maxFeePerGasAtomic, maxPriorityFeePerGasAtomic: economics.maxPriorityFeePerGasAtomic, accessList: [],
    },
    approval: { recipient: operation.recipient, amountAtomic: operation.amountAtomic, amountDecimal: operation.amountDecimal, expiresAt: operation.expiresAt },
  };
}
