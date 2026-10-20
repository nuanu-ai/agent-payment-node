import { ApnError } from "../errors.js";
import { SwapOperationRepository } from "./repository.js";
import { abandonedPrincipalCandidate } from "./uniswap-v3/token-principal.js";
import { swapMechanismDigest } from "./pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "./route-admission.js";
import { UNISWAP_WBTC_MECHANISM_PIN, UNISWAP_WBTC_PROTOCOL_REGISTRY, UNISWAP_WBTC_PAIR, UNISWAP_WBTC_CODE_PINS, UNISWAP_V3_CODE_PINS, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, UNISWAP_V3_PAIRS, USDC_IMPLEMENTATION_PIN } from "./uniswap-v3/pins.js";
import { swapActualEconomics, swapStatusReceipt } from "./receipt-facts.js";
import { walletAllowanceRevokeCommand } from "../wallet-allowance/view.js";
import { UNISWAP_TOKEN_CHAIN_ID } from "../operation-index/adapters/uniswap-token.js";
export async function executeUniswapCommand(request, context) {
    if (request.command === "swap.uniswap-token.prepare" || request.command === "swap.uniswap-token.approve" ||
        request.command === "swap.uniswap-token.execute" || request.command === "swap.uniswap-token.cleanup" || request.command === "swap.uniswap-token.status" || request.command === "swap.uniswap-token.inventory" || request.command === "swap.uniswap-token.quote") {
        const runtime = context.uniswapTokenRuntime;
        if (runtime === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap token-input runtime is unavailable.", { reason: "uniswap_token_runtime_unavailable" });
        if (request.command === "swap.uniswap-token.prepare")
            return tokenOutcome(await runtime.prepare(request));
        if (request.command === "swap.uniswap-token.approve")
            return tokenOutcome(await runtime.approve(request.operationId));
        if (request.command === "swap.uniswap-token.execute") {
            const executed = await runtime.execute(request.operationId);
            return tokenOutcome(executed, await runtime.residualAllowance?.(executed) ?? null, "execute");
        }
        if (request.command === "swap.uniswap-token.cleanup")
            return tokenOutcome(await runtime.cleanup(request.operationId, request.cleanupFees));
        if (request.command === "swap.uniswap-token.inventory")
            return data(runtime.inventory(), "exact_token_route_inventory");
        if (request.command === "swap.uniswap-token.quote")
            return data(await runtime.quote(request), "unsigned_exact_simulated_swap_quote");
        const status = await runtime.status(request.operationId);
        return tokenOutcome(status, await runtime.residualAllowance?.(status) ?? null);
    }
    if (request.command === "swap.uniswap.inventory")
        return data({ ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION,
            execution: context.uniswapRuntime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
            keyless: { route: swapRouteOf(UNISWAP_V3_KEYLESS_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),
                mechanismPin: UNISWAP_V3_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),
                protocolRegistryDigest: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.registryDigest, pairs: UNISWAP_V3_PAIRS,
                codePins: [...UNISWAP_V3_CODE_PINS, USDC_IMPLEMENTATION_PIN] },
            wbtc: { route: swapRouteOf(UNISWAP_WBTC_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_WBTC_MECHANISM_PIN),
                mechanismPin: UNISWAP_WBTC_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(UNISWAP_WBTC_MECHANISM_PIN),
                protocolRegistryDigest: UNISWAP_WBTC_PROTOCOL_REGISTRY.registryDigest, pair: UNISWAP_WBTC_PAIR, codePins: UNISWAP_WBTC_CODE_PINS, minimumOutputAtomic: "1000" } }, "official_catalog_not_owner_admission");
    if (request.command === "swap.uniswap.quote") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap quote requires the keyless Ethereum runtime.", { reason: "uniswap_runtime_unavailable" });
        return data(await context.uniswapRuntime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
    }
    if (request.command === "swap.uniswap.prepare") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; staged allowlist data does not authorize preparation.", { reason: "uniswap_owner_admission_required" });
        return operationOutcome(await context.uniswapRuntime.prepare(request, context.clock.now()));
    }
    if (request.command === "swap.uniswap.status") {
        if (context.uniswapRuntime !== undefined) {
            const runtime = context.uniswapRuntime, operation = await runtime.status(request.operationId, context.clock.now());
            return { ...operationOutcome(operation), receipt: await swapStatusReceipt(operation, async () => await runtime.actualEconomics(operation)) };
        }
        const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        return { proofClass: operation.state, data: null, operation, nextActions: [],
            receipt: await swapStatusReceipt(operation, async () => await swapActualEconomics(context.state.root, operation, undefined, context.clock.now())) };
    }
    if (request.command === "swap.uniswap.approve") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Native ETH input has no ERC20 or Permit2 approval operation.", { reason: "uniswap_native_no_approval" });
        // Foreground CLI: the typed approval code and the single send are one command, like bridge approve.
        return operationOutcome(await context.uniswapRuntime.approveAndExecute(request.operationId, context.clock.now()));
    }
    if (request.command === "swap.uniswap.execute" && context.uniswapRuntime !== undefined)
        return operationOutcome(await context.uniswapRuntime.execute(request.operationId, context.clock.now()));
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap signing and sending are dormant until a complete exact single-send adapter is installed.", { reason: "uniswap_execution_dormant" });
}
/**
 * The token lane's observed receipt already holds what the swap proved; `actualEconomics` gives it the shared swap shape:
 * the exact input debit, the output credit, every gas the operation paid (approval, swap, cleanup) and the ETH that left.
 */
