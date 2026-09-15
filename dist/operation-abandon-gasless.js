import { ApnError } from "./errors.js";
import { FACILITATOR_EXPOSED } from "./facilitator-gasless/operation-model.js";
import { publicFacilitatorOperation } from "./facilitator-gasless/receipt.js";
import { transitionFacilitator } from "./facilitator-gasless/transitions.js";
import { publicGaslessOperation } from "./gasless/receipt.js";
import { transitionGasless } from "./gasless/transitions.js";
import { publicMetaMaskGaslessOperation } from "./metamask-gasless/journal/receipt.js";
import { advanceMetaMaskGaslessOperation } from "./metamask-gasless/journal/transitions.js";
import { mmFailure } from "./metamask-gasless/reasons.js";
const CHAIN_NAMES = { 1: "Ethereum", 10: "Optimism", 130: "Unichain", 137: "Polygon",
    143: "Monad", 1329: "Sei", 8453: "Base", 42161: "Arbitrum", 43114: "Avalanche", 59144: "Linea" };
const UNRESOLVED = ["unknown_finality", "submitted_pending"];
/** Owner release of a disclosed Local gasless effect whose outcome stayed unknown after its approval window. */
export async function abandonLocalGasless(d, operationId) {
    const initial = await localRecord(d, operationId);
    if (initial.state === "abandoned_unknown" && initial.terminal)
        return publicGaslessOperation(initial);
    assertEligible(d, initial.terminal, initial.state, initial.settlement !== null, initial.intent.expiresAt);
    await d.gasless.resume(operationId).catch(() => undefined);
    return await d.context.state.withLocks([`profile:${initial.profileHash}`, `operation:${operationId}`], async () => {
        const op = await localRecord(d, operationId);
        if (op.terminal)
            return publicGaslessOperation(op);
        assertEligible(d, op.terminal, op.state, op.settlement !== null, op.intent.expiresAt);
        const i = op.intent;
        await d.context.requireOperationAbandonApproval().approve({ operationId, fingerprint: op.fingerprint, profile: i.profile,
            providerId: "local", walletAddress: i.owner.address, recipient: i.request.recipient, amountAtomic: i.request.grossAtomic,
            amountDecimal: usdc(i.request.grossAtomic), chainLabel: chainLabel(i.request.chainId), assetLabel: `USDC (${i.token})`, unit: "USDC",
            outcomeNote: "Financial outcome: UNKNOWN. A signed delegation or UserOperation may still be executed; the fee permit and delegation do not expire." });
        const next = transitionGasless(op, { state: "abandoned_unknown", failure: "gasless_owner_abandoned" }, d.context.clock.now().toISOString());
        await d.gasless.records.persist(next);
        return publicGaslessOperation(next);
    });
}
/** Owner release of a MetaMask gasless relay whose outcome stayed unknown after its approval window. */
export async function abandonMetaMaskGasless(d, operationId) {
    const initial = await metaMaskRecord(d, operationId);
    if (initial.state === "abandoned_unknown" && initial.terminal)
        return publicMetaMaskGaslessOperation(initial);
    assertEligible(d, initial.terminal, initial.state, initial.settlement !== null, initial.intent.expiresAt);
    await d.metaMaskGasless.resume(operationId).catch(() => undefined);
    return await d.context.state.withLocks([`profile:${initial.profileHash}`, `operation:${operationId}`], async () => {
        const op = await metaMaskRecord(d, operationId);
        if (op.terminal)
            return publicMetaMaskGaslessOperation(op);
        assertEligible(d, op.terminal, op.state, op.settlement !== null, op.intent.expiresAt);
        const i = op.intent;
        await d.context.requireOperationAbandonApproval().approve({ operationId, fingerprint: op.fingerprint, profile: i.profile,
            providerId: "metamask-agent-wallet", walletAddress: i.binding.address, recipient: i.request.recipient, amountAtomic: i.request.grossAtomic,
            amountDecimal: usdc(i.request.grossAtomic), chainLabel: chainLabel(i.request.chainId), assetLabel: `USDC (${i.token})`, unit: "USDC",
            outcomeNote: "Financial outcome: UNKNOWN. MetaMask may still relay this transfer; its delegation has no on-chain expiry." });
        const next = advanceMetaMaskGaslessOperation(op, { state: "abandoned_unknown", failure: mmFailure("mm_gasless_owner_abandoned") }, d.context.clock.now().toISOString());
        await d.metaMaskGasless.records.persist(next);
        return publicMetaMaskGaslessOperation(next);
    });
}
/** Owner release of an exposed Avalanche authorization whose use stayed unproven after its on-chain validity ended. */
export async function abandonFacilitatorGasless(d, operationId) {
    const initial = await facilitatorRecord(d, operationId);
    if (initial.state === "abandoned_unknown" && initial.terminal)
        return publicFacilitatorOperation(initial);
    assertAuthorizationEnded(d, initial);
    await d.facilitatorGasless.resume(operationId).catch(() => undefined);
    return await d.context.state.withLocks([`profile:${initial.profileHash}`, `operation:${operationId}`], async () => {
        const op = await facilitatorRecord(d, operationId);
        if (op.terminal)
            return publicFacilitatorOperation(op);
        assertAuthorizationEnded(d, op);
        const i = op.intent;
        await d.context.requireOperationAbandonApproval().approve({ operationId, fingerprint: op.fingerprint, profile: i.profile,
            providerId: "local", walletAddress: i.owner.address, recipient: i.request.recipient, amountAtomic: i.request.grossAtomic,
            amountDecimal: usdc(i.request.grossAtomic), chainLabel: chainLabel(i.request.chainId), assetLabel: `USDC (${i.requirement.asset})`,
            unit: "USDC", outcomeNote: "Financial outcome: UNKNOWN. The EIP-3009 authorization can no longer be used, but APN could not prove whether it was used before it expired." });
        const next = transitionFacilitator(op, { state: "abandoned_unknown", failure: "facilitator_gasless_owner_abandoned" }, d.context.clock.now().toISOString());
        await d.facilitatorGasless.records.persist(next);
        return publicFacilitatorOperation(next);
    });
}
async function facilitatorRecord(d, operationId) {
    const found = await d.operations.required(operationId);
    return found.kind === "facilitator_gasless_transfer" ? found.record : ineligible();
}
/** Chain timestamps can trail the local clock, so release also waits one facilitator timeout past validBefore. */
function assertAuthorizationEnded(d, op) {
    const validBefore = op.signed === null ? null : Number(op.signed.authorization.validBefore);
    if (op.terminal || !FACILITATOR_EXPOSED.includes(op.state) || op.settlement !== null || validBefore === null ||
        d.context.clock.now().getTime() / 1000 < validBefore + op.intent.requirement.maxTimeoutSeconds) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Only an exposed Avalanche facilitator transfer with an unproven outcome can be abandoned, and only after its authorization has expired.");
    }
}
async function localRecord(d, operationId) {
    const found = await d.operations.required(operationId);
    return found.kind === "gasless_transfer" ? found.record : ineligible();
}
async function metaMaskRecord(d, operationId) {
    const found = await d.operations.required(operationId);
    return found.kind === "metamask_gasless_transfer" ? found.record : ineligible();
}
function assertEligible(d, terminal, state, settled, expiresAt) {
    if (terminal || !UNRESOLVED.includes(state) || settled || d.context.clock.now().getTime() < Date.parse(expiresAt))
        ineligible();
}
function chainLabel(chainId) { return `${CHAIN_NAMES[chainId] ?? "EVM"} (${chainId})`; }
function usdc(value) {
    const padded = value.padStart(7, "0"), fraction = padded.slice(-6).replace(/0+$/u, "");
    return fraction === "" ? padded.slice(0, -6) : `${padded.slice(0, -6)}.${fraction}`;
}
function ineligible() {
    throw new ApnError("APN_OPERATION_BLOCKED", "Only a Local or MetaMask gasless transfer with an unknown outcome can be abandoned, and only after its approval window has passed.");
}
//# sourceMappingURL=operation-abandon-gasless.js.map