export function providerDirectExecutionInput(context, operation, binding) {
    return {
        operationId: operation.operationId,
        profileHash: operation.profileHash,
        profileRevision: binding.profileRevision,
        sender: operation.walletAddress,
        recipient: operation.recipient,
        amountAtomic: operation.amountAtomic,
        amountDecimal: operation.amountDecimal,
        rpcUrl: context.requireRpcUrl(),
        preparedAt: operation.preparedAt,
        expiresAt: operation.expiresAt,
        requestHash: operation.requestHash,
        fingerprint: operation.fingerprint,
        binding,
    };
}
//# sourceMappingURL=provider-direct-execution-input.js.map