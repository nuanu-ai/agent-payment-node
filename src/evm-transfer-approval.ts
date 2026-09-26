import { ApnError } from "./errors.js";
import { requireEvmFunding, requireEvmRpc, evmTransaction, validateEvmFeeQuote } from "./evm-direct.js";
import { directEvmNetwork } from "./evm-direct-networks.js";
import type { Economics, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { validateEconomics } from "./transfer-policy.js";
import { occupiedUniswapTokenNonces } from "./swap/uniswap-v3/token-nonce-ownership.js";

function frozenEconomicsRemainExecutable(current: Economics, frozen: Economics): boolean {
  const freshMaximumFee = BigInt(current.maxFeePerGasAtomic);
  const freshPriorityFee = BigInt(current.maxPriorityFeePerGasAtomic);
  const freshBaseFeeTwice = freshMaximumFee - freshPriorityFee;
  if (freshBaseFeeTwice < 0n || freshBaseFeeTwice % 2n !== 0n) return false;
  const freshBaseFee = freshBaseFeeTwice / 2n;
  return current.nonceAtomic === frozen.nonceAtomic &&
    BigInt(current.gasLimitAtomic) <= BigInt(frozen.gasLimitAtomic) &&
    freshBaseFee <= BigInt(frozen.maxFeePerGasAtomic);
}

export async function checkEvmTransferFunding(rpcPort: RpcPort, operation: OperationRecord, beforeSigning: boolean, stateRoot?: string): Promise<void> {
  const binding = operation.evm;
  if (binding === undefined || operation.economics === undefined) throw new ApnError("APN_STATE_CORRUPT", "Generic operation has no frozen asset economics.");
  if (operation.chainId === 1 || operation.chainId === 56 || operation.chainId === 8453 || operation.chainId === 42161) rpcPort.armEvmDirectRpcGuard?.();
  const rpc = requireEvmRpc(rpcPort), asset = binding.asset;
  const grouped = asset.kind === "native" ? operation.chainId === 1 ? rpc.prepareEthereumNative?.() :
    operation.chainId === 56 ? rpc.prepareBnbNative?.() : undefined : undefined;
  if ((operation.chainId === 1 || operation.chainId === 56) && asset.kind === "native" && grouped === undefined) {
    throw new ApnError("APN_RPC_CONFIG", "Selected native approval requires batched RPC reads.");
  }
  // The balance reader checks the selected chain before and after its pinned reads.
  const balance = await (grouped ?? rpc).balance(operation.walletAddress, {
    chainId: operation.chainId, token: asset.kind === "native" ? "native" : asset.address, decimals: asset.decimals,
  });
  if (balance.address !== operation.walletAddress || balance.asset.chainId !== asset.chainId ||
      balance.asset.kind !== asset.kind || balance.asset.address !== asset.address || balance.asset.decimals !== asset.decimals) {
    throw new ApnError("APN_ASSET_MISMATCH", "Current balance does not match the approved frozen asset.");
  }
  if (beforeSigning) {
    const [nonce, fees] = grouped === undefined ? await Promise.all([
      rpc.nonce(operation.chainId, operation.walletAddress, "pending"),
      rpc.estimate(evmTransaction(asset, operation.walletAddress, operation.recipient, operation.amountAtomic)),
    ]) : await grouped.nonceEstimate(operation.walletAddress,
      evmTransaction(asset, operation.walletAddress, operation.recipient, operation.amountAtomic)).then(({ nonce, estimated }) => [nonce, estimated] as const);
    let executableNonce = BigInt(nonce); if (operation.chainId === 1 && stateRoot !== undefined) {
      const owned = new Set((await occupiedUniswapTokenNonces(stateRoot, operation.walletAddress)).map(String));
      while (owned.has(executableNonce.toString())) executableNonce += 1n;
    }
    const current = validateEconomics(executableNonce.toString(), fees);
    if (!frozenEconomicsRemainExecutable(current, operation.economics)) {
      throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen nonce or transaction fee envelope is no longer executable before approval.");
    }
  }
  if (!beforeSigning && directEvmNetwork(operation.chainId).feeModel === "arbitrum-inclusive") {
    const fees = await rpc.estimate(evmTransaction(asset, operation.walletAddress, operation.recipient, operation.amountAtomic));
    const current = validateEconomics(operation.economics.nonceAtomic, fees);
    if (!frozenEconomicsRemainExecutable({ ...current, nonceAtomic: operation.economics.nonceAtomic }, operation.economics)) {
      throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "Current Arbitrum inclusive gas or price exceeds the frozen signed envelope; retain this operation without replacement.");
    }
  }
  // On Ethereum the signed max fee times gas limit is already the on-chain upper bound.
  // There are no separate L1/operator charges to refresh after the signature exists.
  const quote = !beforeSigning && operation.chainId === 1 && asset.kind === "native"
    ? validateEvmFeeQuote(binding.feeQuote, operation.economics)
    : await (grouped === undefined ? rpc.feeQuote(operation.chainId, operation.economics) : grouped.feeQuote(operation.economics));
  requireEvmFunding(balance, operation.amountAtomic, quote, binding.maxFeeWei);
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