function tokenOutcome(value, residual = null, after) {
    const receipt = value.receipt, actualEconomics = receipt === null ? null : { inputAtomic: receipt.inputDebitAtomic,
        outputAtomic: receipt.outputCreditAtomic, networkFeeAtomic: (BigInt(receipt.approvalGasWei) + BigInt(receipt.swapGasWei) + BigInt(receipt.cleanupGasWei)).toString(),
        nativeDebitAtomic: receipt.nativeDebitWei };
    const outcome = { proofClass: value.phase, data: null, operation: value, receipt: receipt === null ? null : { ...receipt, actualEconomics },
        nextActions: uniswapTokenNextActions(value, after) };
    if (residual === null || residual === "0")
        return outcome;
    // A terminal swap with its approval standing (cleaned by the earlier expired-approval exit, or abandoned by the owner, whose
    // own cleanup can no longer reopen): the live residual and the generic exact revoke.
    const target = { profile: value.profile, chainId: UNISWAP_TOKEN_CHAIN_ID, token: value.route.inputToken, spender: value.route.router };
    return { ...outcome, data: { residualAllowance: { chain: `eip155:${target.chainId}`, token: target.token, owner: value.account, spender: target.spender,
                allowanceAtomic: residual, readAt: "latest" } }, nextActions: [...outcome.nextActions, walletAllowanceRevokeCommand(target)] };
}
/**
 * A swap that requires cleanup names its one exit, the owner's consented cleanup; when the fee cap refused it before
 * signing, the same cleanup may instead re-quote its own caps under fresh consent. An owner-abandoned swap still holding a
 * principal no proof released names execute, which opens custody to prove its swap never signed; execute itself, having
 * found signed bytes and changed nothing, does not name itself again.
 */
export function uniswapTokenNextActions(op, after) {
    if (abandonedPrincipalCandidate(op) !== null)
        return after === "execute" ? [] : [`apn swap ethereum uniswap-token execute --operation ${op.operationId}`];
    if (op.phase !== "cleanup_required")
        return [];
    const cleanup = `apn swap ethereum uniswap-token cleanup --operation ${op.operationId}`;
    return op.preSignFailure?.reason === "uniswap_token_fee_cap" ? [cleanup, `${cleanup} --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>`] : [cleanup];
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operationOutcome(value) {
    return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
//# sourceMappingURL=uniswap-command-service.js.map