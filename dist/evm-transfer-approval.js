import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { requireEvmFunding, requireEvmRpc, evmTransaction } from "./evm-direct.js";
import { validateEconomics } from "./transfer-policy.js";
export async function checkEvmTransferFunding(rpcPort, operation, beforeSigning) {
    const binding = operation.evm;
    if (binding === undefined || operation.economics === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Generic operation has no frozen asset economics.");
    const rpc = requireEvmRpc(rpcPort), asset = binding.asset;
    await rpc.assertChain(operation.chainId);
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
        if (canonicalJson(validateEconomics(nonce, fees)) !== canonicalJson(operation.economics)) {
            throw new ApnError("APN_REPREPARE_REQUIRED", "Nonce or execution fee economics changed before approval.");
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