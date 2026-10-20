import { BASE_RPC_CHAIN } from "./rpc-requirement.js";
export function providerDirectExecutionInput(context, operation, binding) {
    return {
        operationId: operation.operationId,
        profileHash: operation.profileHash,
        profileRevision: binding.profileRevision,
        sender: operation.walletAddress,
        recipient: operation.recipient,
        amountAtomic: operation.amountAtomic,
        amountDecimal: operation.amountDecimal,
        rpcUrl: binding.coinbaseGasless === undefined ? context.requireRpcUrl(BASE_RPC_CHAIN) : context.requireCoinbaseRpcUrl(),
        preparedAt: operation.preparedAt,
        expiresAt: operation.expiresAt,
        requestHash: operation.requestHash,
        fingerprint: operation.fingerprint,
        binding,
    };
}
//# sourceMappingURL=provider-direct-execution-input.js.map