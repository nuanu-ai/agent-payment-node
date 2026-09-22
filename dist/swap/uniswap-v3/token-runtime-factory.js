import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { approvalCode } from "../../approval-code.js";
import { ApnError } from "../../errors.js";
import { exactChainConsent } from "../../tty-approval.js";
import { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { UniswapTokenCustody } from "./token-custody.js";
import { SavedUniswapTokenMaterialStore } from "./token-material.js";
import { UniswapTokenJournal } from "./token-operation.js";
import { UniswapTokenObserver } from "./token-observer.js";
import { UniswapTokenRevalidator } from "./token-revalidation.js";
import { InstalledUniswapTokenRuntime } from "./token-runtime.js";
export function createUniswapTokenRuntime(input) {
    const { state, wrapping, clock, call } = input, materials = new SavedUniswapTokenMaterialStore(state.root), custody = new UniswapTokenCustody(state, wrapping, call, () => clock.now()), observer = new UniswapTokenObserver(call), revalidator = new UniswapTokenRevalidator(call);
    const ports = {
        now: () => clock.now(), currentNonce: async (account) => await custody.currentNonce(account), currentAllowance: async (op) => await custody.currentAllowance(op),
        revalidate: async (op) => await revalidator.revalidate(op), seal: async (op, kind, nonce) => await custody.seal(op, kind, nonce),
        send: async (op, kind) => await custody.send(op, kind), observe: async (op, kind, hash) => await observer.observe(op, kind, hash),
        foregroundApprove: async (op) => await foreground(input.foreground === "approve", op, false, clock.now()),
        foregroundCleanup: async (op) => await foreground(input.foreground === "cleanup", op, true, clock.now()), confirm: async () => undefined,
    };
    const admit = async (request, now) => {
        const active = await loadActiveAssetPolicyRegistry({ state, clock }, request.profile);
        if (active === null)
            blocked("An active owner allowlist is required.", "swap_owner_admission_required");
        for (const [identifier, amountAtomic] of [[request.sourceToken, request.amountAtomic], [request.outputToken, request.minimumOutputAtomic]]) {
            evaluateAssetPolicy(active.registry, { chain: "eip155:1", asset: { kind: "token", identifier }, rail: "swap", amountAtomic,
                dailyUsageAtomic: "0", asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        }
        return active.digest;
    };
    return new InstalledUniswapTokenRuntime(new UniswapTokenQuoteBuilder(call, materials, admit, () => clock.now()), materials, new UniswapTokenJournal(state.root), ports);
}
async function foreground(enabled, op, cleanup, now) {
    if (!enabled)
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Uniswap token approval must continue in the foreground CLI.", { reason: "swap_foreground_cli_required" });
    const lines = cleanup ? ["Agent Payment Node Uniswap token allowance cleanup", `Profile: ${op.profile}`, `Operation: ${op.operationId}`,
        `Token/spender: ${op.route.inputToken} / ${op.route.router}`, "Replacement allowance: 0", `Reason: ${op.cleanupReason ?? "residual_allowance"}`] :
        ["Agent Payment Node Uniswap V3 token swap approval", `Profile: ${op.profile}`, `Operation: ${op.operationId}`, `Signer: ${op.account}`,
            `Exact input: ${op.route.amountIn} atomic at ${op.route.inputToken}`, `Minimum output: ${op.route.amountOutMinimum} atomic at ${op.route.outputToken}`,
            `Recipient: ${op.route.recipient}`, `Router: ${op.route.router}`, `Exact approval cap: ${op.approvalCapAtomic}`,
            `Aggregate native debit cap: ${op.maximumNativeDebitWei} wei`, `Deadline: ${new Date(op.route.deadline * 1000).toISOString()}`,
            "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."];
    await exactChainConsent(lines, approvalCode("swap", op.integrityHash, cleanup ? "cleanup" : "execute"), cleanup ? new Date(now.getTime() + 300_000).toISOString() : new Date(op.route.deadline * 1000).toISOString(), {});
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-runtime-factory.js.map