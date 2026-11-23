/** The Ethereum token lane's foreground screens, byte for byte as the lane has always shown them. */
export function ethereumTokenScreen(op, cleanup) {
    return cleanup ? ["Agent Payment Node Uniswap token allowance cleanup", `Profile: ${op.profile}`, `Operation: ${op.operationId}`,
        `Token/spender: ${op.route.inputToken} / ${op.route.router}`, "Replacement allowance: 0", `Reason: ${op.cleanupReason ?? "residual_allowance"}`,
        `Native debit so far: ${op.accumulatedNativeDebitWei} wei; aggregate cap with this cleanup: ${op.maximumNativeDebitWei} wei`,
        ...(op.cleanupFeeQuote === undefined ? [] : [`Cleanup fee caps re-quoted by the owner at Ethereum block ${op.cleanupFeeQuote.blockNumber} (base fee ${op.cleanupFeeQuote.baseFeePerGasWei} wei, priority fee ${op.cleanupFeeQuote.priorityFeePerGasWei} wei)`,
            `Cleanup max fee per gas: ${op.cleanupGas.maxFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxFeePerGas}); max priority fee: ${op.cleanupGas.maxPriorityFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxPriorityFeePerGas}); gas limit ${op.cleanupGas.gasLimit}`,
            `Native debit cap: ${op.maximumNativeDebitWei} wei (was ${op.cleanupFeeQuote.previousMaximumNativeDebitWei})`]),
        ...(op.retiredEffects ?? []).filter((row) => row.kind === "cleanup").map((row) => `Earlier cleanup ${row.attempt.transactionHash}: ${row.reason}`)] :
        ["Agent Payment Node Uniswap V3 token swap approval", `Profile: ${op.profile}`, `Operation: ${op.operationId}`, `Signer: ${op.account}`,
            `Exact input: ${op.route.amountIn} atomic at ${op.route.inputToken}`, `Minimum output: ${op.route.amountOutMinimum} atomic at ${op.route.outputToken}`,
            `Recipient: ${op.route.recipient}`, `Router: ${op.route.router}`, `Exact approval cap: ${op.approvalCapAtomic}`,
            `Aggregate native debit cap: ${op.maximumNativeDebitWei} wei`, `Deadline: ${new Date(op.route.deadline * 1000).toISOString()}`,
            "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."];
}
//# sourceMappingURL=token-screen.js.map