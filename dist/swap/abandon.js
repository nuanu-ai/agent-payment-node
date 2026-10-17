import { canonicalJson, domainHash } from "../canonical.js";
import { loadAllowlistInventory, resolveAllowlistAsset } from "../allowlist-inventory.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { SWAP_TERMINAL_STATES } from "./model.js";
import { SwapOperationRepository } from "./repository.js";
import { GuardedSwapService } from "./service.js";
import { swapMechanismDigest } from "./pin.js";
import { JUPITER_V1_KNOWN_ROUTES } from "./jupiter-solana/v1-route-config.js";
import { OrcaExecutionBindingStore } from "./orca-solana/effects.js";
import { SavedOrcaQuoteStore } from "./orca-solana/material.js";
import { isOrcaKeylessMechanismDigest } from "./orca-solana/pools.js";
import { isOrcaStableGuardedMechanismDigest } from "./orca-solana/stable-mechanism.js";
/**
 * Owner exit (R4) for a swap marked for sending whose outcome no chain proof can settle: no transaction lifetime, router
 * deadline or expiration was recorded that `expired_unlanded` could use. It refuses while any chain proof is possible,
 * while the quote window is still open, and for families with their own recovery. After exact TTY consent the operation
 * becomes abandoned_unknown and its input stays charged as spent. It never signs, sends or releases the hold.
 */
export async function abandonSwapOperation(context, operationId) {
    const root = context.state.root, operations = new SwapOperationRepository(root);
    const operation = await required(operations, operationId);
    if (operation.state === "abandoned_unknown")
        return operation;
    assertAbandonable(operation);
    await assertNoChainProof(root, operation);
    if (context.clock.now().toISOString() < operation.quote.expiresAt) {
        blocked("The swap's approval window is still open; an execution in progress may still bind a provable lifetime.", "swap_abandon_window_open", { quote_expires_at: operation.quote.expiresAt });
    }
    await context.requireOperationAbandonApproval().approve(abandonIntent(operation));
    const latest = await required(operations, operationId);
    if (latest.integrityHash !== operation.integrityHash)
        blocked("The swap changed during owner consent; run abandon again.", "swap_abandon_operation_drift");
    await assertNoChainProof(root, latest);
    const acknowledgement = domainHash("apn.swap-abandoned-unknown.v1", canonicalJson({ operationId: latest.operationId,
        markerHash: latest.submissionMarker.markerHash, reservationId: latest.usageLease.reservationId }));
    return await new GuardedSwapService(operations, new AssetUsageLedger(root)).abandonUnknown(latest, context.clock.now(), acknowledgement);
}
function assertAbandonable(operation) {
    if (SWAP_TERMINAL_STATES.includes(operation.state))
        blocked("The swap is already terminal.", "swap_abandon_terminal");
    if (operation.submissionMarker === null) {
        blocked("Nothing was marked for sending, so no outcome is unknown; the swap family's execute or status releases an expired reservation.", "swap_abandon_unmarked");
    }
    if (operation.receiptProof !== null || operation.usageLease === null) {
        blocked("The swap already has chain evidence; its own status finishes it.", "swap_chain_proof_available");
    }
}
/** Refuses whenever a recorded bound lets the family's status prove finality, a revert or expired_unlanded. */
async function assertNoChainProof(root, operation) {
    const chain = operation.quote.sourceAsset.chain, digest = operation.mechanismDigest;
    if (isOrcaStableGuardedMechanismDigest(digest)) {
        blocked("Stable Orca swaps have their own exits.", "swap_abandon_family_recovery", { nextActions: [
                `apn swap solana orca stable-observe --operation ${operation.operationId}`,
                `apn swap solana orca stable-recover-no-send --operation ${operation.operationId}`
            ] });
    }
    if (isOrcaKeylessMechanismDigest(digest)) {
        const material = await new SavedOrcaQuoteStore(root).load(operation.quote.quoteHash);
        if (material === null)
            throw new ApnError("APN_STATE_CORRUPT", "Orca prepared material for a marked swap is missing.");
        // The execution binding holds the only lifetime the signed bytes can carry; with it, status proves the outcome.
        if (await new OrcaExecutionBindingStore(root).load(operation, material) === null)
            return;
        return provable(operation, "the execution binding records the transaction's blockhash lifetime", "apn swap solana orca status");
    }
    if (JUPITER_V1_KNOWN_ROUTES.some((route) => swapMechanismDigest(route.mechanismPin) === digest)) {
        return provable(operation, "the frozen message records its blockhash lifetime", "apn swap solana jupiter status");
    }
    if (/^eip155:1$/u.test(chain))
        return provable(operation, "the router deadline is the quote expiry", "apn swap ethereum uniswap status");
    if (/^tron:/u.test(chain))
        return provable(operation, "the transaction expiration is fixed in the prepared material", "apn swap tron sunswap status");
    blocked("Operation abandon does not cover this swap mechanism.", "swap_abandon_mechanism_unknown");
}
function provable(operation, bound, status) {
    return blocked(`The chain can prove this swap's outcome (${bound}); its status finishes it without an owner abandon.`, "swap_chain_proof_available", { nextActions: [`${status} --operation ${operation.operationId}`] });
}
function abandonIntent(operation) {
    const quote = operation.quote, source = quote.sourceAsset;
    const asset = resolveAllowlistAsset({ chain: source.chain, kind: source.kind, ...(source.identifier === null ? {} : { identifier: source.identifier }) }, loadAllowlistInventory());
    return { operationId: operation.operationId, fingerprint: operation.integrityHash, profile: quote.profile, providerId: "local_swap",
        walletAddress: quote.account, recipient: quote.recipient, amountAtomic: quote.inputAmountAtomic,
        amountDecimal: decimal(quote.inputAmountAtomic, asset.decimals), chainLabel: source.chain,
        assetLabel: `${asset.symbol} (${source.identifier ?? "native"})`, unit: asset.symbol,
        outcomeNote: "Financial outcome: UNKNOWN. The swap was marked for sending, but no transaction lifetime, deadline or expiration " +
            "was recorded that the chain could use to prove whether it landed. The input stays charged as spent in today's usage." };
}
async function required(operations, operationId) {
    const operation = await operations.loadAny(operationId);
    if (operation === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    return operation;
}
function decimal(value, decimals) {
    if (decimals === 0)
        return value;
    const padded = value.padStart(decimals + 1, "0"), fraction = padded.slice(-decimals).replace(/0+$/u, "");
    return fraction === "" ? padded.slice(0, -decimals) : `${padded.slice(0, -decimals)}.${fraction}`;
}
function blocked(message, reason, details = {}) {
    throw new ApnError("APN_OPERATION_BLOCKED", message, { reason, ...details });
}
//# sourceMappingURL=abandon.js.map