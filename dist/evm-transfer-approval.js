import { ApnError } from "./errors.js";
import { requireEvmFunding, requireEvmRpc, evmTransaction } from "./evm-direct.js";
import { directEvmNetwork } from "./evm-direct-networks.js";
import { validateEconomics } from "./transfer-policy.js";
import { occupiedUniswapTokenNonces } from "./swap/uniswap-v3/token-nonce-ownership.js";
function frozenEconomicsRemainExecutable(current, frozen) {
    const freshMaximumFee = BigInt(current.maxFeePerGasAtomic);
    const freshPriorityFee = BigInt(current.maxPriorityFeePerGasAtomic);
    const freshBaseFeeTwice = freshMaximumFee - freshPriorityFee;
    if (freshBaseFeeTwice < 0n || freshBaseFeeTwice % 2n !== 0n)
        return false;
    const freshBaseFee = freshBaseFeeTwice / 2n;
    return current.nonceAtomic === frozen.nonceAtomic &&
        BigInt(current.gasLimitAtomic) <= BigInt(frozen.gasLimitAtomic) &&
        freshBaseFee <= BigInt(frozen.maxFeePerGasAtomic);
}
export async function checkEvmTransferFunding(rpcPort, operation, beforeSigning, stateRoot) {
    const binding = operation.evm;
    if (binding === undefined || operation.economics === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Generic operation has no frozen asset economics.");
    const rpc = requireEvmRpc(rpcPort), asset = binding.asset;
    // The balance reader checks the selected chain before and after its pinned reads.
    const balance = await rpc.balance(operation.walletAddress, {
        chainId: operation.chainId, token: asset.kind === "native" ? "native" : asset.address, decimals: asset.decimals,
    });
    if (balance.address !== operation.walletAddress || balance.asset.chainId !== asset.chainId ||
        balance.asset.kind !== asset.kind || balance.asset.address !== asset.address || balance.asset.decimals !== asset.decimals) {
        throw new ApnError("APN_ASSET_MISMATCH", "Current balance does not match the approved frozen asset.");
    }
    if (beforeSigning) {
        const [nonce, fees] = await Promise.all([
            rpc.nonce(operation.chainId, operation.walletAddress, "pending"),
            rpc.estimate(evmTransaction(asset, operation.walletAddress, operation.recipient, operation.amountAtomic)),
        ]);
        let executableNonce = BigInt(nonce);
        if (operation.chainId === 1 && stateRoot !== undefined) {
            const owned = new Set((await occupiedUniswapTokenNonces(stateRoot, operation.walletAddress)).map(String));
            while (owned.has(executableNonce.toString()))
                executableNonce += 1n;
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
    const quote = await rpc.feeQuote(operation.chainId, operation.economics);
    requireEvmFunding(balance, operation.amountAtomic, quote, binding.maxFeeWei);
}
export function evmCustodyPayload(operation) {
    const binding = operation.evm, economics = operation.economics;
    if (binding === undefined || economics === undefined || operation.transactionData === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Generic signer request is incomplete.");
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
//# sourceMappingURL=evm-transfer-approval.js.map